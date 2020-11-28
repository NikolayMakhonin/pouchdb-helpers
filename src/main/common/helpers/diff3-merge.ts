import diff3 from './diff3/diff3'

export function diff3mergeArr(baseArr, oldArr, newArr) {
	const hunks = diff3(oldArr, baseArr, newArr)

	const result = []
	for (let i = 0, len = hunks.length; i < len; i++) {
		const hunk = hunks[i]
		if (hunk.ok) {
			result.push.apply(result, hunk.ok)
		} else {
			result.push(hunk.conflict.b)
		}
	}

	return result
}

export function splitLetters(str) {
	return str
}

export function splitWords(str) {
	return str.match(/\s+|\S+/g)
}

export function splitPhrases(str) {
	return str.match(/[,;:.\n\t]+\s*|[^,;:.\n\t]+/g)
}

export function splitSentences(str) {
	return str.match(/[;.\n]+|[^;.\n]+/g)
}

export function splitLines(str) {
	return str.match(/[\n]+|[^\n]+/g)
}

export function diff3mergeStr(baseStr, oldStr, newStr, splitFunc = splitLetters) {
	const result = diff3mergeArr(
		splitFunc(baseStr),
		splitFunc(oldStr),
		splitFunc(newStr),
	)

	return result.join('')
}
