#!/bin/bash
set -e

# Start VNC stack if enabled
if [ "$ENABLE_VNC" = "1" ]; then
  echo "Starting VNC services on port ${VNC_PORT}..."
  Xvfb :99 -screen 0 1280x720x24 &
  sleep 1
  # Optimized x11vnc flags:
  # -noxdamage: disable X DAMAGE extension (reduces CPU, recommended by x11vnc)
  # -wait 10: poll every 10ms instead of constantly (reduces CPU)
  # -defer 10: defer updates by 10ms to batch changes
  # -ncache 10: client-side caching for faster rendering
  x11vnc -display :99 -forever -shared -rfbport 5900 -nopw -noxdamage -wait 10 -defer 10 -ncache 10 &
  websockify --web /usr/share/novnc ${VNC_PORT} localhost:5900 &
  echo "VNC ready at http://localhost:${VNC_PORT}/vnc.html"

  # Enable headed mode for agent-browser so it renders to X display
  export AGENT_BROWSER_HEADED=1
fi

cd /app && npx tsc --outDir /tmp/dist 2>&1 >&2
ln -s /app/node_modules /tmp/dist/node_modules
chmod -R a-w /tmp/dist
cat > /tmp/input.json
node /tmp/dist/index.js < /tmp/input.json
