# Chat

**Status**: 🔲 Placeholder
**Category**: Display
**File**: `packages/components/src/display/Chat.svelte`

## Description

A conversation display component for showing message threads between users or with AI assistants. Handles message grouping, timestamps, typing indicators, and the overall chat interface layout.

## Visual Design

### Container
- Scrollable message area
- Input area fixed at bottom
- Optional header with context info
- Clean, readable layout

### Message Flow
- Messages arranged vertically
- User messages aligned right
- Other messages aligned left
- Grouped by sender with timestamps

### Visual Hierarchy
- Clear distinction between senders
- Readable text sizing
- Comfortable spacing between messages
- Date separators for conversations

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `messages` | `Message[]` | `[]` | Chat messages |
| `currentUser` | `User` | required | Identify user's messages |
| `typing` | `User[]` | `[]` | Users currently typing |
| `showAvatars` | `boolean` | `true` | Show user avatars |
| `showTimestamps` | `boolean` | `true` | Show message times |
| `groupMessages` | `boolean` | `true` | Group consecutive messages |

### Message Interface
```typescript
interface Message {
  id: string;
  content: string;
  sender: User;
  timestamp: Date;
  status?: 'sending' | 'sent' | 'delivered' | 'read';
  attachments?: Attachment[];
}

interface User {
  id: string;
  name: string;
  avatar?: string;
}
```

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onscrolltop` | - | Scrolled to top (load more) |

## Message Features

### Message Grouping
- Consecutive messages from same sender grouped
- Only first message shows avatar
- Timestamps shown for first and after gaps

### Status Indicators
- Sending: Dimmed, no checkmark
- Sent: Single checkmark
- Delivered: Double checkmark
- Read: Blue double checkmark

### Attachments
- Images with preview
- Files with icon and name
- Clickable to open/download

### Reactions
- Emoji reactions on messages
- Reaction picker on hover/long-press
- Grouped reaction counts

## Delightful Details

### Smooth Scroll
- Auto-scroll on new messages (when at bottom)
- Smooth scroll to bottom button
- Preserve position when loading history

### Message Animation
- New messages slide in
- Subtle fade for appearing
- Status transitions animate

### Typing Indicator
- Animated dots
- Shows who is typing
- "John is typing..." or "3 people typing..."

### Date Separators
- "Today", "Yesterday", dates for older
- Clean divider line
- Sticky while scrolling (optional)

### Loading States
- Skeleton messages while loading
- Spinner for sending
- Retry button on failure

### Read Receipts
- Subtle indicator of who's read
- Don't clutter the interface
- Available on hover/tap

## Accessibility

- Proper heading structure
- Messages are list items
- Keyboard navigation
- Screen reader announces new messages

## Code Example

```svelte
<script>
  import { Chat } from '@delightstack/components';

  let messages = $state<Message[]>([]);
  let typingUsers = $state<User[]>([]);

  const currentUser = { id: '1', name: 'Me' };
</script>

<Chat
  {messages}
  {currentUser}
  typing={typingUsers}
  onscrolltop={() => loadMoreMessages()}
/>
```

### With ChatBubble
```svelte
<Chat>
  {#each messages as message}
    <ChatBubble
      {message}
      isOwn={message.sender.id === currentUser.id}
    />
  {/each}

  {#if typingUsers.length > 0}
    <TypingIndicator users={typingUsers} />
  {/if}
</Chat>
```

## Related Components

- **ChatBubble**: Individual message display
- **Input**: Message composition (likely with multiline, send button)

## Implementation Notes

- Use virtual scrolling for long conversations
- Implement efficient message grouping
- Handle realtime message updates
- Consider offline message queueing
- Lazy load images and attachments
