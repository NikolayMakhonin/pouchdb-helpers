import {LogEntry} from '@theintern/leadfoot/index'
import browserDebug from '@flemist/browser-debug'
import {TLog, TLogPredicate} from './contracts'
import {iter, resolveAll, run, runWithRootCommand} from './run'

export const getAllLogs = iter(function *getAllLogs(): Iterator<any, TLog[]> {
	const logTypes: string[] = yield run(o => o.getAvailableLogTypes())
	const result: TLog[][] = yield resolveAll(logTypes
		.map(logType => runWithRootCommand(function *_getAllLogs() {
			const logs = yield run(o => o.getLogsFor(logType))
			return logs.map((log: LogEntry) => {
				(log as any).type = logType
				try {
					const message = JSON.parse(log.message)
					const keys = Object.keys(message)
					if (keys.length === 1) {
						log.message = message[keys[0]]
					} else {
						log.message = message
					}
				} catch (ex) {
					// empty
				}
				return log
			})
		})),
	)

	return result
		.flatMap(o => o)
})

export const printAllLogs = iter(function *printAllLogs(predicate: TLogPredicate) {
	let logs = yield getAllLogs()
	if (predicate) {
		logs = logs.filter(predicate)
	}
	if (logs.length) {
		console.log(JSON.stringify(logs, null, 4))
	}
})

/* eslint-disable */

function dataToLog(getDataScript) {
	var data = eval(getDataScript)
	return data
}

/* eslint-enable */

// eslint-disable-next-line @typescript-eslint/ban-types
export const logRemote = iter(function *logRemote(prefix: string, remoteGetDataScript: Function|string) {
	const log = yield run(o => o.execute(dataToLog, [`(${remoteGetDataScript.toString()})();`]))
	console.log(prefix, log)
})

export const getHtml = iter(function *getHtml(): Iterator<any, string> {
	return yield run(o => o.execute(function () {
		// eslint-disable-next-line no-undef
		return new XMLSerializer().serializeToString(document)
	}))
})

export const getUserAgent = iter(function *getUserAgent(): Iterator<any, string> {
	return yield run(o => o.execute(function () {
		// eslint-disable-next-line no-undef
		return navigator.userAgent
	}))
})

export const getDebugInfo = iter(function *getDebugInfo() {
	return yield run(o => o.execute(browserDebug.getDebugInfo))
})

export const printDebugInfo = iter(function *printDebugInfo(): Iterator<any, void> {
	const [logs, userAgent, html, debugInfo] = (yield resolveAll([
		getAllLogs,
		getUserAgent,
		getHtml,
		getDebugInfo,
	].map(runWithRootCommand))) as any

	console.debug(`--------------- Debug Info: ---------------\n${JSON.stringify({
		logs,
		userAgent,
		html: (html || '').substring(0, 1000),
		debugInfo,
	}, null, 4)}\n---------------   Error:   ---------------`)
})
