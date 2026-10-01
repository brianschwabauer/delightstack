---
'@delightstack/utilities': patch
---

`DelightError.from()` now reads `status`, `code`, `detail` and `errors` off a plain `Error` that carries them as own properties. That is what a `DelightError` thrown inside a Durable Object or service binding looks like after the Workers RPC hop: the prototype is gone but the properties survive. Before, every such error normalised to a 500, so a wrong password answered `500` with the right message, a 404 from a DO method became a 500, and Sentry filled with 5xx reports for ordinary client errors.
