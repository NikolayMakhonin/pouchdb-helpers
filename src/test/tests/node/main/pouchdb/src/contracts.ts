import {IDoc, ITypedDoc} from '../../../../../../main/common/pouchdb/contracts'

export enum DocType {
	Tag = 'tag',
	Post = 'post',
}

export interface ITag extends ITypedDoc {
	type: DocType.Tag,
	name: string,
	tags: string
	weight: number,
}

export interface IPost extends ITypedDoc {
	type: DocType.Post,
	tags: string,
	title: string,
	text: string,
	weight: number,
}

export interface ITagsIndex extends IDoc {
	weight: number,
}

export interface IIndexSource {
	_id?: string,
	type: DocType
	tags: string
	weight: number
}
