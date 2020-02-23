"use strict";

/* tslint:disable:no-var-requires */
// @ts-ignore
var nodeFetch = require('node-fetch'); // @ts-ignore


var SparkMD5 = require('spark-md5'); // @ts-ignore


var html = require('html-escaper');

var DiskCache = require('async-disk-cache'); // don't mix require and import/export; see: https://github.com/rollup/rollup/issues/1058#issuecomment-254187433


module.exports = {
  SparkMD5: SparkMD5,
  html: html,
  DiskCache: DiskCache,
  nodeFetch: nodeFetch
};