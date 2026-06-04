# @delightstack/utilities

Framework-agnostic TypeScript utilities shared across the [Delightstack](https://thedelight.co)
packages — the `DelightError` error class, reactive helpers, attachments, and DOM utilities.

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

## Documentation

Full docs: <https://docs.thedelight.co>

## License

MIT © Brian Schwabauer
