# Delight Stack

## Project Overview

## Error Handling

All packages use `DelightError` from `@delightstack/utilities` as the single error class. Never throw plain objects, `new Error()`, or other custom error classes for operational errors.

```typescript
import { DelightError } from '@delightstack/utilities';

// Factory methods for common HTTP statuses
throw DelightError.badRequest('Invalid input'); // 400
throw DelightError.unauthorized('Not authenticated'); // 401
throw DelightError.forbidden('Not allowed'); // 403
throw DelightError.notFound('Resource not found'); // 404
throw DelightError.rateLimit('Too many requests'); // 429

// Full options constructor
throw new DelightError({
	message: 'Something went wrong',
	status: 500,
	code: 'INTERNAL_ERROR', // machine-readable code (optional)
	detail: 'Stack trace or context', // hidden from user (optional)
});

// Simple string constructor (defaults to status 500)
throw new DelightError('Unexpected error');

// Normalize unknown errors (catch blocks, external libraries)
const err = DelightError.from(unknownError);

// Type guard
if (DelightError.is(error)) {
	/* ... */
}

// Serialization
err.toJSON(); // → { message, status, code?, detail?, errors? }
err.toResponse(); // → new Response(JSON.stringify(...), { status, headers })
```

## Publishing a package

### Create a new changeset and version

```bash
pnpm changeset add
pnpm changeset version
```
