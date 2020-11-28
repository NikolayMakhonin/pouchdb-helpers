export function uuidSimple() {
	// на 1 400 000 элементов вероятность наличия совпадения = 1/1000
	return Math.round(Number.MAX_SAFE_INTEGER * Math.random()).toString(36)

	// Совпадения могут быть если делать 45 записей в секунду.
	// return Math.round((Math.round(Date.now() / 1000) + Math.random()) * 1000000).toString(36)
}

export function uuid() {
	// на 1 400 000 элементов вероятность наличия совпадения = 1/1000
	return Math.round(Number.MAX_SAFE_INTEGER * Math.random()).toString(36)

	// Совпадения могут быть если делать 45 записей в секунду.
	// return Math.round((Math.round(Date.now() / 1000) + Math.random()) * 1000000).toString(36)
}

export function arrayToObject(array: string[]): { [key: string]: boolean } {
	if (!array) {
		return null
	}

	const object = {}
	for (let i = 0, len = array.length; i < len; i++) {
		object[array[i]] = true
	}

	return object
}

export function isNegative(value: number): boolean {
	if (value === 0) {
		value = 1 / value
	}
	return value < 0
}

const convertBuffer = new ArrayBuffer(8)
const convertFloat64Array = new Float64Array(convertBuffer)
const convertUint32Array = new Uint32Array(convertBuffer)

export function float64ToIndexId(value: number): string {
	convertFloat64Array[0] = value == null ? 0 : -value
	let part1 = convertUint32Array[0]
	let part2 = convertUint32Array[1]
	if (isNegative(value)) {
		part2 = 0x7fffffff - part2
		part1 = 0xffffffff - part1
	}
	return part2.toString(36).padStart(7, '0') + part1.toString(36).padStart(7, '0')
}
