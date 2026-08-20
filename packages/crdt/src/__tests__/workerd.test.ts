import { describe, expect, it } from 'vitest';
import { LoroDoc, VersionVector } from '../loro.server.js';

/**
 * Runs inside workerd, against the real `loro-crdt/bundler` build.
 *
 * `loro.server.ts` pins that specifier because the default build throws at
 * module scope in workerd — a failure that surfaces at deploy rather than in a
 * test. The node suite aliases the specifier away, so without this file the
 * pin is proven only by a throwaway spike.
 */
describe('workerd packaging', () => {
	it('loads the module without throwing at module scope', () => {
		expect(typeof LoroDoc).toBe('function');
	});

	it('round-trips a document through a snapshot', () => {
		const author = new LoroDoc();
		author.getText('content').insert(0, 'hello workerd');
		author.commit();

		const reader = new LoroDoc();
		reader.import(author.export({ mode: 'snapshot' }));
		expect(reader.getText('content').toString()).toBe('hello workerd');
	});

	it('merges two peers and converges', () => {
		const a = new LoroDoc();
		const b = new LoroDoc();
		a.getText('content').insert(0, 'alpha ');
		a.commit();
		b.import(a.export({ mode: 'snapshot' }));

		a.getText('content').insert(6, 'from a');
		a.commit();
		b.getText('content').insert(6, 'from b');
		b.commit();

		a.import(b.export({ mode: 'update', from: a.oplogVersion() }));
		b.import(a.export({ mode: 'update', from: b.oplogVersion() }));
		expect(a.getText('content').toString()).toBe(b.getText('content').toString());
	});

	it('exports an update from a version vector', () => {
		const doc = new LoroDoc();
		doc.getText('content').insert(0, 'first');
		doc.commit();
		const after_first = doc.oplogVersion();
		doc.getText('content').insert(5, ' second');
		doc.commit();

		const catch_up = new LoroDoc();
		catch_up.import(doc.export({ mode: 'snapshot' }));
		expect(catch_up.getText('content').toString()).toBe('first second');
		expect(VersionVector.decode(after_first.encode())).toBeDefined();
	});
});
