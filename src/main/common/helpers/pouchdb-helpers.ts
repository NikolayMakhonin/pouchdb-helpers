import {Base64} from './base64'

const base64 = new Base64()

let lastId = 0
export function generateId(userId = 0) {
	return base64.fromInt(++userId)
		+ '-' + base64.fromInt(new Date().getTime())
		+ '-' + base64.fromInt(++lastId)
		+ '-' + base64.fromInt(Math.random() * Number.MAX_SAFE_INTEGER)
}
