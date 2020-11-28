import PouchDB from 'pouchdb'

export interface AllDocsResponseRow<Content extends {}> {
	/** Only present if `include_docs` was `true`. */
	doc?: PouchDB.Core.ExistingDocument<Content & PouchDB.Core.AllDocsMeta>
	id: PouchDB.Core.DocumentId
	key: PouchDB.Core.DocumentKey
	value: {
		rev: PouchDB.Core.RevisionId;
		deleted?: boolean;
	}
}

export interface AllDocsResponse<TRow> {
	/** The `skip` if provided, or in CouchDB the actual offset */
	offset: number
	total_rows: number
	update_seq?: number | string
	rows: Array<TRow>
}

function delay(timeMilliseconds) {
	return new Promise(resolve => {
		setTimeout(resolve, timeMilliseconds)
	})
}

export class PouchDbController {
	public readonly name: string
	public readonly options: PouchDB.Configuration.DatabaseConfiguration

	constructor({
		name,
		options,
	}: {
		name: string,
		options?: PouchDB.Configuration.DatabaseConfiguration,
	}) {
		this.name = name
		this.options = options
	}

	private _db: PouchDB.Database
	public get db() {
		if (!this._db) {
			this._db = this.options
				? new PouchDB(this.name, { ...this.options })
				: new PouchDB(this.name)
		}
		return this._db
	}

	public async destroy() {
		if (this._db !== null) {
			await this.db.destroy()
			this._db = null
		}
	}

	public async close() {
		if (this._db !== null) {
			await this.db.close()
			this._db = null
		}
	}

	public async connect(timeout: number = 60000) {
		const timeStart = Date.now()
		while (true) {
			try {
				// eslint-disable-next-line no-await-in-loop
				await this.allDocs({
					limit: 1,
					include_docs: false,
				})
				return
			} catch (ex) {
				if (ex.type !== 'OpenError') {
					throw ex
				}

				this._db = null

				if (Date.now() - timeStart > timeout) {
					throw new Error(`PouchDB connect timeout (${timeout})`)
				}

				// eslint-disable-next-line no-await-in-loop
				await delay(1000)
			}
		}
	}

	public async using(func: (this: this, db: PouchDbController) => any) {
		try {
			await this.connect()
			return await func.call(this, this)
		} finally {
			this.close()
		}
	}

	public async createIndex(field: string) {
		const ddoc = {
			_id  : '_design/' + field,
			views: {
				[field]: {
					map: `function mapFunc(doc) {
						if (doc.${field}) {
							emit(doc.${field});
						}
					}`,
				},
			},
			filters: {
				[field]: `function (doc, req) {
					return doc.${field} === req.query.${field}
						|| Array.isArray(req.query.${field}) && req.query.${field}.indexOf(doc.${field}) >= 0;
				}`,
			},
		}

		try {
			await this.db.put(ddoc)
		} catch (err) {
			if (err.name !== 'conflict') {
				throw err
			}
			// ignore if doc already exists
		}
	}

	public async get<Model>(
		docId: PouchDB.Core.DocumentId,
		options?: PouchDB.Core.GetOptions,
	) {
		try {
			return await (options
				? this.db.get<Model>(docId, options)
				: this.db.get<Model>(docId))
		} catch (err) {
			if (err.name === 'not_found') {
				return null
			}
			throw err
		}
	}

	public async bulkGet<Model>(
		options: PouchDB.Core.BulkGetOptions,
	) {
		return (await this.db.bulkGet<Model>(options))
			.results
			.map(o => {
				if (o.docs.length !== 1) {
					throw new Error(`bulkGet().results[].docs.length === ${o.docs.length}`)
				}
				const doc = o.docs[0]
				if ((doc as any).error) {
					if ((doc as any).error !== 'not_found') {
						throw new Error('bulkGet(' + o.id + ') error: ' + (doc as any).error)
					}

					return null
				}

				if ((doc as any).missing) {
					throw new Error(`missing revision (id: ${o.id}, rev: ${(doc as any).missing})`)
				}

				if (!(doc as any).ok) {
					throw new Error('doc.ok is null')
				}

				return (doc as any).ok
			})
	}

	public async allDocs<Model, Result = AllDocsResponseRow<Model>>(
		options: PouchDB.Core.AllDocsWithKeyOptions | PouchDB.Core.AllDocsWithKeysOptions
			| PouchDB.Core.AllDocsWithinRangeOptions | PouchDB.Core.AllDocsOptions,
		mapFunc?: (row: AllDocsResponseRow<Model>, emit: (row: Result) => boolean) => void,
		bulkSize?: number,
	): Promise<AllDocsResponse<Result>> {
		if (!mapFunc || options.limit === 0) {
			return await (options ? this.db.allDocs<Model>(options) : this.db.allDocs<Model>()) as any
		}

		if ((options as any).key || (options as any).keys) {
			throw new Error('filter is not compatible with options: key, keys')
		}

		const bulkOptions: PouchDB.Core.AllDocsWithinRangeOptions & PouchDB.Core.AllDocsOptions = {
			...options as any,
			limit: bulkSize || 10,
		}

		let response: PouchDB.Core.AllDocsResponse<Model>
		const results = []
		const emit = (row: Result) => {
			if (results.length >= options.limit) {
				return false
			}
			results.push(row)
			return results.length < options.limit
		}

		while (true) {
			response = await this.allDocs<Model>(bulkOptions)
			const len = response.rows.length

			for (let i = 0; i < len; i++) {
				const row = response.rows[i]
				mapFunc(row, emit)
				if (results.length >= options.limit) {
					break
				}
			}

			if (len < bulkOptions.limit || results.length >= options.limit) {
				break
			}

			bulkOptions.startkey = response.rows[response.rows.length - 1].id
			bulkOptions.skip = 1
		}

		response.rows = results

		return response as any
	}

	public async changes<Model>(
		options?: PouchDB.Core.ChangesOptions,
	) {
		const result = await (options
			? this.db.changes<Model>(options)
			: this.db.changes<Model>())

		result
			.results
			.forEach(o => {
				if (o.changes.length !== 1) {
					throw new Error(`changes().results[].changes.length === ${o.changes.length}`)
				}
			})

		return result
	}

	/** @deprecated */
	public getPrevRevisionsIds(
		docs: Array<PouchDB.Core.GetMeta & PouchDB.Core.IdMeta>,
	) {
		return docs.map(o => {
			return o._revisions.ids.length > 1
				? {
					id : o._id,
					rev: (o._revisions.start - 1) + '-' + o._revisions.ids[1],
				}
				: null
		})
	}

	/** @deprecated I can't use it for determine changes between update_seq */
	public async getPrevDocs<Model>(
		docs: Array<Model & PouchDB.Core.GetMeta & PouchDB.Core.IdMeta>,
		options?: PouchDB.Core.BulkGetOptions,
	) {
		const revisionsIds = this.getPrevRevisionsIds(docs)

		const revisionsIdsNotNull = revisionsIds.filter(o => o)
		if (!revisionsIdsNotNull.length) {
			return revisionsIds
		}

		const results = await this.bulkGet<Model>({
			...options,
			docs: revisionsIdsNotNull,
		})

		let resultsIndex = 0

		return revisionsIds
			.map(o => {
				if (!o) {
					return null
				}

				const result = results[resultsIndex++]

				if (result._id !== o.id) {
					throw new Error(`getPrevDocs: result._id(${result._id}) !== o.id(${o.id})`)
				}

				return result
			})
	}
}
