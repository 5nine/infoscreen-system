#!/bin/bash
# Startup script for Själevads Bygg Info Screen

cd /home/pi/infoscreen-system

# Start the server
node server/webserver.js &

# Wait for server to start
sleep 5

# Open Chromium in kiosk mode
export DISPLAY=:0
chromium-browser --kiosk --incognito --disable-features=TranslateUI --disable-component-update --disable-pinch --noerrdialogs --disable-infobars http://localhost:8080 &