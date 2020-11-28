const colors = require('kleur')
const { removeColor, createColorRegexp } = require('@flemist/run-script')

const errorTextRegExp = /[^\r\n]*(\b[1-9]\d* *(fail|err)|[✗×]|fatal error|error occur)[^\r\n]*/i
const errorColorRegExp = createColorRegexp([
	// colors.bold,
	colors.red,
	colors.magenta,
	// colors.yellow,
	colors.bgRed,
	colors.bgMagenta,
	// colors.bgYellow,
])

module.exports = {
	logFilter(_text, next) {
		const text = removeColor(_text)

		// sapper export
		if (/\s{4,}\S\s[^\w\r\n]*node_modules/.test(text)) {
			return false
		}

		// Empty space
		if (/^\s*$/s.test(text)) {
			return false
		}


		if (/\[webpack\.Progress]/.test(text)) {
			return false
		}

		return next(text)
	},

	stdOutSearchError(_text, next) {
		const errorColor = _text.match(errorColorRegExp)
		text = removeColor(_text)

		if (errorColor
			// at least 10 letters
			&& (/(\w\W*){10,}/s).test(text)
			&& !/√/s.test(text)
			// electron-builder
			&& !/[┌│]/s.test(text)
			// sapper: "189 kB client.905ef984.js"
			&& !(/\b\d+\s+\w+\s+\S+\.js\b/.test(text) && text.length < 100)
			&& !/\[WEBPACK]/.test(text)
		) {
			return `ERROR COLOR: ${errorColor[0]}`
		}

		const errorText = text.match(errorTextRegExp)
		if (errorText) {
			return `ERROR TEXT: ${errorText[0]}`
		}

		return false
	},

	stdErrIsError(_text, next) {
		text = removeColor(_text)

		if (text.length < 20) {
			return false
		}

		if (/openssl config failed/.test(text)) {
			return false
		}

		// web storm
		if (/Debugger attached|Debugger listening on|Waiting for the debugger|nodejs.*inspector/.test(text)) {
			return false
		}

		// rollup
		if (/treating it as an external dependency|\bcreated\b.*\.js in \d|\bFinished in\b/.test(text)) {
			return false
		}
		if (text.indexOf('→') >= 0) {
			return false
		}

		// someone package is outdated
		if (/\bnpm update\b/.test(text)) {
			return false
		}

		// terminate process
		if (/^\^[A-Z]$/.test(text)) {
			return false
		}

		// experimental warnings
		if (/ExperimentalWarning: Conditional exports is an experimental feature/.test(text)) {
			return false
		}
		if (/ExperimentalWarning: Package name self resolution is an experimental feature/.test(text)) {
			return false
		}

		// mongo
		if (/DeprecationWarning: current Server Discovery and Monitoring engine is deprecated/.test(text)) {
			return false
		}

		// Entry module "rollup.config.js" is implicitly using "default" export mode, which means for CommonJS output that its default export is assigned to "module.exports". For many tools, suc
		// h CommonJS output will not be interchangeable with the original ES module. If this is intended, explicitly set "output.exports" to either "auto" or "default", otherwise you might want
		//  to consider changing the signature of "rollup.config.js" to use named exports only.
		if (/explicitly set "output.exports" to either "auto" or "default"/.test(text)) {
			return false
		}

		if (/\[webpack\.Progress]/.test(text)) {
			return false
		}

		return next(text)
	},
}
