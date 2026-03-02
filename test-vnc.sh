#!/bin/bash
# Test VNC functionality

echo "Testing VNC container setup..."
echo ""

# Test 1: Run container with VNC enabled
echo "Test 1: Starting container with VNC enabled..."
docker run -d --rm --name vnc-test \
  -p 6080:6080 \
  -e ENABLE_VNC=1 \
  -e VNC_PORT=6080 \
  --entrypoint bash \
  matterbot-agent:latest \
  -c "
    # Start VNC stack
    Xvfb :99 -screen 0 1280x720x24 &
    sleep 2
    x11vnc -display :99 -forever -shared -rfbport 5900 -nopw &
    sleep 1
    websockify --web /usr/share/novnc 6080 localhost:5900 &
    sleep 2

    # Test if services are running
    ps aux | grep -E 'Xvfb|x11vnc|websockify' | grep -v grep

    # Keep container alive for testing
    sleep 30
  "

sleep 5

# Check if container is running
if docker ps | grep -q vnc-test; then
  echo "✓ Container started successfully"

  # Check if port is accessible
  if curl -s http://localhost:6080/vnc.html > /dev/null; then
    echo "✓ noVNC web interface is accessible at http://localhost:6080"
    echo ""
    echo "Open http://localhost:6080/vnc.html in your browser to test"
    echo "Press Enter to stop the test container..."
    read
  else
    echo "✗ noVNC web interface not accessible"
  fi
else
  echo "✗ Container failed to start"
fi

# Cleanup
echo "Stopping test container..."
docker stop vnc-test 2>/dev/null || true
echo "Test complete"
