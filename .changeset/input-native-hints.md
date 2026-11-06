---
'@delightstack/components': minor
---

`Input` takes `autocomplete`, `inputmode`, `autocapitalize` and `spellcheck` and passes them to the native field (input and textarea), so a one-time-code field can ask phones to offer the code (`autocomplete="one-time-code" inputmode="numeric"`) without reaching into the rendered element. A field with suggestions (`options`/`onfilter`) still uses `autocomplete="off"`.
