#!/bin/bash
# start-rpi-system.sh
# Smart display detection för Raspberry Pi

# Vänta på att desktop laddas
sleep 5

# Starta servern
cd ~/infoscreen-system/server
node webserver.js &
echo "✅ Server started"
cd ~/infoscreen-system
# Vänta på servern
sleep 3

# === IDENTIFIERA SKÄRMAR ===
echo "🔍 Detecting displays..."

# Metod 1: Kolla via tvservice
HDMI_CONNECTED=$(tvservice -l 2>/dev/null | grep -c "HDMI")
DSI_CONNECTED=$(tvservice -l 2>/dev/null | grep -c "DSI")

echo "HDMI displays: $HDMI_CONNECTED"
echo "DSI displays: $DSI_CONNECTED"

# Metod 2: Kolla framebuffers
if [ -e "/dev/fb0" ]; then
    echo "Framebuffer 0 exists (likely primary)"
fi
if [ -e "/dev/fb1" ]; then
    echo "Framebuffer 1 exists (likely secondary)"
fi

# === STARTA TOUCH PÅ RÄTT SKÄRM ===
# Fall 1: Official RPi 7" Touch Display (DSI)
if [ "$DSI_CONNECTED" -gt 0 ]; then
    echo "👆 Starting on DSI touch display..."
    
    # Sätt DSI som primär om inte redan
    if ! xrandr --query | grep -q "DSI-1 connected primary"; then
        xrandr --output DSI-1 --primary
    fi
    
    # Starta touch på DSI-1
    chromium \
        --kiosk \
        --noerrdialogs \
        --disable-translate \
        --app="http://localhost:8080/touch-control" \
        --window-size=800,1280 \
        --window-position=0,0 \
        --display=:0.0 \
        --start-fullscreen \
        --user-data-dir=/tmp/chrome-touch &
    
    TOUCH_PID=$!
    echo "✅ Touch started on DSI-1 (PID: $TOUCH_PID)"
    
# Fall 2: Ingen DSI, använd HDMI-1 för touch (om ingen TV)
elif [ "$HDMI_CONNECTED" -eq 1 ]; then
    echo "⚠️  No DSI found, using single HDMI for touch..."
    
    chromium \
        --kiosk \
        --noerrdialogs \
        --disable-translate \
        --app="http://localhost:8080/touch-control" \
        --window-size=800,1280 \
        --start-fullscreen \
        --user-data-dir=/tmp/chrome-touch &
    
    echo "✅ Touch started on HDMI (single display)"
    
else
    echo "❌ No displays detected!"
    exit 1
fi

# === STARTA TV PÅ HDMI (OM FINNS) ===
if [ "$HDMI_CONNECTED" -gt 0 ] && [ "$DSI_CONNECTED" -gt 0 ]; then
    echo "📺 Starting TV on HDMI..."
    sleep 2
    
    # Sätt HDMI-1 rätt (1920x1080)
    xrandr --output HDMI-1 --mode 1920x1080 --right-of DSI-1
    
    # Starta TV på HDMI
    chromium \
        --kiosk \
        --noerrdialogs \
        --disable-translate \
        --app="http://localhost:8080/" \
        --window-size=1920,1080 \
        --window-position=800,0 \
        --display=:0.0 \
        --start-fullscreen \
        --user-data-dir=/tmp/chrome-tv &
    
    TV_PID=$!
    echo "✅ TV started on HDMI-1 (PID: $TV_PID)"
fi

echo ""
echo "🎯 System ready!"
echo "Touch: http://localhost:8080/touch-control"
echo "TV:    http://localhost:8080/"