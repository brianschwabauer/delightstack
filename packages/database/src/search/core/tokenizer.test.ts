import { describe, expect, it } from 'vitest';
import {
	countTokenFrequencies,
	MAX_TOKEN_LENGTH,
	tokenize,
	tokenizeValue,
} from './tokenizer';

describe('tokenize', () => {
	it('lowercases and splits on non-letter/non-number runs', () => {
		expect(tokenize('Hello, World!  Foo')).toEqual(['hello', 'world', 'foo']);
	});

	it('folds diacritics via NFKD + combining-mark stripping', () => {
		expect(tokenize('café')).toEqual(['cafe']);
		expect(tokenize('naïve résumé')).toEqual(['naive', 'resume']);
		expect(tokenize('Zürich München')).toEqual(['zurich', 'munchen']);
	});

	it('keeps non-Latin scripts intact (Orama destroys these)', () => {
		expect(tokenize('東京 москва')).toEqual(['東京', 'москва']);
	});

	it('splits underscore and hyphen (deliberate Orama deviation)', () => {
		expect(tokenize('snake_case_field')).toEqual(['snake', 'case', 'field']);
		expect(tokenize('a well-known co-op')).toEqual(['a', 'well', 'known', 'co', 'op']);
		expect(tokenize('_under_')).toEqual(['under']);
		expect(tokenize('foo--bar')).toEqual(['foo', 'bar']);
	});

	it('folds an apostrophe sitting between two letters or digits', () => {
		expect(tokenize("john's notes")).toEqual(['johns', 'notes']);
		expect(tokenize("it's")).toEqual(['its']);
		expect(tokenize("O'Brien")).toEqual(['obrien']);
		// The curly apostrophe folds identically.
		expect(tokenize('jane’s')).toEqual(['janes']);
		// Digits count as word characters on both sides.
		expect(tokenize("rock'n'2")).toEqual(['rockn2']);
	});

	it('keeps a non-intra-word apostrophe as an ordinary separator', () => {
		expect(tokenize("'quoted'")).toEqual(['quoted']);
		expect(tokenize("' alone '")).toEqual(['alone']);
		// Per-apostrophe neighbour rule: in a run of two, each has the other as a
		// neighbour, so neither folds and the run splits.
		expect(tokenize("don''t")).toEqual(['don', 't']);
		expect(tokenize("ends' start")).toEqual(['ends', 'start']);
	});

	it('makes an apostrophe-less query match the folded token exactly', () => {
		// `john` still prefix-matches `johns`, and `obrien` matches `o'brien`.
		expect(tokenize('obrien')).toEqual(tokenize("o'brien"));
		expect(tokenize("john's")[0].startsWith(tokenize('john')[0])).toBe(true);
	});

	it('keeps duplicates so tf is a real term frequency (Orama de-duplicates)', () => {
		expect(tokenize('repeat repeat repeat')).toEqual(['repeat', 'repeat', 'repeat']);
	});

	it('emits the whole address plus parts for an email-shaped chunk', () => {
		expect(tokenize('jane.doe@showandtour.com')).toEqual([
			'jane.doe@showandtour.com',
			'jane',
			'doe',
			'showandtour',
			'com',
		]);
	});

	it('runs the email pass per whitespace chunk, so prose addresses count', () => {
		expect(tokenize('contact jane@x.com today')).toEqual([
			'contact',
			'jane@x.com',
			'jane',
			'x',
			'com',
			'today',
		]);
	});

	it('trims edge punctuation before the email test', () => {
		expect(tokenize('(jane@x.com),')).toEqual(['jane@x.com', 'jane', 'x', 'com']);
	});

	it('does not treat a dotless domain as an address', () => {
		expect(tokenize('user@localhost')).toEqual(['user', 'localhost']);
	});

	it('normalizes the address before emitting it', () => {
		expect(tokenize('Jane.DOE@Café.com')[0]).toBe('jane.doe@cafe.com');
	});

	it('truncates tokens longer than the cap', () => {
		const long = 'x'.repeat(MAX_TOKEN_LENGTH + 6);
		expect(tokenize(long)).toEqual(['x'.repeat(MAX_TOKEN_LENGTH)]);
		expect(tokenize(`${'y'.repeat(MAX_TOKEN_LENGTH)} ${long}`)).toEqual([
			'y'.repeat(MAX_TOKEN_LENGTH),
			'x'.repeat(MAX_TOKEN_LENGTH),
		]);
	});

	it('collapses two over-long tokens sharing 64 characters onto one token', () => {
		// `edge_long_token` / `edge_long_token_twin` in the fixture corpus rely on
		// this: truncation must make them collide, and the query side must
		// truncate identically so an over-long term still finds them.
		const a = 'x'.repeat(MAX_TOKEN_LENGTH + 6);
		const b = `${'x'.repeat(MAX_TOKEN_LENGTH)}zzzzzz`;
		expect(tokenize(a)).toEqual(tokenize(b));
	});

	it('returns an empty list for empty and non-string input', () => {
		expect(tokenize('')).toEqual([]);
		expect(tokenize('   ')).toEqual([]);
		expect(tokenize('!!!')).toEqual([]);
		expect(tokenize(undefined as unknown as string)).toEqual([]);
	});

	it('keeps digits and mixed alphanumerics as single tokens', () => {
		// `3.14` additionally emits the whole chunk (number-chunk rule below).
		expect(tokenize('v2 build42 3.14')).toEqual(['v2', 'build42', '3.14', '3', '14']);
	});

	it('drops emoji (they are neither letters nor numbers)', () => {
		expect(tokenize('emoji 😀 test')).toEqual(['emoji', 'test']);
	});

	it('is identical on the index side and the query side', () => {
		const value = 'Jane.Doe@ShowAndTour.com wrote well-known café notes';
		expect(tokenize(value)).toEqual(tokenize(value));
	});

	/* --- rule 1: format characters fold to nothing ------------------------ */

	it('strips soft hyphens so a hyphenated word tokenizes whole', () => {
		expect(tokenize('data­base')).toEqual(['database']);
		expect(tokenize('soft­hyphen data­base')).toEqual(['softhyphen', 'database']);
	});

	it('strips zero-width space, joiner, non-joiner and the BOM', () => {
		expect(tokenize('da​ta‍base')).toEqual(['database']);
		expect(tokenize('da‌tabase')).toEqual(['database']);
		expect(tokenize('﻿database﻿')).toEqual(['database']);
	});

	it('strips Arabic tatweel so an elongated word equals its plain form', () => {
		expect(tokenize('مــد')).toEqual(['مد']);
		expect(tokenize('مــد')).toEqual(tokenize('مد'));
	});

	/* --- rule 2: U+02BC joins the apostrophe fold class ------------------- */

	it('folds the modifier-letter apostrophe when it is intra-word', () => {
		expect(tokenize('johnʼs')).toEqual(['johns']);
		expect(tokenize('johnʼs')).toEqual(tokenize("john's"));
	});

	it('treats a non-intra-word U+02BC as a separator, never a letter', () => {
		// U+02BC is `\p{L}`, so without the demotion step it would survive
		// inside a token and make `quoted` unfindable.
		expect(tokenize('ʼquotedʼ')).toEqual(['quoted']);
		expect(tokenize('endsʼ start')).toEqual(['ends', 'start']);
		expect(tokenize('donʼʼt')).toEqual(['don', 't']);
		for (const token of tokenize('ʼaʼ bʼc ʼ')) {
			expect(token).not.toContain('ʼ');
		}
	});

	/* --- rule 3: camelCase parts, whole token retained -------------------- */

	it('emits the whole camelCase token plus its lowercased parts', () => {
		expect(tokenize('getUserData')).toEqual(['getuserdata', 'get', 'user', 'data']);
	});

	it('splits an acronym prefix at the last uppercase before a lowercase', () => {
		expect(tokenize('HTTPServer')).toEqual(['httpserver', 'http', 'server']);
		expect(tokenize('XMLHttpRequest')).toEqual([
			'xmlhttprequest',
			'xml',
			'http',
			'request',
		]);
	});

	it('splits a camelCase word sitting inside prose', () => {
		expect(tokenize('the getUserData call')).toEqual([
			'the',
			'getuserdata',
			'get',
			'user',
			'data',
			'call',
		]);
	});

	it('makes a camelCase part findable from the query side', () => {
		// Query-side equivalence: the doc token list must contain the query's
		// only token.
		expect(tokenize('getUserData')).toContain(tokenize('user')[0]);
	});

	it('emits a plain word exactly once (no camelCase boundary)', () => {
		expect(tokenize('hello')).toEqual(['hello']);
		expect(tokenize('HELLO')).toEqual(['hello']);
		expect(tokenize('Hello')).toEqual(['hello']);
		// A digit before an uppercase letter is deliberately not a boundary, so
		// `v2Beta` stays a single token with no parts.
		expect(tokenize('v2Beta')).toEqual(['v2beta']);
	});

	it('does not double-emit the runs of a chunk that has no case boundary', () => {
		expect(tokenize('foo-getUserData')).toEqual([
			'foo',
			'getuserdata',
			'get',
			'user',
			'data',
		]);
	});

	/* --- rule 4: acronym dot folding -------------------------------------- */

	it('folds a dotted single-letter run into one token', () => {
		expect(tokenize('U.S.A.')).toEqual(['usa']);
		expect(tokenize('u.s.a')).toEqual(['usa']);
		expect(tokenize('e.g.')).toEqual(['eg']);
		expect(tokenize('U.S. Army')).toEqual(['us', 'army']);
	});

	it('leaves ordinary dotted text alone', () => {
		expect(tokenize('example.com')).toEqual(['example', 'com']);
		expect(tokenize('3.14')).toEqual(['3.14', '3', '14']);
		expect(tokenize('u.s.army')).toEqual(['u', 's', 'army']);
	});

	/* --- rule 5: whole-token emission for number chunks -------------------- */

	it('emits a separator-bearing number chunk whole as well as split', () => {
		expect(tokenize('3.14')).toEqual(['3.14', '3', '14']);
		expect(tokenize('1,000')).toEqual(['1,000', '1', '000']);
		expect(tokenize('2.5.1')).toEqual(['2.5.1', '2', '5', '1']);
		expect(tokenize('555-1234')).toEqual(['555-1234', '555', '1234']);
	});

	it('never whole-emits a chunk containing a letter, or a bare integer', () => {
		expect(tokenize('v2.5')).toEqual(['v2', '5']);
		expect(tokenize('42')).toEqual(['42']);
		expect(tokenize('1.2.3a')).toEqual(['1', '2', '3a']);
	});

	it('truncates an over-long whole-emitted number chunk', () => {
		const long_number = `${'1'.repeat(40)}.${'2'.repeat(40)}`;
		expect(tokenize(long_number)[0]).toBe(long_number.slice(0, MAX_TOKEN_LENGTH));
	});

	/* --- frozen pipeline order -------------------------------------------- */

	it('applies the five rules in the frozen pipeline order', () => {
		// Acronym fold runs BEFORE the apostrophe fold (so `U.S.A.'s` → `usas`,
		// not `usa` + `s`); both run BEFORE the email test (so the address is
		// detected in its folded form); camelCase parts trail the split parts.
		expect(tokenize("U.S.A.'s getUserData 3.14 jane's O'Brien@x.com")).toEqual([
			'usas',
			'getuserdata',
			'get',
			'user',
			'data',
			'3.14',
			'3',
			'14',
			'janes',
			'obrien@x.com',
			'obrien',
			'x',
			'com',
		]);
	});

	it('keeps email detection working on the folded, format-stripped form', () => {
		expect(tokenize('O­Brienʼs@x.com')[0]).toBe('obriens@x.com');
	});
});

describe('tokenizeValue', () => {
	it('tokenizes array elements in order', () => {
		expect(tokenizeValue(['red hat', 'blue'])).toEqual(['red', 'hat', 'blue']);
	});

	it('ignores non-string values and elements', () => {
		expect(tokenizeValue(42)).toEqual([]);
		expect(tokenizeValue(null)).toEqual([]);
		expect(tokenizeValue(['ok', 5, null])).toEqual(['ok']);
	});
});

describe('countTokenFrequencies', () => {
	it('counts duplicates', () => {
		const counts = countTokenFrequencies(['a', 'b', 'a', 'a']);
		expect(counts.get('a')).toBe(3);
		expect(counts.get('b')).toBe(1);
	});
});
