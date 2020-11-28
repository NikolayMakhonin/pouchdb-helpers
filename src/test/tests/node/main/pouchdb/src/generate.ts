import {Random} from 'webrain'
import {DocType, IPost, ITag} from './contracts'
import * as data from './data'

export function uuid(rnd: Random) {
	// на 1 400 000 элементов вероятность наличия совпадения = 1/1000
	return Math.round(Number.MAX_SAFE_INTEGER * rnd.next()).toString(36)

	// Совпадения могут быть если делать 45 записей в секунду.
	// return Math.round((Math.round(Date.now() / 1000) + rnd.next()) * 1000000).toString(36)
}

export function items<T>(rnd: Random, arr: T[], count: number): T[] {
	const len = arr.length
	if (count > len) {
		throw new Error('Count should be <= ' + len)
	}

	const result = []
	for (let i = 0; i < count; i++) {
		const item = arr[rnd.nextInt(len)]
		result.push(item)
	}
	return result
}

export function uniqueItems<T>(rnd: Random, arr: T[], count: number): T[] {
	const len = arr.length
	if (count > len) {
		throw new Error(`Count (${count}) should be <= ${len}`)
	}

	if (len < count * 2) {
		arr = arr.slice().sort(() => rnd.nextBoolean() ? 1 : -1)
		const result = []
		for (let i = 0; i < count; i++) {
			const item = arr[i]
			result.push(item)
		}
		return result
	} else {
		const result = new Set<T>()
		while (result.size < count) {
			const item = arr[rnd.nextInt(len)]
			if (!result.has(item)) {
				result.add(item)
			}
		}
		return Array.from(result.values())
	}
}

export function words(rnd: Random, count: number) {
	return items(rnd, data.words, count)
}

export function tags(rnd: Random, existTagsIds: string[], count: number) {
	const result = words(rnd, count).map(o => ({
		_id   : uuid(rnd),
		type  : DocType.Tag,
		name  : o,
		weight: 0,
	} as ITag))
	existTagsIds = result.map(o => o._id).concat(existTagsIds)
	result.forEach(o => {
		o.tags = uniqueItems(rnd, existTagsIds, rnd.nextInt(4)).join('_')
	})
	return result
}

const minWords = 3
const avgSymbolsPerText = 550
const avgSymbolsInWord = 4.3
const avgWords = avgSymbolsPerText / avgSymbolsInWord
const maxWords = minWords + (avgWords - minWords) * 2

export function post(rnd: Random, existTagsIds: string[]) {
	return {
		_id   : uuid(rnd),
		type  : DocType.Post,
		tags  : uniqueItems(rnd, existTagsIds, rnd.nextInt(1, Math.min(6, existTagsIds.length))).sort().join('_'),
		title : words(rnd, rnd.nextInt(1, 6)).join(' '),
		text  : words(rnd, rnd.nextInt(minWords, maxWords + 1)).join(' '),
		weight: rnd.nextInt(1, 4),
	} as IPost
}

export function posts(rnd: Random, existTagsIds: string[], count: number) {
	const result: IPost[] = []
	for (let i = 0; i < count; i++) {
		result.push(post(rnd, existTagsIds))
	}
	return result
}

export function generate(rnd: Random, existsTagsIds: string[], countTags: number, countPosts: number) {
	const _tags = countTags ? tags(rnd, existsTagsIds, countTags) : []
	const tagsIds = _tags.map(o => o._id).concat(existsTagsIds)
	const _posts = countPosts ? posts(rnd, tagsIds, countPosts) : []

	return {
		tags : _tags,
		posts: _posts,
	}
}
