import { describe, it, expect } from 'vitest';
import { prepareSql } from './sql.helper';

describe('prepareSql', () => {
	it('should handle a plain string with no interpolations', () => {
		const result = prepareSql`SELECT * FROM users`;
		expect(result.query).toBe('SELECT * FROM users');
		expect(result.values).toEqual([]);
	});

	it('should generate numbered placeholders for interpolated values', () => {
		const name = 'Alice';
		const age = 30;
		const result = prepareSql`SELECT * FROM users WHERE name = ${name} AND age = ${age}`;
		expect(result.query).toBe('SELECT * FROM users WHERE name = ?1 AND age = ?2');
		expect(result.values).toEqual(['Alice', 30]);
	});

	it('should convert undefined values to null', () => {
		const val = undefined;
		const result = prepareSql`INSERT INTO items (value) VALUES (${val})`;
		expect(result.values).toEqual([null]);
	});

	it('should preserve null values', () => {
		const val = null;
		const result = prepareSql`INSERT INTO items (value) VALUES (${val})`;
		expect(result.values).toEqual([null]);
	});

	it('should mark result as safely interpreted SQL', () => {
		const result = prepareSql`SELECT 1`;
		expect((result as any).__safelyInterpretedSql__).toBe(true);
	});
});
