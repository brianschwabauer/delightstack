# ChatBubble

**Status**: 🔲 Placeholder
**Category**: Display
**File**: `packages/components/src/display/ChatBubble.svelte`

## Description

An individual message bubble for use within the Chat component. Handles the visual presentation of a single message including content, metadata, attachments, and interactions.

## Visual Design

### Bubble Shape
- Rounded rectangle with tail
- Tail points toward sender side
- Background color differentiates sender

### Colors
- **Own messages**: `--color-action` background, white text
- **Other messages**: `--color-surface-2` background, default text
- Consistent with overall chat theme

### Content Layout
- Message text
- Optional attachments above text
- Timestamp and status below
- Reactions at bottom edge

### Spacing
- Comfortable padding inside bubble
- Tight grouping with consecutive messages
- Tail only on last message in group

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `message` | `Message` | required | Message data |
| `isOwn` | `boolean` | `false` | Is from current user |
| `showTail` | `boolean` | `true` | Show bubble tail |
| `showAvatar` | `boolean` | `true` | Show sender avatar |
| `showTimestamp` | `boolean` | `true` | Show time |
| `showStatus` | `boolean` | `true` | Show delivery status |

## Content Types

### Text
- Markdown/rich text rendering
- Link detection and styling
- Emoji enlargement for emoji-only messages

### Images
- Thumbnail preview in bubble
- Click to expand/lightbox
- Loading placeholder
- Multiple images in grid

### Files
- Icon based on file type
- Filename and size
- Download on click

### Voice Messages
- Waveform visualization
- Play/pause control
- Duration display

### Code Blocks
- Syntax highlighting
- Copy button
- Horizontal scroll for long lines

## Message States

### Sending
- Slightly transparent
- No status indicator yet
- Optional progress for large files

### Sent
- Full opacity
- Single checkmark (if applicable)

### Failed
- Error indicator
- Retry button
- Error message on tap

## Delightful Details

### Appear Animation
- Slide in from sender's side
- Subtle scale from 0.95
- Fast, snappy timing (150ms)

### Reactions
- React on double-tap or hover menu
- Reaction bubbles attach to bottom
- Animated addition of reactions

### Press/Hold Menu
- Copy text
- React
- Reply
- Forward
- Delete (own messages)

### Read Receipt Avatar Stack
- Small avatars of readers
- Positioned at message bottom
- Shows first 3 + count

### Emoji Messages
- Emoji-only messages larger
- No bubble background
- Maximum 3-5 for this treatment

## Accessibility

- Message content is accessible text
- Images have alt descriptions
- Actions keyboard accessible
- Proper ARIA roles

## Code Example

```svelte
<script>
  import { ChatBubble } from '@delightstack/components';

  const message = {
    id: '1',
    content: 'Hello! How are you doing today?',
    sender: { id: '2', name: 'Alice', avatar: '/alice.jpg' },
    timestamp: new Date(),
    status: 'read'
  };
</script>

<ChatBubble
  {message}
  isOwn={false}
  showAvatar
/>

<!-- Own message -->
<ChatBubble
  message={{
    id: '2',
    content: "I'm doing great, thanks!",
    sender: currentUser,
    timestamp: new Date(),
    status: 'delivered'
  }}
  isOwn
/>

<!-- With attachments -->
<ChatBubble
  message={{
    ...message,
    attachments: [
      { type: 'image', url: '/photo.jpg', name: 'photo.jpg' }
    ]
  }}
/>
```

## Implementation Notes

- Use CSS for bubble shape (avoid images)
- Handle long words with word-break
- Lazy load images
- Support RTL languages
- Consider markdown rendering library or simple implementation
