---
'@delightstack/editor': minor
---

Trigger menus take a trigger string, not a trigger character

`editor.suggest()` and the `suggestion()` plugin behind it read `char` as a whole string now, so
`[[` is one trigger. Three places assumed a width of one: the query was sliced from
`index + 1`, the trigger position was computed as `pos - query.length - 1`, and the lookbehind
window reserved a single character for the trigger. With a two-character trigger that put the
replace range one character inside it — accepting a suggestion left a stray `[` in the paragraph —
and the query carried the second bracket as its first letter.

New option **`word_start`** (default `true`): whether the trigger has to begin a word. That rule
is what keeps a `/` in the middle of a sentence a slash, and a multi-character trigger has much
less to fear from it — `[[` is not typed by accident, and it legitimately follows an opening
bracket or a dash. Single-character triggers are unaffected in every respect; the slash menu
passes nothing and behaves exactly as before.

Trigger menus also stay shut inside an **inline code span**. Only the code *block* was checked
before, so a `/` or a `[[` inside `` `like this` `` opened the menu — and a menu that inserts a
node on accept would then replace the span's own text with one. Marks count as code when their
spec sets `code` or when the schema names them `code`, which the package's own does.
