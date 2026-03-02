# Agent Status Messages

## Overview

The agent outputs brief status messages between tool calls that are displayed in the **ephemeral status indicator** (edit-in-place message), allowing Claude to communicate what it's doing in real-time. These messages appear in the status indicator alongside tool progress, and are automatically cleaned up when the final response arrives.

## Implementation

### Architecture

1. **Agent Container** (`container/agent-runner/src/index.ts`)
   - Detects `text` content blocks in assistant messages
   - Emits them as `statusMessage` events via structured JSON output
   - Works alongside existing `tool_use` and `thinking` block handlers

2. **Host Process** (`src/container-runner.ts`)
   - `ContainerOutput` interface includes `statusMessage?: string`
   - Streams status messages to output callbacks

3. **Status Display** (`src/status-message.ts`)
   - `handleStatusMessage()` updates the ephemeral status indicator with status message text
   - Tool display and status messages share the same edit-in-place indicator
   - Status messages are cleaned up when the final response arrives

4. **Message Handler** (`src/index.ts`)
   - Routes `statusMessage` events to display handler
   - Maintains proper cleanup on completion

### How It Works

When Claude outputs text between tool calls, those messages are shown in the ephemeral status indicator:

```
Assistant: Let me check the configuration files first.
[tool_use: Read config.ts]
Assistant: Now I'll update the settings.
[tool_use: Edit config.ts]
```

The user sees:

**Status indicator (edit-in-place):**
```
Let me check the configuration files first.
○ Reading file: config.ts
```

**Status indicator (updated):**
```
Now I'll update the settings.
● Reading file: config.ts
○ Editing file: config.ts
```

**Final response (persistent message):**
```
I've updated the configuration in config.ts...
```

**Status indicator:** (deleted)

### Benefits

- Status messages provide context in the status indicator
- Clear separation between agent commentary and final response
- No chat clutter from intermediate messages
- More conversational and transparent
- Tool progress and status messages unified in one indicato

### Trade-offs

- More messages in the chat (could be noisy if agent is very verbose)
- Status messages are ephemeral (deleted when response arrives)
- Users can't scroll back to see intermediate commentary

## Configuration

No configuration needed. The feature is automatically enabled through the Claude Agent SDK's `includePartialMessages: true` setting (already configured).

## Testing

To test the feature:

1. Trigger the agent with a multi-step task
2. Observe status messages appearing in the ephemeral status indicator
3. Verify tool display and status messages share the same indicator
4. Check that status indicator is deleted after final response

Example test prompt:
```
Read the README.md file, then check if there's a package.json, and tell me what you found.
```

The agent should show in the status indicator:
- "Let me read the README first"
- "○ Reading file: README.md"
- "Now checking for package.json"
- "● Reading file: README.md\n○ Finding files: package.json"
- "Found both files, analyzing..."
- Final response appears as a persistent message
- Status indicator is deleted
