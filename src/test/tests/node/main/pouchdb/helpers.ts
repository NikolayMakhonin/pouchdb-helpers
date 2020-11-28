import {float64ToIndexId} from '../../../../../main/common/pouchdb/helpers'

describe('common > main > pouchdb > helpers', function () {
	function checkValues(v1, v2) {
		const s1 = float64ToIndexId(v1)
		const s2 = float64ToIndexId(v2)
		if ((v1 < v2) !== (s1 < s2)) {
			throw new Error(`${v1} (${s1}) ${v1 < v2 ? '>' : '<'}= ${v2} (${s2})`)
		}
	}

	it('float64ToIndexId', async function () {
		checkValues(0, -0)
		checkValues(0, Infinity)
		checkValues(0, -Infinity)
		checkValues(-0, Infinity)
		checkValues(-0, -Infinity)
		checkValues(Infinity, -Infinity)

		let prevValue = Number.MIN_VALUE
		while (Number.isFinite(prevValue)) {
			// console.log(`${prevValue} (${prevStr})`)
			const value = prevValue * 1.5

			checkValues(0, prevValue)
			checkValues(0, -prevValue)
			checkValues(-0, prevValue)
			checkValues(-0, -prevValue)
			checkValues(Infinity, prevValue)
			checkValues(Infinity, -prevValue)
			checkValues(-Infinity, prevValue)
			checkValues(-Infinity, -prevValue)
			checkValues(value, prevValue)
			checkValues(value, -prevValue)
			checkValues(-value, prevValue)
			checkValues(-value, -prevValue)

			prevValue = value
		}
	})
})
