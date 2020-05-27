/* eslint-disable no-shadow */
const {run, singleCall} = require('../helpers/helpers')
const builds = require('./builds')

const testMochaSrc = singleCall(coverage => run(
	`${coverage ? 'nyc ' : ''}mocha --allow-natives-syntax --opts ./env/mocha/configs/babel/mocha.opts --bail ./src/test/tests/{node,common}/**/*.*`,
	{env: {APP_CONFIG: 'dev'}}
))
const testMochaMjs = singleCall(async (appConfigType, coverage, options = {}) => {
	if (options.build !== false) {
		await builds.buildMjs(appConfigType)
	}
	await run(
		`${coverage ? 'nyc ' : ''}mocha --allow-natives-syntax --opts ./env/mocha/configs/babel/mocha.opts --bail ./dist/${appConfigType}/mjs/test/tests/{node,common}/**/*.*`,
		{env: {APP_CONFIG: appConfigType}}
	)
})
const testMochaJs = singleCall(async (appConfigType, coverage, options = {}) => {
	if (options.build !== false) {
		await builds.buildJs(appConfigType)
	}
	await run(
		// `${coverage ? 'nyc ' : ''}mocha --allow-natives-syntax --opts ./env/mocha/configs/babel/mocha.opts --bail ./dist/${appConfigType}/js/test/tests/{node,common}/**/*.*`,
		`${coverage ? 'nyc ' : ''}mocha --allow-natives-syntax --opts ./env/mocha/configs/no-babel/mocha.opts --bail ./dist/${appConfigType}/js/test/tests/{node,common}/**/*.*`,
		{env: {APP_CONFIG: appConfigType}}
	)
})
const testMocha = singleCall((appConfigType, coverage, options = {}) => Promise.all([
	testMochaSrc(appConfigType, coverage),
	testMochaMjs(appConfigType, coverage, options),
	testMochaJs(appConfigType, coverage, options),
]))

const testIntern = singleCall(async (appConfigType, options = {}) => {
	if (options.build !== false) {
		await builds.build(appConfigType)
	}
	await run(
		'mocha --opts env/intern/mocha.opts ./env/intern/configs/export/mocha.js --bail',
		{env: {APP_CONFIG: appConfigType}}
	)
})
const coverageKarma = singleCall(async (appConfigType, options = {}) => {
	if (options.build !== false) {
		await builds.build(appConfigType)
	}
	await run(
		'karma start ./env/karma/configs/coverage.js',
		{env: {APP_CONFIG: appConfigType}}
	)
})
const coverageMocha = singleCall((appConfigType, options = {}) => testMocha(appConfigType, true, options))
const coverageMerge = singleCall(appConfigType => run(`istanbul-combine -d tmp/common/coverage/all/lcov -p summary -r lcov tmp/${appConfigType}/coverage/*/json/**.json`))
const coverageCheck = singleCall(appConfigType => run(
	`nyc check-coverage --report-dir tmp/${appConfigType}/coverage/all/lcov --lines 1 --functions 1 --branches 1`,
	{env: {APP_CONFIG: appConfigType}}
))
const coverage = singleCall(async (appConfigType, options = {}) => {
	await Promise.all([
		coverageMocha(appConfigType, options),
		coverageKarma(appConfigType, options),
	])
	await coverageMerge(appConfigType)
	await coverageCheck(appConfigType)
})

module.exports = {
	testMochaSrc,
	testMochaMjs,
	testMochaJs,
	testMocha,
	testIntern,
	coverageKarma,
	coverageMocha,
	coverageMerge,
	coverageCheck,
	coverage,
}
