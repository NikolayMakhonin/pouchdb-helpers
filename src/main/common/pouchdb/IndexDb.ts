import PouchDB from 'pouchdb'
import {IDoc} from './contracts'
import {PouchDbController} from './PouchDbController'

export const INDEX_UUID = '299jqv3bfzf' // uuidSimple()
export const INDEX_DB_SUFFIX = '_' + INDEX_UUID
export const INDEX_SOURCE_PREFIX = 'SOURCE-' + INDEX_UUID + '_'
export const INDEX_STATE_ID = '_design/state'

export interface IIndexState extends IDoc {
	update_seq: number | string
	rollback?: { [key: string]: any }
}

export enum UpdateIndexAction {
	Update = 'Update',
	Delete = 'Delete',
}

export interface IIndexOptions<TSource = any, TIndex = {}> {
	getIndexesIds: (source: TSource) => string[]
	createIndex?: (indexId: string, source: TSource) => TIndex
	updateIndex?: (index: TIndex, source: TSource, prevSource: TSource) => UpdateIndexAction
}

function createIndexDefault(indexId: string, source: any): {} {
	return {}
}

function updateIndexDefault(index: any, source: any, prevSource: any): UpdateIndexAction {
	if (source != null) {
		throw new Error('Unexpected behavior')
	}
	return UpdateIndexAction.Delete
}

export class IndexDb<TDoc, TSource> {
	private readonly _sourceDb: PouchDbController
	private readonly _indexDb: PouchDbController
	private readonly _indexesOptions: Array<IIndexOptions<any, any>> = []
	private readonly _dontSaveSource: boolean
	private readonly _getSource: (doc: TDoc) => TSource
	private readonly _getChangesOptions?: PouchDB.Core.ChangesOptions
	private readonly _simulateError: boolean

	constructor({
		name,
		sourceDb,
		dontSaveSource,
		getSource,
		options,
		getChangesOptions,
	}: {
		name?: string,
		sourceDb: PouchDbController,
		dontSaveSource?: boolean, // prevDoc will always null
		getSource: (doc: TDoc) => TSource,
		options?: PouchDB.Configuration.DatabaseConfiguration,
		getChangesOptions?: PouchDB.Core.ChangesOptions,
	}) {
		this._sourceDb = sourceDb
		this._dontSaveSource = dontSaveSource
		this._getSource = getSource
		this._getChangesOptions = getChangesOptions
		this._indexDb = new PouchDbController({
			name   : this._sourceDb.name + '_index' + (name ? '_' + name : '') + INDEX_DB_SUFFIX,
			options: {
				revs_limit: 0,
				...options,
			},
		})
	}

	public get sourceDb() {
		return this._sourceDb
	}

	public get indexDb() {
		return this._indexDb
	}

	public addIndex<TIndex>(options: IIndexOptions<TSource, TIndex>): this {
		this._indexesOptions.push(options)
		return this
	}

	public async clear() {
		await this._indexDb.destroy()
	}

	protected clone<T>(object: T): T {
		return JSON.parse(JSON.stringify(object))
	}

	public async getState() {
		return (await this._indexDb.get(INDEX_STATE_ID)) as IIndexState
	}

	private async rollback(state?: IIndexState) {
		if (!state) {
			state = await this.getState()
			if (!state) {
				return
			}
		}

		const rollbackItemsMap = state.rollback
		if (!rollbackItemsMap) {
			return
		}

		const rollbackKeys = Object.keys(rollbackItemsMap)
		console.log(`IndexDb rollback start (${rollbackKeys.length})`)

		const deleteItems = []
		const updateItems = []
		;(await this._indexDb.allDocs<any>({
			keys: rollbackKeys,
		}))
			.rows
			.forEach(o => {
				const rollbackItem = rollbackItemsMap[o.key]
				if (o.value) {
					if (rollbackItem) {
						rollbackItem._rev = o.value.rev
						updateItems.push(rollbackItem)
					} else if (!o.value.deleted) {
						deleteItems.push({
							_id     : o.id,
							_rev    : o.value.rev,
							_deleted: true,
						})
					}
				} else if (rollbackItem) {
					updateItems.push(rollbackItem)
				}
			})
		;(await this._indexDb.db.bulkDocs(deleteItems.concat(updateItems)))
			.forEach(o => {
				if ((o as any).error) {
					const message = (o as any).message + ': ' + JSON.stringify(o.id)
					console.error(message)
					throw new Error('IndexDb rollback error: ' + message)
				}
			})

		// rollback successful
		state.rollback = null
		await this._indexDb.db.put(state)

		console.log(`IndexDb rollback successful (${rollbackKeys.length})`)
	}

