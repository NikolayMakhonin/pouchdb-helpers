export {
	diff3mergeStr,
	diff3mergeArr,
	splitWords,
	splitLetters,
	splitLines,
	splitPhrases,
	splitSentences,
} from './helpers/diff3-merge'
export { Base64 } from './helpers/base64'
export { generateId } from './helpers/pouchdb-helpers'
export type {
	IDoc,
	ITypedDoc,
} from './pouchdb/contracts'
export {
	isNegative,
	float64ToIndexId,
	uuid,
} from './pouchdb/helpers'
export {
	IndexDb,
	UpdateIndexAction,
	INDEX_DB_SUFFIX,
	INDEX_SOURCE_PREFIX,
	INDEX_STATE_ID,
	INDEX_UUID,
} from './pouchdb/IndexDb'
export type {
	IIndexOptions,
	IIndexState,
} from './pouchdb/IndexDb'
export {
	PouchDbController,
} from './pouchdb/PouchDbController'
export type {
	AllDocsResponse,
	AllDocsResponseRow,
} from './pouchdb/PouchDbController'
