---
name: agent-browser-ui
description: Enable real-time browser viewing and control through noVNC when performing browser automation tasks. Use when you need visual feedback or user intervention (e.g., captchas, debugging).
allowed-tools: Bash(agent-browser:*)
---

# Agent Browser UI - Real-Time Browser Access

When VNC is enabled, you can provide users with real-time visual access to browser automation tasks through a web interface.

## Quick Check

Before starting any browser task, check if VNC is enabled:

```bash
echo $ENABLE_VNC
```

If the output is `1`, VNC is enabled and you should announce the browser view URL.

## Usage Pattern

When VNC is enabled (`ENABLE_VNC=1`):

1. **Announce the VNC URL** before starting browser tasks:
   ```
   🖥️ Browser View: http://<host>:$VNC_PORT

   I'm starting a browser task. You can watch and control the browser in real-time by opening the link above.
   ```

2. **Wait 5 seconds** to give the user time to connect:
   ```bash
   sleep 5
   ```

3. **Proceed with browser automation** using agent-browser commands

4. **Remind about intervention** if the task involves:
   - Authentication flows with captchas
   - Complex navigation requiring visual debugging
   - Any scenario where user input might be needed

## When to Use

Use this skill when:
- Performing complex web navigation that benefits from visual feedback
- Dealing with authentication flows that might have captchas
- Debugging browser automation issues
- User explicitly requests to watch the browser
- Task involves interactive elements that might need manual intervention

## Example

```bash
# Check if VNC is enabled
if [ "$ENABLE_VNC" = "1" ]; then
  echo "🖥️ Browser View: http://localhost:$VNC_PORT"
  echo ""
  echo "Opening the browser. You can watch and control it in real-time."
  sleep 5
fi

# Proceed with browser automation
agent-browser open https://example.com/login
agent-browser snapshot -i
# ... continue with automation
```

## Important Notes

- VNC is **optional** and disabled by default to keep containers lightweight
- The VNC session is tied to the container lifecycle (ephemeral)
- Users can interact with the browser through the web interface (click, type, scroll)
- The browser runs in a virtual X11 display (Xvfb) with VNC/noVNC providing web access
- No client software needed - works in any modern web browser

## Technical Details

- Display: `:99` (Xvfb virtual display)
- VNC Port: `5900` (internal)
- noVNC Port: `6080` (exposed, mapped to host)
- Resolution: `1280x720x24`
- Access: No password required (localhost only)
