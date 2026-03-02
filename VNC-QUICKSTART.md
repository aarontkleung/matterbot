# VNC Quick Reference

## Status: ✅ ENABLED

VNC is now active in your MatterBot installation.

## What This Means

When you trigger browser automation tasks via Telegram, the agent will send you a clickable URL like:

```
🖥️ Browser View: http://localhost:6080

I'm starting a browser task. You can watch and control the browser in real-time.
```

## How to Use

1. **Trigger a browser task** via Telegram:
   ```
   @Andy open google.com and search for "AI news"
   ```

2. **Click the VNC URL** the agent sends (works on phone or desktop)

3. **Watch and control** the browser in real-time through your web browser

4. **Intervene if needed** (solve captchas, click buttons, etc.)

## Example Tasks to Try

```
@Andy login to example.com (I'll solve any captchas)
@Andy search for "best restaurants near me" and take a screenshot
@Andy navigate to github.com and show me trending repositories
```

## Port Allocation

- First container: http://localhost:6080
- Second container: http://localhost:6081
- Third container: http://localhost:6082
- ... up to http://localhost:6089

## Verification

✅ Container rebuilt with VNC packages
✅ ENABLE_VNC=1 in .env
✅ MatterBot service restarted
✅ noVNC web interface tested and working

## To Disable VNC

If you want to disable VNC later (to reduce container overhead):

1. Comment out in `.env`:
   ```bash
   # ENABLE_VNC=1
   ```

2. Restart:
   ```bash
   systemctl --user restart matterbot
   ```

## Documentation

- Full guide: `docs/VNC.md`
- Examples: `docs/VNC-EXAMPLES.md`
- Implementation: `docs/VNC-IMPLEMENTATION.md`

## Next Steps

Try triggering a browser task via Telegram and click the VNC URL to see it in action!
