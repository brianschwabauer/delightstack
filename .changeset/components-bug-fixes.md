---
"@delightstack/components": patch
---

Bug fixes across the library: Modal no longer fires `onclose` twice when closed via Escape/backdrop/X; Calendar guards `time_slot_interval <= 0` instead of freezing the tab; Avatar no longer crashes on whitespace-only names; Breadcrumbs escapes `<` in its JSON-LD script so item labels can't inject markup (XSS); Timeline infinite scroll re-arms after each load instead of firing exactly once; pie/donut Chart legends now toggle individual slices (they previously toggled datasets, leaving single-dataset legends inert); Steps unregisters steps on unmount so dynamic step lists keep correct indices; PDF download handles typed-array sources correctly. Context-driven components (ButtonGroup, Accordion, List, Timeline, Steps, Radio, Fieldset, FileUpload, Tabs, CommandPalette) now expose live prop values through their contexts instead of mount-time snapshots, so prop changes propagate to children without a re-sync tick.
