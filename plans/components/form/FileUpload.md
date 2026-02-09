# FileUpload

**Category**: Form
**File**: `packages/components/src/form/FileUpload.svelte`

## Dependencies

- `Progress` (upload progress display)
- `@delightstack/utilities` (`onDragDropFile`)

## Description

A dedicated file upload component with drag-and-drop support, file previews, and upload progress display. Client-side only -- no server upload logic built in. Supports multiple file selection, image previews for image files, and three visual variants: dropzone (large area), compact (small button-like), and avatar (circular crop/upload). Uses `onDragDropFile` from `@delightstack/utilities` for drag-and-drop handling and integrates with the Progress component for upload progress display.

## Visual Design

### Drop Zone (Default Variant)
- Large dashed border area
- Upload icon and instruction text centered
- Visual feedback on drag over: border color changes to `--color-action`, background tints

### Compact Variant
- Button-like trigger with upload icon
- File list rendered below the trigger
- Minimal footprint

### Avatar Variant
- Circular preview area
- Single file only (forced)
- Image preview fills the circle
- Camera/upload icon overlay on hover

### States
- **Default**: Dashed border (`--color-border`), upload icon
- **Drag Over**: Highlighted border (`--color-action`), tinted background, "drop here" text
- **Has Files**: File list with previews, remove buttons
- **Uploading**: Progress bars on each file via Progress component
- **Error**: Error border (`--color-error`), error message per file or globally
- **Disabled**: Reduced opacity (0.5), no interaction
- **Skeleton**: Pulsing placeholder matching variant shape

### Sizes

| Size | Dropzone Padding | Icon Size | Font Size |
|------|-----------------|-----------|-----------|
| `'0'` | 16px | 24px | 13px |
| `'1'` (default) | 32px | 36px | 15px |
| `'2'` | 48px | 48px | 17px |

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `files` | `File[]` | `[]` | Selected files (`$bindable()`) |
| `accept` | `string` | - | Accepted file types (e.g. `'image/*'`, `'.pdf,.doc'`) |
| `multiple` | `boolean` | `false` | Allow multiple files |
| `maxSize` | `number` | - | Max file size in bytes |
| `maxFiles` | `number` | - | Max number of files |
| `disabled` | `boolean` | `false` | Disable upload |
| `preview` | `boolean` | `true` | Show file previews (image thumbnails) |
| `dropzone` | `boolean` | `true` | Large drop target variant (default) |
| `compact` | `boolean` | `false` | Button-style trigger variant |
| `avatar` | `boolean` | `false` | Circular avatar upload variant |
| `size` | `'0' \| '1' \| '2'` | `'1'` | Component size |
| `skeleton` | `boolean` | `false` | Show skeleton loading state |
| `label` | `string` | - | Accessible label / instruction text |
| `error` | `string` | - | Global error message |
| `dense` | `boolean` | `false` | Compact internal padding |
| `comfortable` | `boolean` | `false` | Relaxed internal padding |
| `id` | `string` | - | Element ID |
| `name` | `string` | - | Form field name |
| `class` | `string` | - | Additional CSS classes |

Only one variant boolean should be `true` at a time. If none is set, `dropzone` is the default.

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onselect` | `{ files: File[] }` | Files selected (via click or drop) |
| `onremove` | `{ file: File, index: number }` | File removed from list |
| `onerror` | `{ file: File, error: string }` | File validation failed |

## Snippets

| Snippet | Parameter | Description |
|---------|-----------|-------------|
| `fileItem` | `{ file: File, index: number, remove: () => void }` | Custom file list item rendering |

## Features

### Drag and Drop
- Uses `onDragDropFile` from `@delightstack/utilities` for handling
- Full zone is droppable
- Visual feedback on drag enter (border color, background tint)
- Handles drag leave/enter edge cases (child elements)
- Multiple files supported when `multiple` is true

### Click to Browse
- Clicking the zone/button opens native file picker
- Hidden `<input type="file">` triggered programmatically
- Keyboard accessible (Enter/Space to open)

### File Validation
- Type checking against `accept` prop
- Size validation against `maxSize`
- Count validation against `maxFiles`
- Errors reported per file via `onerror` event

### Image Preview
- Thumbnail generation via `URL.createObjectURL()`
- Displayed in file list for image files
- File type icon for non-image files
- Click to view full size (optional)

### Upload Progress Display
- Consumer provides progress data; FileUpload renders Progress component per file
- Example pattern:

```svelte
<script>
  let files = $state<File[]>([]);
  let progress = $state<Record<string, number>>({});

  async function uploadFiles() {
    for (const file of files) {
      progress[file.name] = 0;
      await uploadToServer(file, (pct) => {
        progress[file.name] = pct;
      });
    }
  }
