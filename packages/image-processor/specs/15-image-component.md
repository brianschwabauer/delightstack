# 15 — Svelte Image Component

**Dependencies:** 11, 14
**Files created:** `src/Image.svelte`, `src/image-helpers.ts`

## Overview

Build a Svelte 5 component for displaying images from the image processor. Handles three-tier progressive loading (background color → ThumbHash → full image), responsive srcset with automatic variant selection, and error recovery with exponential backoff retries. Also export standalone helpers (`decodeThumbHash`, `imageURL`) for use outside the component.

## Tasks

### Helpers (src/image-helpers.ts)
- [x] Create `src/image-helpers.ts`
- [x] Implement `decodeThumbHash(base64)` — base64 → Uint8Array → `thumbHashToDataURL()` → data URL
- [x] Implement `imageURL(image_id, variant?, cdn_prefix?)` — build CDN URL string
- [ ] Test: decodeThumbHash round-trips correctly
- [ ] Test: imageURL builds correct paths with defaults and custom prefix

### Component (src/Image.svelte)
- [x] Create `src/Image.svelte`
- [x] Define Props interface matching DESIGN.md (image, alt, fit, loading, ssr_placeholder, sizes, cdn_prefix, onload, class, style)
- [x] Implement alt text fallback chain: prop → image.alt_text → image.file_name without extension → ""
- [x] Implement background color placeholder (CSS oklch from image record)
- [x] Implement ThumbHash placeholder (SSR when ssr_placeholder=true, client otherwise)
- [x] Build srcset from non-original, non-watermarked variants, ascending by width
- [x] Build fallback src from largest non-original, non-watermarked variant
- [x] Detect cached images (img.complete) and skip fade transition
- [x] Implement 300ms opacity fade from placeholder to loaded image
- [x] Implement error retry with exponential backoff (1s, 4s, 9s — max 3 retries)
- [x] Only render `<img>` when processing_status is 'processed'
- [x] Clean up retry timer on component destroy
- [x] Handle missing variants gracefully (empty srcset)
- [x] Scoped CSS: .image, .placeholder, .main, .loaded, .instant
- [ ] Test: renders with background color when no thumbhash
- [ ] Test: renders thumbhash placeholder on client
- [ ] Test: SSR placeholder works server-side
- [ ] Test: srcset excludes original and watermarked variants
- [ ] Test: cached images skip fade
- [ ] Test: error retry attempts (mock failing image loads)

## Details

### src/image-helpers.ts

**decodeThumbHash:**

```ts
import { thumbHashToDataURL } from 'thumbhash';

export function decodeThumbHash(base64: string): string {
  const binary = atob(base64);
  const hash = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    hash[i] = binary.charCodeAt(i);
  }
  return thumbHashToDataURL(hash);
}
```

This is in the module context of the component AND exported from the helpers file so it can be used independently (e.g. in a +page.server.ts load function or in an API response).

**imageURL:**

```ts
export function imageURL(
  image_id: string,
  variant = 'default',
  cdn_prefix = '/cdn/image',
): string {
  return `${cdn_prefix}/${image_id}/${variant}`;
}
```

### src/Image.svelte

The full component source is in DESIGN.md. Key implementation notes:

**Props interface:**

```ts
interface Props {
  image: {
    id: string;
    processing_status: string;
    file_name: string | null;
    alt_text: string | null;
    width: number | null;
    height: number | null;
    aspect_ratio: number | null;
    thumbhash: string | null;
    background_color_l: number | null;
    background_color_c: number | null;
    background_color_h: number | null;
    variants: { name: string; width: number; height: number; watermarked?: boolean }[] | string | null;
  };
  alt?: string;
  fit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
  loading?: 'lazy' | 'eager';
  ssr_placeholder?: boolean;
  sizes?: string;
  cdn_prefix?: string;
  onload?: () => void;
  class?: string;
  style?: string;
}
```

The `image` type is intentionally loose (doesn't import from types.ts) so the component works with any object that has the right shape — including raw SQL query results where `variants` is a JSON string.

**Variant parsing:**

The `variants` field may be a JSON string (from SQLite) or already parsed. Handle both:

```ts
const variants = $derived(
  !image.variants ? []
    : typeof image.variants === 'string' ? JSON.parse(image.variants)
    : image.variants,
);
```

**srcset filtering:**

Exclude `original` variants (not meant for display) and `watermarked` variants (user doesn't want watermarked images in their main display):

```ts
const displayVariants = $derived(
  variants.filter(v => v.name !== 'original' && !v.watermarked)
);
```

**SSR detection:**

```ts
const is_browser = typeof window !== 'undefined';
```

When `ssr_placeholder` is false and we're on the server, don't decode the ThumbHash (save server CPU). The placeholder will be decoded on the client after hydration.

When `ssr_placeholder` is true, decode on both server and client. The SSR'd HTML includes the data URL inline, so the placeholder is visible before JS loads.

**Cached image detection:**

After the `<img>` element is bound, check if the browser already has it cached:

```ts
$effect(() => {
  if (img_el?.complete && img_el.naturalWidth > 0) {
    loaded = true;
    instant = true;  // skip fade
  }
});
```

The `instant` class removes the CSS transition so there's no visible fade for cached images.

**Error retry:**

On `onerror`, retry up to 3 times with exponential backoff:

```ts
function handleError() {
  if (error_count >= 3) return;
  error_count++;
  clearTimeout(retry_timer);
  retry_timer = setTimeout(() => {
    if (loaded || !img_el) return;
    const current = img_el.src;
    img_el.src = '';     // clear
    img_el.src = current; // re-trigger load
  }, error_count ** 2 * 1000);  // 1s, 4s, 9s
}
```

This handles temporary network failures and the case where the image is still being processed (the CDN hook returns a 404 SVG, which triggers onerror).

### CSS

All class names are unscoped (Svelte scopes them automatically):

```css
.image { position: relative; overflow: hidden; }
.placeholder { position: absolute; inset: 0; width: 100%; height: 100%;
               filter: blur(20px); transform: scale(1.1); z-index: 1; pointer-events: none; }
.main { display: block; width: 100%; height: 100%; position: relative;
        z-index: 2; opacity: 0; transition: opacity 300ms ease; }
.loaded { opacity: 1; }
.instant { transition: none; }
```

The `transform: scale(1.1)` on the placeholder hides blurred edges from the blur filter.

### Package Export

The component is exported via a separate package entry:

```json
{ "exports": { "./component": "./src/Image.svelte" } }
```

Usage:

```svelte
<script>
  import Image from '@delightstack/image-processor/component';
  import { imageURL, decodeThumbHash } from '@delightstack/image-processor';
</script>

<Image image={photo} />
```
