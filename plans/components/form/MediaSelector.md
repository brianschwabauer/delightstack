# MediaSelector

**Status**: 🔲 Placeholder
**Category**: Form
**File**: `packages/components/src/form/MediaSelector.svelte`

## Description

A component for selecting images or videos from a media library. Integrates with a media management system to provide browse, search, and upload capabilities in a unified interface.

## Visual Design

### Trigger
- Preview of selected media
- Placeholder if none selected
- Click opens media modal

### Media Modal
- Full-featured media browser
- Gallery grid view
- Search and filter
- Upload new media

### Gallery
- Thumbnail grid
- Aspect ratio consistency
- Selection indicator
- Multi-select support

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `Media \| Media[]` | - | Selected media (bindable) |
| `multiple` | `boolean` | `false` | Allow multiple selection |
| `accept` | `'image' \| 'video' \| 'all'` | `'all'` | Media type filter |
| `maxSelect` | `number` | - | Max selections |
| `placeholder` | `string` | `'Select media'` | Placeholder text |
| `uploadEnabled` | `boolean` | `true` | Allow uploading |
| `dense` | `boolean` | `false` | Compact thumbnail grid spacing |
| `comfortable` | `boolean` | `false` | Relaxed thumbnail grid spacing |

### Media Interface
```typescript
interface Media {
  id: string;
  url: string;
  thumbnailUrl?: string;
  type: 'image' | 'video';
  name: string;
  size: number;
  dimensions?: { width: number; height: number };
  uploadedAt: Date;
}
```

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onselect` | `{ media }` | Media selected |
| `onupload` | `{ file, media }` | New media uploaded |
| `onremove` | `{ media }` | Media removed from selection |

## Features

### Gallery Browser
- Paginated or infinite scroll
- Sort by date, name, size
- Filter by type
- Search by name

### Preview
- Click thumbnail for larger preview
- Image lightbox
- Video player
- Media details

### Upload Integration
- Drag and drop to modal
- Upload button
- Progress indication
- Goes to library after upload

### Selection
- Click to select/deselect
- Checkbox overlay on thumbnails
- Selection counter
- Confirm button

## Delightful Details

### Smooth Loading
- Skeleton grid while loading
- Progressive thumbnail loading
- Blur-up effect

### Selection Feedback
- Checkmark overlay animates
- Selection count updates
- Visual hierarchy for selected

### Drag to Reorder
For multiple selection:
- Drag to reorder selected items
- Visual feedback during drag

### Quick Preview
- Hover for quick preview
- Larger tooltip thumbnail
- File info tooltip

### Upload Progress
- Shows upload in gallery
- Progress overlay
- Success transitions to normal item

## Modal Structure

```
┌─────────────────────────────────────────────────┐
│ Select Media                              [X]   │
├─────────────────────────────────────────────────┤
│ [🔍 Search...] [Type ▾] [Sort ▾] [+ Upload]    │
├─────────────────────────────────────────────────┤
│ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐       │
│ │ ✓   │ │     │ │     │ │ ✓   │ │     │       │
│ │ img │ │ img │ │ img │ │ img │ │ img │       │
│ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘       │
│ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐       │
│ │     │ │     │ │     │ │     │ │     │       │
│ │ img │ │ img │ │ img │ │ img │ │ img │       │
│ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘       │
├─────────────────────────────────────────────────┤
│ 2 selected                     [Cancel] [Done]  │
└─────────────────────────────────────────────────┘
```

## Accessibility

- Keyboard grid navigation
- Selection announced
- Modal focus trap
- Image alt text support

## Code Example

```svelte
<script>
  import { MediaSelector } from '@delightstack/components';

  let featuredImage = $state<Media | null>(null);
  let galleryImages = $state<Media[]>([]);
</script>

<!-- Single image selection -->
<MediaSelector
  bind:value={featuredImage}
  accept="image"
  placeholder="Select featured image"
/>

<!-- Multiple selection -->
<MediaSelector
  bind:value={galleryImages}
  multiple
  maxSelect={10}
  accept="image"
/>

<!-- With preview -->
{#if featuredImage}
  <div class="preview">
    <img src={featuredImage.thumbnailUrl} alt={featuredImage.name} />
    <button onclick={() => featuredImage = null}>Remove</button>
  </div>
{:else}
  <MediaSelector bind:value={featuredImage} accept="image" />
{/if}
```

## Implementation Notes

- Integrate with media API/library
- Virtual scrolling for large libraries
- Cache thumbnail URLs
- Handle broken images gracefully
- Consider CDN integration
