---
'@delightstack/components': minor
---

Input and Select save on commit: when `onchange` returns a promise, the field shows a spinner while it runs, a checkmark when it resolves, and the rejection's message as its error when it fails (cleared on the next edit). A fast save skips the spinner but still gets its checkmark; a newer change supersedes one still in flight. Text inputs commit on Enter or blur, as before.
