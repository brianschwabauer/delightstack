// prepareSql and its types live in @delightstack/utilities so packages that
// only need safe SQL composition (e.g. @delightstack/auth) don't have to
// depend on this package. Re-exported here for backwards compatibility.
export {
	prepareSql,
	type SqlTaggedTemplate,
	type SqlPreparedQuery,
	type SqlQueryFn,
} from '@delightstack/utilities';