	private async _update(limit: number) {
		let state = await this.getState()
		if (!state) {
			state = {
				_id       : INDEX_STATE_ID,
				update_seq: 0,
			}
		}

		await this.rollback(state)

		const changes = await this._sourceDb.changes<TDoc>({
			limit,
			since       : state.update_seq,
			// filter: 'type',
			// query_params: { type: ['post', 'tag'] },
			include_docs: true,
			...this._getChangesOptions,
		})

		if (!changes.results.length) {
			if (this._simulateError) {
				// tslint:disable-next-line:no-duplicate-string
				throw new Error('Simulated error')
			}
			return null
		}

		const sources = changes
			.results
			.map(o => {
				if (o.doc._deleted) {
					return null
				}
				const source = this._getSource(o.doc)
				if (source) {
					(source as any)._id = o.id
				}
				return source
			})

		// console.debug(`IndexDb update start (${changes.results.length})`)

		const prevSourcesMap: { [key: string]: any } = {}
		const prevSources = (await this._indexDb.allDocs({
			keys        : changes.results.map(o => INDEX_SOURCE_PREFIX + o.id),
			include_docs: true,
		}))
			.rows
			.map(o => {
				const doc = o.doc || o.value && {
					_id     : o.id,
					_rev    : o.value.rev,
					_deleted: o.value.deleted,
				}

				if (doc) {
					doc._id = doc._id.substring(INDEX_SOURCE_PREFIX.length)
					prevSourcesMap[doc._id] = doc
				}

				return doc
			})

		const indexesMap: { [key: string]: any } = {}
		const updateIndexParams: Array<{
			indexOptions: IIndexOptions<any, any>,
			source: any,
			prevSource: any,
			indexesIds: string[],
			prevIndexesIds: string[],
			equalIndexesIds: string[],
		}> = []

		for (let i = 0, len = sources.length; i < len; i++) {
			const source = sources[i]
			const prevSource = prevSources[i]

			if (!source && !prevSource) {
				continue
			}

			for (let j = 0, len2 = this._indexesOptions.length; j < len2; j++) {
				const indexOptions = this._indexesOptions[j]
				let indexesIds = source && indexOptions.getIndexesIds(source)
				let prevIndexesIds = prevSource && !(prevSource as any)._deleted
					&& indexOptions.getIndexesIds(prevSource)

				const buffer = (indexesIds || prevIndexesIds) && {}

				if (indexesIds) {
					for (let k = 0, len3 = indexesIds.length; k < len3; k++) {
						const indexId = indexesIds[k]
						buffer[indexId] = 1
					}
				}

				if (prevIndexesIds) {
					for (let k = 0, len3 = prevIndexesIds.length; k < len3; k++) {
						const indexId = prevIndexesIds[k]
						const type = Object.prototype.hasOwnProperty.call(buffer, indexId)
							&& buffer[indexId]
						if (!type) {
							buffer[indexId] = 2
						} else if (type === 1) {
							buffer[indexId] = 3
						}
					}
				}

				if (buffer) {
					indexesIds = indexesIds && []
					prevIndexesIds = prevIndexesIds && []
					const equalIndexesIds = indexesIds && prevIndexesIds && []

					for (const indexId in buffer) {
						if (Object.prototype.hasOwnProperty.call(buffer, indexId)) {
							// eslint-disable-next-line default-case
							switch (buffer[indexId]) {
								case 1:
									indexesIds.push(indexId)
									break
								case 2:
									prevIndexesIds.push(indexId)
									break
								case 3:
									equalIndexesIds.push(indexId)
									break
							}

							indexesMap[indexId] = null
						}
					}

					updateIndexParams.push({
						indexOptions,
						source,
						prevSource,
						indexesIds,
						prevIndexesIds,
						equalIndexesIds,
					})
				}
			}
		}

		(await this._indexDb.allDocs<any>({
			keys        : Object.keys(indexesMap),
			include_docs: true,
		}))
			.rows
			.forEach(o => {
				if (o.value) {
					indexesMap[o.id] = o.doc || {
						_id     : o.id,
						_rev    : o.value.rev,
						_deleted: o.value.deleted,
					}
				}
			})

		const rollbackItemsMap: { [key: string]: any } = {}

		const changedIndexesMap: { [key: string]: any } = {}
		const changedSourcesMap: { [key: string]: any } = {}
		const indexAction = (
			source: any,
			prevSource: any,
			indexId: string,
			index: any,
			indexRollback: any,
			action: UpdateIndexAction,
		) => {
			switch (action) {
				case UpdateIndexAction.Update:
					changedIndexesMap[indexId] = index
					if (!Object.prototype.hasOwnProperty.call(rollbackItemsMap, indexId)) {
						rollbackItemsMap[indexId] = indexRollback
					}
				// eslint-disable-next-line no-fallthrough
				case null:
				case void 0:
					if (source != null) {
						changedSourcesMap[source._id] = source
					} else if (
						prevSource != null
						&& !Object.prototype.hasOwnProperty.call(changedSourcesMap, prevSource._id)
					) {
						changedSourcesMap[prevSource._id] = null
					}
					break
				case UpdateIndexAction.Delete:
					if (!Object.prototype.hasOwnProperty.call(changedIndexesMap, indexId)) {
						changedIndexesMap[indexId] = null
						rollbackItemsMap[indexId] = indexRollback
					}
					if (prevSource == null) {
						if (source == null) {
							throw new Error('Unexpected behavior')
						}
						// changedSourcesMap[source._id] = void 0
					} else if (!Object.prototype.hasOwnProperty.call(changedSourcesMap, prevSource._id)) {
						changedSourcesMap[prevSource._id] = null
					}
					break
				// case null:
				// case void 0:
				// 	if (source == null || prevSource == null) {
				// 		throw new Error('Unexpected behavior')
				// 	}
				// 	if (changedSourcesMap[source._id] == null) {
				// 		changedSourcesMap[source._id] = void 0
				// 	}
				// 	break
				default:
					throw new Error('Unknown UpdateIndexAction: ' + action)
			}
		}

		updateIndexParams.forEach(({
			indexOptions,
			source,
			prevSource,
			indexesIds,
			prevIndexesIds,
			equalIndexesIds,
		}) => {
			const createIndex = indexOptions.createIndex || createIndexDefault
			const updateIndex = indexOptions.updateIndex || updateIndexDefault

			if (prevIndexesIds) {
				for (let i = 0, len = prevIndexesIds.length; i < len; i++) {
					const indexId = prevIndexesIds[i]
					const index = Object.prototype.hasOwnProperty.call(indexesMap, indexId)
						&& indexesMap[indexId]
					if (index && !index._deleted) {
						const indexRollback = this.clone(index)
						indexAction(
							null, prevSource, indexId, index, indexRollback,
							updateIndex(index, null, prevSource),
						)
					} else {
						// console.warn(`Index ${JSON.stringify(indexId)} not found for doc: `, source)
						const newIndex = Object.prototype.hasOwnProperty.call(changedIndexesMap, indexId)
							&& changedIndexesMap[indexId]
						if (newIndex) {
							indexAction(
								null, prevSource, indexId, newIndex, null,
								updateIndex(newIndex, source, null),
							)
						}
					}
				}
			}

			if (indexesIds) {
				for (let i = 0, len = indexesIds.length; i < len; i++) {
					const indexId = indexesIds[i]
					const index = Object.prototype.hasOwnProperty.call(indexesMap, indexId)
						&& indexesMap[indexId]
					if (index && !index._deleted) {
						// console.warn(`Index ${JSON.stringify(indexId)} found but prev doc not found for doc: `, doc)
						const indexRollback = this.clone(index)
						indexAction(source, null, indexId, index, indexRollback, updateIndex(index, source, null))
					} else {
						let newIndex = Object.prototype.hasOwnProperty.call(changedIndexesMap, indexId)
							&& changedIndexesMap[indexId]
						if (newIndex) {
							indexAction(source, null, indexId, newIndex, null, updateIndex(newIndex, source, null))
						} else {
							newIndex = createIndex(indexId, source)
							if (newIndex) {
								if (index) {
									newIndex._rev = index._rev
								}
								changedIndexesMap[indexId] = newIndex
								rollbackItemsMap[indexId] = null
								changedSourcesMap[source._id] = source
							}
						}
					}
				}
			}

			if (equalIndexesIds) {
				for (let i = 0, len = equalIndexesIds.length; i < len; i++) {
					const indexId = equalIndexesIds[i]
					const index = Object.prototype.hasOwnProperty.call(indexesMap, indexId)
						&& indexesMap[indexId]
					if (index && !index._deleted) {
						const indexRollback = this.clone(index)
						indexAction(source, prevSource, indexId, index, indexRollback,
							updateIndex(index, source, prevSource))
					} else {
						// console.warn(`Index ${JSON.stringify(indexId)} not found for doc and prevDoc: `,
						// source, prevSource)
						let newIndex = Object.prototype.hasOwnProperty.call(changedIndexesMap, indexId)
							&& changedIndexesMap[indexId]
						if (newIndex) {
							indexAction(source, prevSource, indexId, newIndex, null,
								updateIndex(newIndex, source, null))
						} else {
							newIndex = createIndex(indexId, source)
							if (newIndex) {
								if (index) {
									newIndex._rev = index._rev
								}
								changedIndexesMap[indexId] = newIndex
								rollbackItemsMap[indexId] = null
								changedSourcesMap[source._id] = source
							}
						}
					}
				}
			}
		})

		const deleteItems = []
		const updateItems = []

		for (const indexId in changedIndexesMap) {
			if (Object.prototype.hasOwnProperty.call(changedIndexesMap, indexId)) {
				let index = changedIndexesMap[indexId]
				if (index) {
					updateItems.push(index)
				} else {
					index = indexesMap[indexId]
					if (!index._deleted) {
						deleteItems.push({
							_id     : index._id,
							_rev    : index._rev,
							_deleted: true,
						})
					}
				}
			}
		}

		for (const sourceId in changedSourcesMap) {
			if (!Object.prototype.hasOwnProperty.call(changedSourcesMap, sourceId)) {
				continue
			}

			const source = changedSourcesMap[sourceId]
			if (source !== void 0) {
				const prevSource = prevSourcesMap[sourceId]

				if (source && (!source._deleted)) {
					source._id = INDEX_SOURCE_PREFIX + source._id
					if (prevSource) {
						prevSource._id = INDEX_SOURCE_PREFIX + prevSource._id
						rollbackItemsMap[prevSource._id] = prevSource._deleted
							? null
							: prevSource
						source._rev = prevSource._rev
					} else {
						rollbackItemsMap[source._id] = null
						delete source._rev
					}
					if (this._dontSaveSource) {
						deleteItems.push({
							_id     : source._id,
							_rev    : source._rev,
							_deleted: true,
						})
					} else {
					updateItems.push(source)
					}
				} else if (prevSource && !prevSource._deleted) {
					prevSource._id = INDEX_SOURCE_PREFIX + prevSource._id
					rollbackItemsMap[prevSource._id] = prevSource
					deleteItems.push({
						_id     : prevSource._id,
						_rev    : prevSource._rev,
						_deleted: true,
					})
				}
			}
		}

		// transaction start: save rollback
		state.rollback = rollbackItemsMap
		try {
			(state as any)._rev = (await this._indexDb.db.put(state)).rev
		} catch (ex) {
			console.error(ex.stack || ex)
			throw ex
		}

		try {
			const changeItems = deleteItems.concat(updateItems)
			// transaction actions
			;(await this._indexDb.db.bulkDocs(changeItems))
				.forEach(o => {
					if (this._simulateError) {
						throw new Error('Simulated error')
					}
					if ((o as any).error) {
						const message = (o as any).message + ': ' + JSON.stringify(o.id)
						console.error(message)
						throw new Error('IndexDb update error: ' + message)
					}
				})

			if (changeItems.length === 0 && this._simulateError) {
				throw new Error('Simulated error')
			}
		} catch (error) {
			if (error.message !== 'Simulated error') {
				console.error(error.message)
			}
			await this.rollback(state)
			throw error
		}

		// transaction successful
		state.rollback = null
		state.update_seq = changes.last_seq
		await this._indexDb.db.put(state)

		// console.debug(`IndexDb update successful (${changes.results.length})`)

		return changes.results.length
	}

	public async update(bulkLimit: number) {
		let handledItemsTotal
		while (true) {
			const handledItems = await this._update(bulkLimit)
			if (handledItems != null) {
				handledItemsTotal = handledItemsTotal
					? handledItemsTotal + handledItems
					: handledItems
			}
			if (handledItems < bulkLimit) {
				break
			}
		}
		return handledItemsTotal
	}
}
