# VNC Usage Example

## Scenario: Login to a website with captcha

### Without VNC (headless mode)

```
User: @Andy login to example.com and check my messages

Agent: I'll navigate to example.com/login...
[Agent gets stuck on captcha - no way to solve it]
Agent: I encountered a captcha. I cannot proceed automatically.
```

### With VNC enabled

```
User: @Andy login to example.com and check my messages

Agent: 🖥️ Browser View: http://localhost:6080

I'm opening example.com/login. If there's a captcha, you can solve it in the browser window.

[User clicks the link on their phone]
[User sees the browser in real-time through noVNC]
[Captcha appears - user solves it by clicking in the browser]
[Agent detects successful login and continues]

Agent: Successfully logged in! You have 3 new messages:
1. ...
2. ...
3. ...
```

## Scenario: Debugging navigation issues

### Without VNC

```
User: @Andy fill out the contact form on example.com

Agent: I navigated to example.com but couldn't find the contact form.
[User has no visibility into what went wrong]
```

### With VNC

```
User: @Andy fill out the contact form on example.com

Agent: 🖥️ Browser View: http://localhost:6080

Opening example.com...

[User clicks link and watches]
[User sees the page loaded but there's a cookie banner blocking the form]
[User clicks "Accept Cookies" in the browser]
[Agent detects the form is now visible and proceeds]

Agent: Found the contact form! Filling it out now...
```

## Scenario: Observing agent behavior

```
User: @Andy research the top 5 AI companies and create a comparison table

Agent: 🖥️ Browser View: http://localhost:6080

I'll search for information about top AI companies. You can watch my research process.

[User opens link out of curiosity]
[User watches as agent:
  - Searches Google
  - Clicks on TechCrunch article
  - Scrolls through content
  - Takes notes
  - Searches for next company
  - etc.]

Agent: Here's the comparison table:
...
```

## Technical Flow

1. **Container starts** with `ENABLE_VNC=1`
2. **Entrypoint script** starts VNC services:
   ```bash
   Xvfb :99 -screen 0 1280x720x24 &
   x11vnc -display :99 -forever -shared -rfbport 5900 -nopw &
   websockify --web /usr/share/novnc 6080 localhost:5900 &
   ```
3. **Container runner** allocates port (e.g., 6080) and maps it: `-p 6080:6080`
4. **Agent** checks `$ENABLE_VNC` and announces URL
5. **User** clicks URL → opens noVNC in browser
6. **noVNC** connects to websockify → connects to x11vnc → shows Xvfb display
7. **Chromium** runs in Xvfb display → user sees it in browser
8. **User** can click, type, scroll in the browser window
9. **Agent** continues automation, user can intervene anytime

## Port Allocation Example

Multiple concurrent sessions:

```
Container 1 (main group):     http://localhost:6080
Container 2 (family group):   http://localhost:6081
Container 3 (work group):     http://localhost:6082
...
Container 10 (max):           http://localhost:6089
```

If all ports are in use, new containers run headless (no VNC).

## Mobile Access

Works perfectly on mobile devices:
1. Agent sends VNC URL to Telegram
2. User taps link on phone
3. Browser opens noVNC interface
4. User can tap, swipe, type on phone screen
5. Actions control the browser in the container

## Remote Access

For remote access (e.g., from outside your network):

```bash
# On remote machine, create SSH tunnel
ssh -L 6080:localhost:6080 user@matterbot-host

# Then access http://localhost:6080 on remote machine
```

## Disabling VNC

To disable VNC and reduce container overhead:

1. Remove or comment out in `.env`:
   ```bash
   # ENABLE_VNC=1
   ```

2. Restart MatterBot:
   ```bash
   systemctl --user restart matterbot
   ```

Containers will run in headless mode (no VNC services, no port mapping).