</script>

<FileUpload bind:files multiple>
  {#snippet fileItem({ file, index, remove })}
    <div class="file-row">
      <span>{file.name}</span>
      <Progress value={progress[file.name] ?? 0} size="0" />
      <button onclick={remove}>Remove</button>
    </div>
  {/snippet}
</FileUpload>
```

### File Removal
- Each file in list has a remove button
- Triggers `onremove` event
- File animates out of list
- Object URLs cleaned up

## Styling

All colors use `--color-*` tokens:
- Dropzone border: `--color-border` (dashed)
- Drag over border: `--color-action` (solid)
- Drag over background: `color-mix(in oklch, var(--color-action), transparent 90%)`
- Icon: `--color-text-muted`
- File name: `--color-text`
- File size: `--color-text-muted`
- Error: `--color-error`
- Disabled: opacity 0.5

Dark mode handled via `light-dark()` for backgrounds and borders.

## Delightful Details

### Drag Animation
- Border transitions from dashed to solid on drag over
- Background tints with accent color
- Upload icon scales up slightly (1.0 -> 1.1)
- Smooth transition (200ms)

### File List Animation
- Files animate in when added (slide down + fade in)
- Files animate out when removed (slide up + fade out)
- Staggered entrance for multiple files

### Success Feedback
- Brief checkmark animation when file is accepted
- Green tint flash
- Smooth transition to preview state

### Error Handling
- Per-file error messages (e.g. "File too large", "Type not accepted")
- Error files highlighted with `--color-error` border
- Error message fades in below file item

### Avatar Variant
- Circular mask on preview image
- Hover overlay with camera icon
- Smooth image crossfade on replacement

## Accessibility

- Keyboard navigation: Tab to focus, Enter/Space to open file picker
- `aria-label` on the drop zone describing the action
- Screen reader announcements when files are added/removed
- Focus management after file selection
- Progress updates announced via `aria-live` region

## Code Example

```svelte
<script>
  import { FileUpload } from '@delightstack/components';

  let files = $state<File[]>([]);
</script>

<!-- Basic dropzone upload -->
<FileUpload
  bind:files
  accept="image/*"
  multiple
  label="Upload images"
/>

<!-- Compact style -->
<FileUpload
  compact
  bind:files
  accept="image/*,application/pdf"
  multiple
  maxFiles={5}
/>

<!-- Avatar upload -->
<FileUpload
  avatar
  accept="image/*"
  maxSize={5 * 1024 * 1024}
  onselect={({ files }) => updateAvatar(files[0])}
/>

<!-- With file size limit and error -->
<FileUpload
  bind:files
  accept=".pdf,.doc,.docx"
  maxSize={10 * 1024 * 1024}
  error={uploadError}
/>

<!-- With skeleton -->
<FileUpload skeleton={isLoading} />
```

## Implementation Notes

- Uses `$props()` for all prop declarations, `$bindable()` for `files`
- Uses `$state()` for internal reactive state (isDragOver, fileErrors)
- Uses `onDragDropFile` from `@delightstack/utilities` for drag-and-drop event handling
- Hidden `<input type="file">` for native file selection
- `URL.createObjectURL()` for image previews, cleaned up on unmount via `$effect` cleanup
- Progress component used for upload progress display within file list
- CSS custom properties for theming, plain CSS with `light-dark()` for dark mode
- Variant booleans (`dropzone`, `compact`, `avatar`) control layout, only one active at a time
- `{@render fileItem?.()}` for custom file list item rendering
- Paste events handled via `document.onpaste` for clipboard upload support
