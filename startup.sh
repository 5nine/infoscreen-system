#!/bin/bash
# Startup script for Själevads Bygg Info Screen

cd /home/pi/infoscreen-system

# Start the server
node server/webserver.js &

# Wait for server to start
sleep 5

# start-infoscreen-system.sh
# Startar hela infoscreen-system på RPi

# 1. Starta servern (i bakgrunden)
cd ~/infoscreen-system/server
node webserver.js &
SERVER_PID=$!
echo "✅ Server started (PID: $SERVER_PID)"

# 2. Vänta på att servern startar
sleep 3

# 3. Sätt DISPLAY
export DISPLAY=:0

# 4. Starta touch på DSI-1 (touch-display)
echo "👆 Starting touch control on DSI-1..."
chromium \
    --kiosk \
    --noerrdialogs \
    --disable-translate \
    --app="http://localhost:8080/touch-control" \
    --window-size=800,1280 \
    --display=DSI-1 \
    --start-fullscreen &
TOUCH_PID=$!

# 5. Starta TV på HDMI-1 (om ansluten)
sleep 2
echo "🖥️  Starting TV display on HDMI-1..."
chromium \
    --kiosk \
    --noerrdialogs \
    --disable-translate \
    --app="http://localhost:8080/" \
    --window-size=1920,1080 \
    --display=HDMI-A-1 \
    --start-fullscreen &
TV_PID=$!

echo "✅ System started!"
echo "   Server: $SERVER_PID"
echo "   Touch:  $TOUCH_PID"
echo "   TV:     $TV_PID"