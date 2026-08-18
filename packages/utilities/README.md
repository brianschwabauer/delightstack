# @delightstack/utilities

Framework-agnostic TypeScript utilities shared across the [Delightstack](https://thedelight.co)
packages — the `DelightError` error class, ID and sort key generation, reactive helpers,
attachments, and DOM utilities.

## Install

```bash
pnpm add @delightstack/utilities
```

The reactive helpers and attachments use Svelte 5 runes, so `svelte` is an optional peer
dependency (only required if you import those entry points).

## Error handling

`DelightError` is the single operational error class used by every Delightstack package.

```ts
import { DelightError } from '@delightstack/utilities';

throw DelightError.badRequest('Invalid input'); // 400
throw DelightError.unauthorized('Not authenticated'); // 401
throw DelightError.notFound('Resource not found'); // 404

// Full options
throw new DelightError({ message: 'Boom', status: 500, code: 'INTERNAL_ERROR' });

// Normalize unknowns + serialize
const err = DelightError.from(unknown);
return err.toResponse(); // → Response
```

## IDs

`generateTimestampID()` returns a lexicographically sortable, URL-safe, alphanumeric ID modeled
after Firebase push IDs. The first 8 characters are the current timestamp in base62; the rest is
random.

```ts
import { generateTimestampID } from '@delightstack/utilities';

generateTimestampID(); // '0VSfwqYWk3PGsGvtC6eW' — 20 chars (8 time + 12 random)
generateTimestampID({ length: 14 }); // '0VSfwqYWk3PGsG'       — 8 time + 6 random
```

Because the timestamp prefix is always 8 characters, IDs of different lengths still sort
chronologically against each other. Shortening an ID only trades away collision resistance: 12
random base62 characters is roughly UUID-strength, 6 is not. `length` must be an integer of at
least 10 — anything else throws a `DelightError` (400, `INVALID_ID_LENGTH`).

## Sort keys (fractional indexing)

`generateSortKey(before, after)` returns a string that sorts strictly between its two neighbors.
It's how you keep an ordered list without an integer `position` column: moving one row writes one
row, instead of renumbering everything after it.

```ts
import { generateSortKey } from '@delightstack/utilities';

generateSortKey(); // 'a0'  — the first item in an empty list
generateSortKey('a0'); // 'a1'  — append after the last item
generateSortKey(null, 'a0'); // 'Zz'  — prepend before the first item
generateSortKey('a0', 'a1'); // 'a0V' — insert between two items
```

Keys are compared with ordinary string comparison, so they can live in a plain text column and be
sorted by the database:

```sql
SELECT * FROM item WHERE list_id = ?1 ORDER BY sort_key;
```

Both arguments are optional and accept `null`/`undefined` for "nothing on that side". Passing keys
that are equal or out of order throws a `DelightError` (400, `INVALID_SORT_KEY_RANGE`), and passing
a string that isn't a well-formed key throws `INVALID_SORT_KEY`.

### The algorithm

A key is an **integer part** followed by an optional **fraction**, both written in base62 with the
digits `0-9A-Za-z` — chosen because that alphabet is already in ascending ASCII order, so digit
order and string order agree.

The integer part's first character is a magnitude marker that encodes how many digits follow:
`a`–`z` mean 1–26 positive digits, `Z`–`A` mean 1–26 negative digits. That's what makes the integer
part self-delimiting *and* correctly ordered under string comparison — `Zz` (−1) sorts before `a0`
(0), which sorts before `b00`, which sorts before `c000`.

- **Appending or prepending** increments/decrements the integer part. No fraction is involved, so
  keys stay short: 62 appends fit in 2 characters, 3,844 in 3, 238,328 in 4.
- **Inserting between two keys** with the same integer part appends a fraction that is the midpoint
  of the two fractions. The midpoint is computed digit by digit: shared leading digits are copied
  through, and at the first differing digit the halfway digit is taken. If the two digits are
  adjacent, the algorithm descends one digit deeper. The fraction never ends in a `0` digit, since
  a trailing zero would let two different strings represent the same position and break string
  comparison.

Repeatedly inserting *at the same spot* is the pathological case for every fractional indexing
scheme — each insert has to fit in half the remaining gap, so keys grow by one character per
log₂(62) ≈ 5.95 insertions. In the test suite: 10,000 sequential appends and 10,000 sequential
prepends both stay at 4 characters, 10,000 insertions at random positions reach 7, and 10,000
insertions at the *same* midpoint reach 1,669. If a list is expected to see sustained hammering at
one position, periodically rebalancing it (regenerating evenly spaced keys) is the escape hatch.

The keys are deterministic — two clients inserting into the same gap generate the *same* key. That
is fine when a unique constraint or a tiebreaker (such as the row ID) settles the collision, but if
you need concurrent inserts to land in a stable distinct order, append your own jitter or fall back
to comparing IDs.

## Documentation

Full docs: <https://docs.thedelight.co>

## License

MIT © Brian Schwabauer
