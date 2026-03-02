# Agent Status Messages

## Overview

The agent outputs brief status messages between tool calls as **persistent chat messages**, allowing Claude to communicate what it's doing in real-time. These messages appear as separate messages in the chat history, independent from the tool execution status indicator.

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
   - `handleStatusMessage()` sends status messages as regular chat messages
   - Tool display remains as a separate edit-in-place status indicator
   - Status messages persist in chat history

4. **Message Handler** (`src/index.ts`)
   - Routes `statusMessage` events to display handler
   - Maintains proper cleanup on completion

### How It Works

When Claude outputs text between tool calls, those messages are sent as separate, persistent chat messages:

```
Assistant: Let me check the configuration files first.
[tool_use: Read config.ts]
Assistant: Now I'll update the settings.
[tool_use: Edit config.ts]
```

The user sees:

**Message 1 (persistent):**
```
Let me check the configuration files first.
```

**Status indicator (edit-in-place):**
```
Thinking…
○ Reading file: config.ts
```

**Message 2 (persistent):**
```
Now I'll update the settings.
```

**Status indicator (updated):**
```
Thinking…
● Reading file: config.ts
○ Editing file: config.ts
```

**Final response (persistent):**
```
I've updated the configuration in config.ts...
```

**Status indicator:** (deleted)

### Benefits

- Status messages persist in chat history for reference
- Clear separation between agent commentary and tool execution
- Users can see the full narrative of what happened
- More conversational and transparent
- Tool progress remains clean and focused

### Trade-offs

- More messages in the chat (could be noisy if agent is very verbose)
- Status messages are permanent (not cleaned up)
- Relies on agent outputting concise, meaningful status updates

## Configuration

No configuration needed. The feature is automatically enabled through the Claude Agent SDK's `includePartialMessages: true` setting (already configured).

## Testing

To test the feature:

1. Trigger the agent with a multi-step task
2. Observe status messages appearing as separate chat messages
3. Verify tool display remains as a separate status indicator
4. Check that status messages persist after completion

Example test prompt:
```
Read the README.md file, then check if there's a package.json, and tell me what you found.
```

The agent should output status messages like:
- "Let me read the README first" (separate message)
- Status indicator: "○ Reading file: README.md"
- "Now checking for package.json" (separate message)
- Status indicator: "● Reading file: README.md\n○ Finding files: package.json"
- "Found both files, analyzing..." (separate message)
- Final response with findings (separate message)

