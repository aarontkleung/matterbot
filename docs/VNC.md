# noVNC Browser-in-Browser Support

MatterBot now supports real-time browser viewing and control through noVNC. When enabled, agents can provide clickable URLs that let you watch and interact with browser automation tasks in real-time.

## Features

- **Zero client setup**: Works in any modern web browser
- **Real-time viewing**: Watch browser automation as it happens
- **Interactive control**: Click, type, scroll in the browser window
- **Perfect for**:
  - Solving captchas during automation
  - Debugging navigation issues
  - Observing agent behavior
  - Manual intervention when needed

## Setup

### 1. Enable VNC

Add to your `.env` file:

```bash
ENABLE_VNC=1
```

Optional configuration:

```bash
VNC_PORT_START=6080  # First port in allocation range
VNC_PORT_END=6089    # Last port in allocation range
VNC_HOST=localhost   # Hostname for VNC URLs
```

### 2. Rebuild Container

```bash
./container/build.sh
```

### 3. Restart MatterBot

```bash
systemctl --user restart matterbot
```

## Usage

When VNC is enabled, agents will automatically announce browser view URLs before starting browser tasks:

```
🖥️ Browser View: http://localhost:6080

I'm starting a browser task. You can watch and control the browser in real-time by opening the link above.
```

Simply click the link (or open it on your phone/desktop) to access the browser interface.

## How It Works

1. **Container starts** with VNC enabled
2. **Xvfb** creates a virtual X11 display (`:99`)
3. **x11vnc** exposes the display via VNC protocol
4. **websockify + noVNC** provides web-based access
5. **Chromium** runs in the virtual display
6. **You** access it through any web browser

## Port Allocation

- Supports up to 10 concurrent VNC sessions (ports 6080-6089 by default)
- Ports are automatically allocated and released
- If all ports are in use, containers run without VNC (headless mode)

## Testing

Run the test script to verify VNC functionality:

```bash
./test-vnc.sh
```

This will:
1. Start a test container with VNC enabled
2. Verify services are running
3. Check if noVNC is accessible
4. Provide a URL to test in your browser

## Agent Integration

Agents automatically use the `agent-browser-ui` skill when VNC is enabled. The skill:

1. Checks `$ENABLE_VNC` environment variable
2. Announces VNC URL if enabled
3. Waits 5 seconds for user to connect
4. Proceeds with browser automation

## Performance Impact

- **Container size**: +200-300MB (VNC packages)
- **Runtime overhead**: Minimal (Xvfb + VNC services)
- **Mitigation**: VNC is optional and disabled by default

## Security Notes

- VNC has **no password** (localhost only)
- Only accessible from the host machine
- Sessions are ephemeral (tied to container lifecycle)
- For remote access, use SSH tunneling:
  ```bash
  ssh -L 6080:localhost:6080 user@host
  ```

## Troubleshooting

### VNC URL not appearing

Check if VNC is enabled:
```bash
grep ENABLE_VNC /home/aarontkleung/matterbot/.env
```

Check container logs:
```bash
journalctl --user -u matterbot -f
```

### Port already in use

Check allocated ports:
```bash
docker ps --format '{{.Names}}\t{{.Ports}}' | grep 6080
```

### Black screen in noVNC

Wait a few seconds for Xvfb to initialize. If it persists, check container logs.

## Example: Solving Captchas

```
User: @Andy login to example.com and check my messages

Agent: 🖥️ Browser View: http://localhost:6080

I'm opening example.com/login. If there's a captcha, you can solve it in the browser window.

[Agent proceeds with automation, user can intervene if needed]
```

## Disabling VNC

Remove or comment out from `.env`:
```bash
# ENABLE_VNC=1
```

Then restart:
```bash
systemctl --user restart matterbot
```

Containers will run in headless mode (no VNC overhead).
