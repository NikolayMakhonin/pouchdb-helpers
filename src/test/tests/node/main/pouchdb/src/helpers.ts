import PouchDB from 'pouchdb'
import {Random, performanceNow} from 'webrain'
import {IDoc} from '../../../../../../main/common/pouchdb/contracts'
import {PouchDbController} from '../../../../../../main/common/pouchdb/PouchDbController'
import {IPost, ITag} from './contracts'
import * as generate from './generate'

export function equalDocs(o1, o2): boolean {
	if (o1 == null || o2 == null) {
		// eslint-disable-next-line eqeqeq
		return o1 == o2
	}

	for (const key in o1) {
		if (key !== '_id'
			&& key !== '_rev'
			&& Object.prototype.hasOwnProperty.call(o1, key)
			&& o1[key] !== o2[key]
		) {
			return false
		}
	}
	for (const key in o2) {
		if (key !== '_id'
			&& key !== '_rev'
			&& Object.prototype.hasOwnProperty.call(o2, key)
			&& !Object.prototype.hasOwnProperty.call(o1, key)
		) {
			return false
		}
	}

	return true
}

async function profiling<T>(name: string, func: () => T) {
	const time = performanceNow()
	const result = await func()
	console.log(name + ': ' + (performanceNow() - time) + ' ms')
	return result
}

export async function initDb(
	db: PouchDbController,
) {
	await db.createIndex('type')
	return db
}

export async function generateData(rnd: Random, db: PouchDbController, countTags: number, countPosts: number) {
	let existsTagsIds
	try {
		existsTagsIds = (await db.db.query('type', {
			key: 'tag',
		}))
			.rows
			.map(o => o.id)
	} catch (ex) {
		console.error(ex.stack || ex + '')
		throw new Error(ex.stack || ex + '')
	}

	return generate.generate(rnd, existsTagsIds, countTags, countPosts)
}

// 100000 posts и 1000 tags
// 122 МБ            : 1280 bytes per post
// Creating          : 74  sec = 1350 per second
// Replicate to local: 354 sec =  282 per second
export async function fillDb(rnd: Random, db: PouchDbController, countTags: number, countPosts: number) {
	const {tags, posts} = await generateData(rnd, db, countTags, countPosts)

	await profiling('fillDb', () => db.db.bulkDocs(((tags || []) as IDoc[]).concat(posts || [])))
}

export async function fillDbRandom(rnd: Random, db: PouchDbController, countTags: number, countPosts: number) {
	const {tags, posts} = await generateData(rnd, db, countTags, countPosts)
	const docs: Array<ITag|IPost> = ((tags || []) as Array<ITag|IPost>)
		.concat(posts || [])
		.sort(() => rnd.nextBoolean() ? 1 : -1)

	await profiling('fillDbRandom', async () => {
		let i = 0
		let changeCount = 0
		while (i < docs.length) {
			const bulkSize = rnd.nextInt(1, Math.min(docs.length - i, 3) + 1)
			let bulkDocs = docs.slice(i, i + bulkSize)
			i += bulkSize
			await db.db.bulkDocs(bulkDocs)

			for (let j = 0; j < changeCount; j++) {
				bulkDocs = (await db.allDocs<ITag|IPost>({
					keys        : bulkDocs.map(o => o._id),
					include_docs: true,
				}))
					.rows
					.filter(o => o.doc)
					.map(o => {
						switch (o.doc.type) {
							case 'tag':
								o.doc.name = '_' + o.doc.name
								break
							case 'post':
								if (rnd.nextBoolean()) {
									o.doc.title = '_' + o.doc.title
									o.doc.text = '_' + o.doc.text
								} else {
									(o.doc as any)._deleted = true
								}
								break
							default:
								throw new Error(`Unknown doc type: ${o.doc.type}`)
						}

						return o.doc
					})

				if (!bulkDocs.length) {
					break
				}

				await db.db.bulkDocs(bulkDocs)
			}

			changeCount++
			if (changeCount > 2) {
				changeCount = 0
			}
		}
	})
}

export async function changeDd(rnd: Random, db: PouchDbController, count: number) {
	const existsTagsIds = (await db.db.query('type', {
		key: 'tag',
	}))
		.rows
		.map(o => o.id)

	assert.ok(existsTagsIds.length >= 5)

	await profiling(`changeDd (${count})`, async () => {
		const addCount = rnd.nextInt(count / 2)
		const changeCount = count - addCount

		const docs = await db.db.query<ITag|IPost>('type', {
			limit       : changeCount,
			key         : 'post',
			// keys: ['tag', 'post'], // TODO: bug https://github.com/pouchdb/pouchdb/issues/7976
			include_docs: true,
		})

		const docsChanged = docs.rows
			.map(o => {
				switch (o.doc.type) {
					case 'tag':
						o.doc.name = '_' + o.doc.name
						o.doc.weight = Math.max(0, (o.doc.weight || 0) + (rnd.nextBoolean() ? 1 : -1))
						break
					case 'post':
						if (rnd.nextBoolean()) {
							o.doc.title = '_' + o.doc.title
							o.doc.text = '_' + o.doc.text
							o.doc.weight = Math.max(0, (o.doc.weight || 0) + (rnd.nextBoolean() ? 1 : -1))
						} else {
							(o.doc as any)._deleted = true
						}
						break
					default:
						throw new Error(`Unknown doc type: ${o.doc.type}`)
				}

				return o.doc
			})

		if (existsTagsIds.length > 0) {
			for (let i = 0; i < addCount; i++) {
				docsChanged.push(generate.post(rnd, existsTagsIds) as any)
			}
		}

		Random.arrayShuffle(docsChanged, () => rnd.next())

		await db.db.bulkDocs(docsChanged)
	})
}
