export function Base64(digitsStr
// 0       8       16      24      32      40      48      56     63
// v       v       v       v       v       v       v       v      v
= '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz+/') {
	const digits = digitsStr.split('')
	const digitsMap = {}
	for (let i = 0; i < digits.length; i++) {
		digitsMap[digits[i]] = i
	}

	this.fromInt = function (int32) {
		let result = ''
		while (true) {
			result = digits[int32 & 0x3f] + result
			int32 >>>= 6
			if (int32 === 0) {
				break
			}
		}
		return result
	}

	this.toInt = function (str) {
		let result = 0
		for (let i = 0; i < str.length; i++) {
			result = (result << 6) + digitsMap[str.charAt(i)]
		}
		return result
	}
}
