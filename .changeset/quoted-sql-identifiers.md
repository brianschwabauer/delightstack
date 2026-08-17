---
'@delightstack/database': minor
---

Generated SQL now double-quotes every consumer-declared identifier, so reserved words work as table and column names.

`sanitize()` has always stripped table/column/index names to `[a-z0-9_]` as an injection guard, but the names were then interpolated **unquoted** — which meant a table named `transaction` or a column named `order` produced a syntax error at the very first statement, `CREATE TABLE transaction (...)`, and the Durable Object never finished booting. Sanitizing is not the same as being valid: a bare reserved word is a legal identifier only in quotes.

A `quote()` helper (sanitize + `"..."`) now wraps identifiers at every generated-SQL site in `db.server.ts`: `CREATE TABLE`, `ALTER TABLE ... ADD COLUMN`, `CREATE INDEX` / `DROP INDEX` (name, table and each indexed column), the `get`/`exists` reads, the `INSERT`/`UPDATE`/`DELETE` builders and their column lists, the foreign-key expansion lookups, and the FK-derived cascade's `SELECT`/`UPDATE`. `destroy()` also quotes the table names it reads back out of `sqlite_schema`, which had the same failure. The search subsystem already quoted throughout and is unchanged.

Column definitions built in `schema/table.ts` are covered too: a `foreignKey()` field emits `REFERENCES "<table>"("<column>")`. This was the last unquoted site, and it failed the same way as the rest — a `CREATE TABLE` naming a reserved-word parent table was a syntax error even though the table's own name was quoted. Both names are already validated to `[a-zA-Z0-9_]` at that point, so the quotes need no escaping.

Sanitizing still happens first and is unchanged, so this is behavior-neutral for ordinary names — only the emitted SQL text differs. Names compared against `sqlite_schema` or `PRAGMA table_info` output stay unquoted, since SQLite reports them that way.
