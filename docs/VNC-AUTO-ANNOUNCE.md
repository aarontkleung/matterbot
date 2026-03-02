# VNC Auto-Announcement Update

## Changes Made

Updated the agent-browser skill to automatically announce VNC URLs when browser automation starts.

### 1. Updated agent-browser skill

**File**: `container/skills/agent-browser/SKILL.md`

Added prominent VNC announcement section at the top:
```bash
if [ "$ENABLE_VNC" = "1" ]; then
  echo "🖥️ Browser View: http://${VNC_HOST:-localhost}:${VNC_PORT}"
  echo ""
  echo "You can watch and control the browser in real-time by opening this link."
  echo ""
fi
```

This teaches agents to:
- Check `$ENABLE_VNC` environment variable before using agent-browser
- Announce the VNC URL with the correct host and port
- Provide clear instructions to users

### 2. Updated container-runner

**File**: `src/container-runner.ts`

Added VNC_HOST environment variable to container:
```typescript
args.push('-e', `VNC_HOST=${VNC_HOST}`);
args.push('-e', `VNC_PORT=${vncPort}`); // Host port, not container port
```

This ensures agents have access to:
- `$ENABLE_VNC` - whether VNC is enabled (1 or empty)
- `$VNC_PORT` - the host port to use in URLs (e.g., 6080, 6081, etc.)
- `$VNC_HOST` - the hostname for URLs (default: localhost)

## How It Works Now

When a user triggers a browser task:

```
User: @Andy open google.com and search for AI news

Agent: 🖥️ Browser View: http://localhost:6080

You can watch and control the browser in real-time by opening this link.

Opening google.com...
[continues with browser automation]
```

## Agent Behavior

The agent will **automatically** announce the VNC URL:
- Before the first `agent-browser` command
- Every time it starts a new browser task
- With the correct port for that specific container

## Example Agent Flow

```bash
# Agent checks VNC status
if [ "$ENABLE_VNC" = "1" ]; then
  echo "🖥️ Browser View: http://localhost:6080"
  echo ""
  echo "Opening the browser. You can watch and control it in real-time."
  echo ""
fi

# Agent proceeds with automation
agent-browser open https://google.com
agent-browser snapshot -i
agent-browser fill @e1 "AI news"
agent-browser press Enter
```

## Multiple Containers

Each container gets its own port:
- Container 1: `http://localhost:6080`
- Container 2: `http://localhost:6081`
- Container 3: `http://localhost:6082`

The agent automatically uses the correct port for its container.

## Verification

✅ agent-browser skill updated with VNC announcement
✅ VNC_HOST and VNC_PORT passed to containers
✅ TypeScript compiled
✅ Service restarted

## Next Steps

Try triggering a browser task via Telegram. The agent should automatically announce the VNC URL before starting browser automation!
