---
name: claude-agent-sdk
description: "Claude Agent SDK reference for Python and TypeScript. Use when: (1) answering questions about the Claude Agent SDK or Claude Code SDK, (2) writing code that uses query(), hooks, MCP, sessions, permissions, structured outputs, or subagents, (3) building or debugging agents that use Claude Code programmatically, (4) integrating Claude Code as a library in production applications, (5) configuring agent hosting, sandboxing, or deployment. Triggers on: 'agent sdk', 'claude sdk', 'query()', 'ClaudeAgentOptions', 'claude-agent-sdk', '@anthropic-ai/claude-agent-sdk', 'agent hooks', 'agent permissions', 'agent sessions'."
---

# Claude Agent SDK Reference

Fetch detailed docs from the URL table below using WebFetch. Use the inline quick reference for common patterns.

## Doc Pages

Fetch the relevant page when deeper detail is needed:

| Topic | URL |
|-------|-----|
| Overview | https://platform.claude.com/docs/en/agent-sdk/overview |
| Quickstart | https://platform.claude.com/docs/en/agent-sdk/quickstart |
| TypeScript Reference | https://platform.claude.com/docs/en/agent-sdk/typescript |
| Python Reference | https://platform.claude.com/docs/en/agent-sdk/python |
| Permissions | https://platform.claude.com/docs/en/agent-sdk/permissions |
| Sessions | https://platform.claude.com/docs/en/agent-sdk/sessions |
| Hooks | https://platform.claude.com/docs/en/agent-sdk/hooks |
| MCP Integration | https://platform.claude.com/docs/en/agent-sdk/mcp |
| Structured Outputs | https://platform.claude.com/docs/en/agent-sdk/structured-outputs |
| Custom Tools | https://platform.claude.com/docs/en/agent-sdk/custom-tools |
| User Input / Approvals | https://platform.claude.com/docs/en/agent-sdk/user-input |
| Subagents | https://platform.claude.com/docs/en/agent-sdk/subagents |
| Hosting | https://platform.claude.com/docs/en/agent-sdk/hosting |
| Secure Deployment | https://platform.claude.com/docs/en/agent-sdk/secure-deployment |
| Streaming Output | https://platform.claude.com/docs/en/agent-sdk/streaming-output |
| Cost Tracking | https://platform.claude.com/docs/en/agent-sdk/cost-tracking |
| File Checkpointing | https://platform.claude.com/docs/en/agent-sdk/file-checkpointing |

## Quick Reference

### Install
```bash
npm install @anthropic-ai/claude-agent-sdk   # TypeScript
pip install claude-agent-sdk                  # Python
```

### Auth
Set `ANTHROPIC_API_KEY`. Alternatives: `CLAUDE_CODE_USE_BEDROCK=1`, `CLAUDE_CODE_USE_VERTEX=1`, `CLAUDE_CODE_USE_FOUNDRY=1`.

### query() — Main Entry Point

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";
for await (const message of query({
  prompt: "Your task",
  options: {
    model: "claude-opus-4-6",
    allowedTools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
    disallowedTools: ["WebFetch"],
    maxTurns: 10,
    systemPrompt: "Custom system prompt",
    appendSystemPrompt: "Appended instructions",
    permissionMode: "default", // "default"|"acceptEdits"|"bypassPermissions"|"plan"
    cwd: "/path/to/project",
    resume: "session-id",
    forkSession: false,
    mcpServers: { /* see MCP section */ },
    hooks: { /* see Hooks section */ },
    outputFormat: { type: "json_schema", schema: { /* JSON Schema */ } },
    env: { KEY: "value" },
  }
})) { /* handle messages */ }
```

Python equivalent: use `query(prompt=..., options=ClaudeAgentOptions(...))` with snake_case fields (`allowed_tools`, `max_turns`, `system_prompt`, `permission_mode`, `mcp_servers`, `output_format`).

### Message Types

| type | subtype | Key fields | When |
|------|---------|------------|------|
| `system` | `init` | `session_id`, `tools`, `mcp_servers` | Session start |
| `assistant` | — | `content` (text/tool_use blocks) | Claude responds |
| `tool` | — | `content`, `tool_use_id` | Tool result |
| `result` | `success` | `result`, `structured_output` | Done |
| `result` | `error_*` | `error` | Failed |

### Permission Modes
- `default` — unmatched tools trigger `canUseTool` callback
- `acceptEdits` — auto-approve Write, Edit, mkdir, rm, mv, cp
- `bypassPermissions` — all tools auto-approved (propagates to subagents)
- `plan` — no tool execution

### Hooks
```typescript
hooks: {
  PreToolUse: [{ matcher: "Bash|Write", hooks: [callback] }],
  PostToolUse: [{ hooks: [logCallback] }],
  Stop: [{ hooks: [cleanupCallback] }],
}
```
Callbacks: `(input, toolUseId, context) => {}` to allow, `{ hookSpecificOutput: { permissionDecision: "deny" } }` to block.

Available hooks: `PreToolUse`, `PostToolUse`, `PostToolUseFailure` (TS), `UserPromptSubmit`, `Stop`, `SubagentStart` (TS), `SubagentStop`, `PreCompact`, `PermissionRequest` (TS), `SessionStart` (TS), `SessionEnd` (TS), `Notification` (TS).

### MCP Servers
```typescript
mcpServers: {
  "name": { command: "npx", args: ["-y", "pkg"], env: { TOKEN: "..." } },  // stdio
  "name": { type: "http", url: "https://...", headers: { Authorization: "..." } }, // HTTP
},
allowedTools: ["mcp__name__*"]  // required to grant access
```

### Sessions
Capture `session_id` from `system` init message. Resume: `resume: sessionId`. Fork: `forkSession: true`.

### Structured Outputs
```typescript
outputFormat: { type: "json_schema", schema: { type: "object", properties: {...}, required: [...] } }
```
Access via `message.structured_output`. Supports Zod (TS) and Pydantic (Python) for type-safe schemas.
