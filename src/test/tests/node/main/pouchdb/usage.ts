import {float64ToIndexId} from '../../../../../main/common/pouchdb/helpers'
import {PouchDbController} from '../../../../../main/common/pouchdb/PouchDbController'

const testId = Math.random().toString(36).replace('.', '')

describe('common > main > pouchdb > usage', function () {
	it('base', async function () {
		const db = new PouchDbController({
			name   : `tmp/pouchdb/${testId}/test`,
			options: {
				revs_limit: 1,
			},
		})

		db.db.put({
			_id  : 'test_id_1',
			value: 'value_1',
		})

		const doc = await db.get('test_id_1') as any

		assert.strictEqual(doc.value, 'value_1')

		db.destroy()
	})
})
