---
"@delightstack/components": minor
---

CommandPalette supports async command sources and external query control. A new `onquery` callback fires whenever the search query changes so a parent can fetch results from a server (debouncing is the parent's responsibility). Commands marked `dynamic: true` are treated as pre-filtered by their source: while a query is present they bypass the fuzzy filter and render, in the order given, after the scored static matches — title highlighting still applies to confident (non-fuzzy) matches. A `loading` prop shows "Searching…" instead of "No results found" while an external source is in flight. The `query` is now a bindable prop so a parent can prefill it (e.g. from a deep-link URL param) or mirror it into the URL; it resets when the palette closes rather than when it opens, so a prefill set alongside `open = true` survives.
