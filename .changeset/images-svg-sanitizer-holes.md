---
'@delightstack/images': patch
---

Close four holes in the SVG sanitizer, and extract it for unit testing. External `href`/`xlink:href` stripping was a blocklist of quoted `http(s)://` values, so protocol-relative (`//evil`), unquoted, and other-scheme references sailed through — it is now an allowlist (keep `#fragment` and inline `data:image/…`, remove everything else, `<use>` matched per element). CSS can fetch too: `url()` in `style` attributes and `<style>` blocks is neutralized unless the target is a `#fragment`, and `@import` is removed. The `DANGEROUS_URLS` guard's alternation put its colon after the whole group, so `data:text/html,<…>` (comma, the form data URLs actually take) never matched — the colon now binds per branch. The sanitizer lives in `container/src/svg-sanitize.ts` (no sharp import) with a reference test suite in `tests/svg-sanitize.test.ts`.
