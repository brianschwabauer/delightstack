# FileUpload

**Status**: 🔲 Placeholder
**Category**: Form
**File**: `packages/components/src/form/FileUpload.svelte`

## Description

A dedicated file upload component with drag-and-drop support, file previews, and upload progress. More feature-rich than the Input type="file", suitable for prominent upload experiences.

## Visual Design

### Drop Zone
- Large dashed border area
- Icon and instruction text
- Visual feedback on drag over
- Clear call to action

### States
- **Default**: Dashed border, upload icon
- **Drag Over**: Highlighted, "drop here" state
- **Uploading**: Progress indication
- **Complete**: Success state with preview
- **Error**: Error state with message

### File Preview
- Image thumbnails
- File type icons for non-images
- File name and size
- Remove button

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `files` | `File[]` | `[]` | Selected files (bindable) |
| `accept` | `string` | - | Accepted file types |
| `multiple` | `boolean` | `false` | Allow multiple files |
| `maxSize` | `number` | - | Max file size (bytes) |
| `maxFiles` | `number` | - | Max number of files |
| `disabled` | `boolean` | `false` | Disable upload |
| `preview` | `boolean` | `true` | Show file previews |
| `upload` | `(file: File) => Promise` | - | Upload handler |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onselect` | `{ files }` | Files selected |
| `onupload` | `{ file, progress }` | Upload progress |
| `oncomplete` | `{ file, response }` | Upload complete |
| `onerror` | `{ file, error }` | Upload failed |
| `onremove` | `{ file }` | File removed |

## Features

### Drag and Drop
- Full zone is droppable
- Visual feedback on drag enter
- Handles drag leave/enter properly
- Multiple files supported

### Click to Browse
- Clicking opens file picker
- Hidden native input
- Keyboard accessible

### File Validation
- Type checking against `accept`
- Size validation
- Custom validation function

### Upload Progress
```svelte
<FileUpload
  upload={async (file, onProgress) => {
    const formData = new FormData();
    formData.append('file', file);

    await api.upload(formData, {
      onUploadProgress: (e) => {
        onProgress(e.loaded / e.total * 100);
      }
    });
  }}
/>
```

### Image Preview
- Thumbnail generation
- Lazy loading
- Click to expand (optional)

## Variants

### Drop Zone (Default)
```svelte
<FileUpload />
```
- Large drop target
- Icon + text

### Compact
```svelte
<FileUpload variant="compact" />
```
- Button-style trigger
- File list below

### Avatar Upload
```svelte
<FileUpload variant="avatar" accept="image/*" />
```
- Circular preview
- Single file only
- Crop integration (optional)

## Delightful Details

### Drag Animation
- Border pulses on drag over
- Icon animates
- Color transition

### Upload Progress
- Smooth progress bar on each file
- Percentage display
- Cancel button during upload

### Success Feedback
- Checkmark animation on complete
- Brief celebration
- Smooth transition to preview

### Error Handling
- Clear error messages
- Retry option
- Validation errors per file

### File Removal
- Click X to remove
- Confirm for uploaded files
- Animate out

## Accessibility

- Keyboard navigation
- Screen reader announcements
- Focus management
- Accessible progress updates

## Code Example

```svelte
<script>
  import { FileUpload } from '@delightstack/components';

  let files = $state<File[]>([]);

  async function handleUpload(file, onProgress) {
    const response = await uploadToServer(file, onProgress);
    return response.url;
  }
</script>

<!-- Basic upload -->
<FileUpload
  bind:files
  accept="image/*"
  multiple
/>

<!-- With upload handler -->
<FileUpload
  bind:files
  accept=".pdf,.doc,.docx"
  maxSize={10 * 1024 * 1024}
  upload={handleUpload}
/>

<!-- Avatar upload -->
<FileUpload
  variant="avatar"
  accept="image/*"
  maxSize={5 * 1024 * 1024}
  onselect={({ files }) => updateAvatar(files[0])}
/>

<!-- Compact style -->
<FileUpload
  variant="compact"
  accept="image/*,application/pdf"
  multiple
  maxFiles={5}
/>
```

## Implementation Notes

- Use hidden input for file selection
- Handle paste events (clipboard)
- Generate thumbnails client-side
- Consider chunked upload for large files
- Clean up object URLs on unmount
