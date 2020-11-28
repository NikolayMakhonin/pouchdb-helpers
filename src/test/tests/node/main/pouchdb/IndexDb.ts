/* tslint:disable:no-identical-functions no-shadowed-variable */
import {objectToString} from '@flemist/web-logger'
// @ts-ignore
import {
	performanceNow,
	Random,
} from 'webrain'
// import {
// 	Assert,
// } from 'webrain/dist/mjs/main/common/test/Assert.js'
import {
	INDEX_SOURCE_PREFIX,
	INDEX_STATE_ID,
	IndexDb,
	UpdateIndexAction,
} from '../../../../../main/common/pouchdb/IndexDb'
import {PouchDbController} from '../../../../../main/common/pouchdb/PouchDbController'
import {DocType, IIndexSource, IPost, ITag, ITagsIndex} from './src/contracts'
import {changeDd, equalDocs, fillDb, fillDbRandom, initDb} from './src/helpers'
import fse from 'fs-extra'
import path from 'path'

const testId = Math.random().toString(36).replace('.', '')

describe('common > main > pouchdb > IndexDb', function () {
	this.timeout(24 * 60 * 60 * 1000)

	const db = new PouchDbController({
		name: `tmp/pouchdb/${testId}/test`,
	})

	const indexDb = new IndexDb<ITag|IPost, IIndexSource>({
		sourceDb: db,
		name    : 'tagsSets',
		getSource,
	})
		.addIndex<ITagsIndex>({
			getIndexesIds(doc) {
				return doc.type === DocType.Tag || doc.type === DocType.Post
					? ['tags_' + doc.tags]
					: null
			},
			createIndex(indexId, doc) {
				if (doc.weight === 0) {
					return null
				}

				return {
					_id   : indexId,
					weight: doc.weight,
				}
			},
			updateIndex(index, doc, prevDoc) {
				assert.notOk(doc && (doc as any)._deleted, 'doc is deleted')
				assert.notOk(prevDoc && (prevDoc as any)._deleted, 'prevDoc is deleted')

				const oldValue = (index.weight || 0)
				let newValue = oldValue

				if (doc && prevDoc) {
					newValue = newValue + (doc.weight || 0) - (prevDoc.weight || 0)
				} else if (doc) {
					newValue += (doc.weight || 0)
				} else if (prevDoc) {
					newValue -= (prevDoc.weight || 0)
				}

				assert.ok(newValue >= 0, `newValue (${newValue}) < 0`)

				if (newValue === oldValue) {
					return null
				}

				index.weight = newValue

				return newValue ? UpdateIndexAction.Update : UpdateIndexAction.Delete
			},
		})

	after(async function () {
		await clear()
		fse.rmdirSync(`tmp/pouchdb/${testId}`, { recursive: true })
	})

	async function fill(rnd: Random, countTags: number, countPosts: number) {
		await fillDb(rnd, db, countTags, countPosts)
		const all = await db.db.allDocs()
		assert.ok(all.total_rows > countTags + countPosts)
	}

	async function fillRandom(rnd: Random, countTags: number, countPosts: number) {
		const prevCount = (await db.db.allDocs()).total_rows
		await fillDbRandom(rnd, db, countTags, countPosts)
		const all = await db.db.allDocs()
		assert.ok(all.total_rows > prevCount)
	}

	async function change(rnd: Random, count: number) {
		await changeDd(rnd, db, count)
	}

	async function updateWithError(bulkLimit: number) {
		(indexDb as any)._simulateError = true
		let error
		try {
			await (indexDb as any)._update(bulkLimit)
		} catch (err) {
			error = err
		} finally {
			(indexDb as any)._simulateError = false
		}
		assert.ok(error)
		if (error.constructor !== Error) {
			console.error('error: ', error)
			assert.strictEqual(error.constructor, Error)
		}
		assert.strictEqual(error.message, 'Simulated error')
	}

	async function update(bulkLimit: number) {
		const result = await (indexDb as any)._update(bulkLimit)
		return result
	}

	it('fillDb', async function () {
		const rnd = new Random(1)
		await init()
		await fill(rnd, 5, 100)
	})

	function getSource(doc): IIndexSource {
		return doc.type === DocType.Tag || doc.type === DocType.Post
			? {
				type  : doc.type,
				tags  : doc.tags,
				weight: doc.weight,
			}
			: null
	}

	async function checkIndexDb<TDoc, TSource>(indexDb: IndexDb<TDoc, TSource>) {
		const sourceInfo = await indexDb.sourceDb.db.info()
		const sourceSeq = sourceInfo.update_seq
		const indexInfo = await indexDb.indexDb.db.info()
		const indexState = await indexDb.getState()

		assert.notOk(indexState.rollback)

		const docsMap = {}
		const docs = (await indexDb.sourceDb.db.query<ITag|IPost>('type', {
			keys        : ['tag', 'post'],
			include_docs: true,
		}))
			.rows
			.map(o => {
				const source = getSource(o.doc)
				if (source) {
					source._id = o.id
				}
				return source
			})
			.filter(o => o && o.weight)
			.map(o => {
				docsMap[o._id] = o
				return o
			})

		const prevDocsMap = {}
		const prevDocs = []

		const indexesMap = {}
		const indexes = []

		const indexItemsMap = {}
		const indexItems = (await indexDb.indexDb.db.allDocs<ITag|IPost|ITagsIndex>({
			include_docs: true,
		}))
			.rows
			.filter(o => o.doc._id !== INDEX_STATE_ID && o.doc.weight)
			.map(o => {
				indexItemsMap[o.doc._id] = o.doc
				if (o.doc._id.startsWith(INDEX_SOURCE_PREFIX)) {
					o.doc._id = o.doc._id.substring(INDEX_SOURCE_PREFIX.length)
					prevDocsMap[o.doc._id] = o.doc
					prevDocs.push(o.doc)
				} else {
					indexesMap[o.doc._id] = o.doc
					indexes.push(o.doc)
				}
				return o.doc
			})

		assert.strictEqual(Object.keys(indexItemsMap).length, indexItems.length)
		assert.strictEqual(Object.keys(docsMap).length, docs.length)
		assert.ok(sourceInfo.update_seq >= indexState.update_seq)

		if (sourceInfo.update_seq === indexState.update_seq) {
			if (prevDocs.length !== docs.length) {
				assert.strictEqual(prevDocs.length, docs.length)
			}
			for (let i = 0, len = docs.length; i < len; i++) {
				const doc = docs[i]
				const prevDoc = prevDocsMap[doc._id]
				if (!equalDocs(doc, prevDoc)) {
					assert.fail('doc != prevDoc')
				}
			}
		}

		const checkIndexesMap = {}
		for (let i = 0, len = prevDocs.length; i < len; i++) {
			const prevDoc = prevDocs[i]
			assert.ok(prevDoc.weight >= 0)
			if (prevDoc.weight !== 0) {
				const indexId = 'tags_' + prevDoc.tags
				let index = checkIndexesMap[indexId]
				if (!index) {
					checkIndexesMap[indexId] = index = {weight: prevDoc.weight}
				} else {
					index.weight += prevDoc.weight
				}
			}
		}

		assert.strictEqual(indexes.length, Object.keys(checkIndexesMap).length)
		for (let i = 0, len = indexes.length; i < len; i++) {
			const index = indexes[i]
			const checkIndex = checkIndexesMap[index._id]
			if (!equalDocs(index, checkIndex)) {
				// console.log(checkIndex.weight - index.weight)
				assert.fail('index != checkIndex')
			}
		}
	}

	async function clear() {
		if (indexDb) {
			await indexDb.clear()
		}
		if (db) {
			await db.destroy()
		}
	}

	async function init() {
		await clear()
		await initDb(db)
	}

	async function randomTest<TMetrics = any>({
		name,
		iterations,
		testFunc,
		compareMetrics,
		customSeed,
		metricsMin,
	}: {
		name: string,
		iterations: number,
		testFunc: (seed: number, metrics: TMetrics, metricsMin: TMetrics) => void | Promise<void>,
		compareMetrics: (metrics1, metrics2) => boolean,
		customSeed?: number,
		metricsMin?: TMetrics,
	}) {
		const testCasesFile = path.resolve(`./tmp/pouchdb/_TestCases/${name}.txt`)
		const testCasesDir = path.dirname(testCasesFile)
		if (!await fse.pathExists(testCasesDir)) {
			await fse.mkdir(testCasesDir)
		}
		await fse.writeFile(testCasesFile, '')

		let i = 0
		let seedMin = null
		let errorMin = null
		let reportMin = null
		while (true) {
			const seed = customSeed != null ? customSeed : new Random().nextInt(2 << 29)
			const metrics = {} as TMetrics

			try {
				await testFunc(seed, metrics, metricsMin || {} as any)
			} catch (error) {
				if (customSeed != null) {
					console.log(`customSeed: ${customSeed}`, metrics)
					throw error
				} else if (errorMin == null || compareMetrics(metrics, metricsMin)) {
					metricsMin = metrics
					seedMin = seed
					errorMin = error
					reportMin = `\r\n\r\ncustomSeed: ${
						seedMin
					},\r\nmetricsMin: ${
						JSON.stringify(metricsMin)
					},\r\n${
						errorMin.stack || errorMin
					}`
					console.log(reportMin)
					await fse.appendFile(
						testCasesFile,
						reportMin,
					)
				}
			}

			i++
			if (customSeed != null || i >= iterations) {
				if (errorMin) {
					console.log(reportMin)
					throw errorMin
				} else {
					return
				}
			}
		}
	}

	// region throwOnConsoleError

	let lastConsoleError = null
	async function throwOnConsoleError(level: 'error'|'warn', func) {
		lastConsoleError = null
		const origConsoleError = console.error
		const origConsoleWarn = console.warn
		try {
			console.error = function () {
				lastConsoleError = Array.from(arguments)
				origConsoleError.apply(this, arguments)
				throw Array.from(arguments).map(o => objectToString(o)).join('\r\n')
			}
			if (level === 'warn') {
				console.warn = function () {
					lastConsoleError = Array.from(arguments)
					origConsoleWarn.apply(this, arguments)
					throw Array.from(arguments).map(o => objectToString(o)).join('\r\n')
				}
			}

			const result = await func()

			if (lastConsoleError) {
				throw lastConsoleError
			}

			return result
		} finally {
			console.error = origConsoleError
			console.warn = origConsoleWarn
		}
	}

	// endregion

	it('stress test with search best error', async function () {
		await randomTest({
			name          : 'CustomIndex simple',
			iterations    : 10,
			// customSeed: 6525760,
			// metricsMin: {'changes':7,'changesTotal':35,'updatesTotal':43,'step':3,'updatesMax':16,'iter':4,'updatesLast':2},
			compareMetrics: (o1, o2) => {
				if (o1.step !== o2.step) {
					return o1.step < o2.step
				}
				if (o1.iter !== o2.iter) {
					return o1.iter < o2.iter
				}
				if (o1.changes !== o2.changes) {
					return o1.changes < o2.changes
				}
				if (o1.updatesMax !== o2.updatesMax) {
					return o1.updatesMax < o2.updatesMax
				}
				if (o1.updatesLast !== o2.updatesLast) {
					return o1.updatesLast < o2.updatesLast
				}
				if (o1.updatesTotal !== o2.updatesTotal) {
					return o1.updatesTotal < o2.updatesTotal
				}
				return true
			},
			async testFunc(seed, metrics, metricsMin) {
				await throwOnConsoleError('warn', async () => {
					const rnd = new Random(seed)

					let step = 0
					metrics.changes = 0
					metrics.changesTotal = 0
					metrics.updatesTotal = 0
					metrics.step = ++step
					await init()
					await indexDb.update(10)
					await checkIndexDb(indexDb)

					metrics.step = ++step
					await fillRandom(rnd, 5, 0)
					await indexDb.update(10)
					await checkIndexDb(indexDb)

					metrics.step = ++step
					const changes = rnd.nextInt(
						1,
						metrics.changes && Math.min(metrics.changes * (metricsMin.iter > 1 ? 2 : 1), 10)
						|| 10,
					)
					metrics.changes = changes
					metrics.updatesMax = 0
					for (let i = 0; i <= (metricsMin.iter || 100); i++) {
						metrics.iter = i
						metrics.changesTotal += changes
						await change(rnd, changes)

						const updates = rnd.nextInt(
							1,
							i === metricsMin.iter && metricsMin.updatesLast
							|| metrics.updatesMax && Math.min(metrics.updatesMax * (metricsMin.iter > 1 ? 2 : 1), 21)
							|| 21,
						)
						metrics.updatesLast = updates
						metrics.updatesTotal += updates
						metrics.updatesMax = Math.max(metrics.updatesMax, updates)

						if (rnd.nextBoolean()) {
							metrics.updatesTotal++
							await updateWithError(updates)
						}
						const result = await update(updates)

						if (result < updates) {
							await checkIndexDb(indexDb)
						}
					}

					metrics.step = ++step
					await indexDb.update(10)
					await checkIndexDb(indexDb)
				})
			},
		})
	})

	xit('CustomIndex simple', async function () {
		const rnd = new Random()

		await init()
		await indexDb.update(10)
		await checkIndexDb(indexDb)

		await fillRandom(rnd, 5, 0)
		await indexDb.update(10)
		await checkIndexDb(indexDb)

		// for (let i = 0; i < 500; i++) {
		// 	console.log(i)
		// 	await fillRandom(rnd, 0, 2)
		// 	await indexDb.update(10)
		// 	await checkIndexDb(indexDb)
		// }

		await fillRandom(rnd, 0, 50)
		await indexDb.update(10)
		await checkIndexDb(indexDb)

		for (let i = 0; i < 100; i++) {
			await change(rnd, 10)
			const bulkLimit = rnd.nextInt(1, 21)
			// @ts-ignore
			const result = await indexDb._update(bulkLimit)
			if (result < bulkLimit) {
				await checkIndexDb(indexDb)
			}
		}

		await indexDb.update(10)
		await checkIndexDb(indexDb)
	})

	xit('CustomIndex stress test', async function () {
		const rnd = new Random()

		await init()
		await indexDb.update(10)
		await checkIndexDb(indexDb)

		await fillRandom(rnd, 5, 0)
		await indexDb.update(10)
		await checkIndexDb(indexDb)

		await fillRandom(rnd, 0, 50)
		await indexDb.update(10)
		await checkIndexDb(indexDb)

		let changedItems = 0
		let handledItems = 0
		const timeStart = performanceNow()
		for (let i = 0; i < 1000; i++) {
			await change(rnd, 10)
			changedItems += 10
			// @ts-ignore
			handledItems += (await indexDb._update(rnd.nextInt(1, 21))) || 0
			await checkIndexDb(indexDb)
		}
		await indexDb.update(100)
		const duration = performanceNow() - timeStart

		console.log(`changedItems = ${changedItems}`)
		console.log(`handledItems = ${handledItems}`)
		console.log(`duration = ${duration} ms`)
		console.log(`duration per changed item = ${duration / changedItems} ms`)
		console.log(`duration per handled item = ${duration / handledItems} ms`)
	})

	xit('CustomIndex performance test', async function () {
		const rnd = new Random()

		await init()
		await indexDb.update(10)
		await checkIndexDb(indexDb)

		const countTags = 1000
		const countPosts = 20000
		const changedItems = 1000

		const time0 = performanceNow()
		await fillRandom(rnd, countTags, countPosts)
		console.log('fill completed')
		const time1 = performanceNow()
		const fillHandledItems = await indexDb.update(1000)
		console.log('fill index completed')
		const time2 = performanceNow()
		await db.db.query('type', { key: 'tag' })
		const time3 = performanceNow()
		await change(rnd, changedItems)
		console.log('change completed')
		const time4 = performanceNow()
		const changeHandledItems = await indexDb.update(1000)
		console.log('change index completed')
		const time5 = performanceNow()
		await checkIndexDb(indexDb)
		const time6 = performanceNow()

		const items = countTags + countPosts
		const fillDuration = time1 - time0
		const fillIndexDuration = time2 - time1
		const createTypeIndexDuration = time3 - time2
		const changeDuration = time4 - time3
		const changeIndexDuration = time5 - time4
		const checkDuration = time6 - time5

		console.log(`items = ${items}`)
		console.log(`handledItems = ${fillHandledItems}`)
		console.log(`changedItems = ${changedItems}`)
		console.log(`changedHandledItems = ${changeHandledItems}`)

		console.log(`fill duration = ${fillDuration} ms (${fillDuration / items} ms per item)`)
		console.log(`fill index duration = ${fillIndexDuration} ms (${fillIndexDuration / fillHandledItems} ms per item)`)
		console.log(`create type index duration = ${createTypeIndexDuration} ms (${createTypeIndexDuration / items} ms per item)`)
		console.log(`change duration = ${changeDuration} ms (${changeDuration / changedItems} ms per item)`)
		console.log(`change index duration = ${changeIndexDuration} ms (${changeIndexDuration / changeHandledItems} ms per item)`)
		console.log(`check duration = ${checkDuration} ms`)

		/* NodeJS:
		items = 21000
		handledItems = 21000
		changedItems = 1000
		changedHandledItems = 1000
		fill duration = 21142.059442043304 ms (1.0067647353353955 ms per item)
		fill index duration = 6390.429983973503 ms (0.304306189713024 ms per item)
		create type index duration = 102503.21875596046 ms (4.881105655045737 ms per item)
		change duration = 654.1921920776367 ms (0.6541921920776367 ms per item)
		change index duration = 300.1240919828415 ms (0.3001240919828415 ms per item)
		*/

		/* Browser:
		items = 21000
		handledItems = 21000
		changedItems = 1000
		changedHandledItems = 1000
		fill duration = 394360.34999997355 ms (18.779064285713027 ms per item)
		fill index duration = 8761.205000104383 ms (0.4172002381002087 ms per item)
		create type index duration = 69529.12499988452 ms (3.310910714280215 ms per item)
		change duration = 3660.795000148937 ms (3.660795000148937 ms per item)
		change index duration = 774.3849998805672 ms (0.7743849998805672 ms per item)
		check duration = 12197.080000070855 ms

		From other test:
		100000 posts & 1000 tags
		122 МБ            : 1280 bytes per post
		Creating          : 74  sec = 1350 per second
		Replicate to local: 354 sec =  282 per second
		*/
	})
})
