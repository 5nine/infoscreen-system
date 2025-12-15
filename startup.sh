#!/bin/bash
# Startup script for Själevads Bygg Info Screen

cd /home/pi/infoscreen-system

# Start the server
node server/webserver.js &

# Wait for server to start
sleep 5

#!/bin/bash
# start-both.sh
# Startar båda kiosklägen på samma maskin med två skärmar

echo "🚀 Starting Dual Kiosk Mode..."
echo "================================"

# Kill all existing Chromium instances
pkill -f chromium
sleep 3

# Server IP
SERVER_IP="localhost"  # Ändra om nödvändigt
SERVER_PORT="8080"

# TV Screen (skärm 0)
TV_URL="http://$SERVER_IP:$SERVER_PORT/"
TV_SCREEN="0"
TV_WIDTH="1920"
TV_HEIGHT="1080"

# Touch Screen (skärm 1)
TOUCH_URL="http://$SERVER_IP:$SERVER_PORT/touch-control"
TOUCH_SCREEN="1"  # Andra skärmen
TOUCH_WIDTH="800"
TOUCH_HEIGHT="1280"

# Base Chromium flags
BASE_FLAGS="
--kiosk
--noerrdialogs
--disable-translate
--no-first-run
--fast
--fast-start
--disable-features=TranslateUI
--disable-infobars
--disable-session-crashed-bubble
--disable-component-update
--start-fullscreen
--force-device-scale-factor=1
--disable-background-networking
--disable-background-timer-throttling
--disable-backgrounding-occluded-windows
--disable-breakpad
--disable-client-side-phishing-detection
--disable-default-apps
--disable-dev-shm-usage
--disable-domain-reliability
--disable-extensions
--disable-features=AudioServiceOutOfProcess
--disable-hang-monitor
--disable-ipc-flooding-protection
--disable-notifications
--disable-offer-store-unmasked-wallet-cards
--disable-popup-blocking
--disable-print-preview
--disable-prompt-on-repost
--disable-renderer-backgrounding
--disable-speech-api
--disable-sync
--hide-scrollbars
--ignore-gpu-blacklist
--metrics-recording-only
--mute-audio
--no-default-browser-check
--no-pings
--no-zygote
--password-store=basic
--use-gl=swiftshader
--use-mock-keychain
--check-for-update-interval=31536000
--disable-accelerated-2d-canvas
--disable-gpu
"

# Start TV Kiosk (Screen 0)
echo "🖥️  Starting TV Kiosk on screen $TV_SCREEN..."
TV_FLAGS="$BASE_FLAGS --app=$TV_URL --window-size=$TV_WIDTH,$TV_HEIGHT --window-position=0,0"
DISPLAY=:0.$TV_SCREEN chromium $TV_FLAGS &
TV_PID=$!
echo $TV_PID > /tmp/tv-kiosk.pid
echo "✅ TV Chromium PID: $TV_PID"

sleep 2

# Start Touch Kiosk (Screen 1)
echo "📱 Starting Touch Kiosk on screen $TOUCH_SCREEN..."
TOUCH_FLAGS="$BASE_FLAGS --app=$TOUCH_URL --window-size=$TOUCH_WIDTH,$TOUCH_HEIGHT --window-position=1920,0 --touch-events=enabled --enable-touch-drag-drop"
DISPLAY=:0.$TOUCH_SCREEN chromium $TOUCH_FLAGS &
TOUCH_PID=$!
echo $TOUCH_PID > /tmp/touch-kiosk.pid
echo "✅ Touch Chromium PID: $TOUCH_PID"

echo "================================"
echo "🎯 Both kiosks started successfully!"
echo "TV:     $TV_URL"
echo "Touch:  $TOUCH_URL"

# Monitor processes
while true; do
    if ! kill -0 $TV_PID 2>/dev/null; then
        echo "⚠️  TV Chromium died, restarting..."
        DISPLAY=:0.$TV_SCREEN chromium $TV_FLAGS &
        TV_PID=$!
        echo $TV_PID > /tmp/tv-kiosk.pid
    fi
    
    if ! kill -0 $TOUCH_PID 2>/dev/null; then
        echo "⚠️  Touch Chromium died, restarting..."
        DISPLAY=:0.$TOUCH_SCREEN chromium $TOUCH_FLAGS &
        TOUCH_PID=$!
        echo $TOUCH_PID > /tmp/touch-kiosk.pid
    fi
    
    sleep 10
done
