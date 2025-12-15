#!/bin/bash
# start-rpi-system-v2.sh
# Bättre display detection för RPi

echo "🔍 Advanced RPi display detection..."

# === METOD 1: Kolla /sys/class/drm ===
echo "Checking /sys/class/drm..."
DRM_DEVICES=$(ls /sys/class/drm/ | grep -E "card[0-9]-" | sort)
echo "DRM devices found:"
for device in $DRM_DEVICES; do
    STATUS=$(cat /sys/class/drm/$device/status 2>/dev/null || echo "unknown")
    echo "  $device: $STATUS"
done

# === METOD 2: Kolla framebuffers ===
echo ""
echo "Checking framebuffers..."
if ls /dev/fb* >/dev/null 2>&1; then
    echo "Framebuffers:"
    ls /dev/fb*
    for fb in /dev/fb*; do
        echo "  $fb: $(cat /sys/class/graphics/$(basename $fb)/name 2>/dev/null || echo "unknown")"
    done
else
    echo "No framebuffers found in /dev/fb*"
fi

# === METOD 3: Kolla X11 displays ===
echo ""
echo "Checking X11 displays..."
export DISPLAY=:0
if command -v xrandr >/dev/null 2>&1; then
    XRANDR_OUTPUT=$(xrandr --query 2>/dev/null)
    if [ $? -eq 0 ]; then
        echo "xrandr output:"
        echo "$XRANDR_OUTPUT" | grep -E "(connected|disconnected)"
    else
        echo "xrandr failed - is X running?"
    fi
else
    echo "xrandr not installed"
fi

# === METOD 4: Kolla EDID direkt ===
echo ""
echo "Checking for EDID data..."
for edid in /sys/class/drm/*/edid; do
    if [ -f "$edid" ] && [ $(stat -c%s "$edid") -gt 0 ]; then
        DEVICE=$(dirname $(dirname "$edid"))
        echo "EDID found for: $(basename $DEVICE)"
        # Visa första raden av EDID
        hexdump -C "$edid" | head -5
    fi
done

# === BESTÄMM DISPLAYS BASERAT PÅ UPPTÄCKT ===
echo ""
echo "=== Determining display assignments ==="

TOUCH_DISPLAY=""
TV_DISPLAY=""

# Fall 1: HDMI finns (vanligtvis TV)
if ls /sys/class/drm/*HDMI* >/dev/null 2>&1; then
    HDMI_DEVICE=$(ls /sys/class/drm/*HDMI* | head -1 | xargs basename)
    if [ -f "/sys/class/drm/$HDMI_DEVICE/status" ] && grep -q "connected" "/sys/class/drm/$HDMI_DEVICE/status"; then
        TV_DISPLAY="$HDMI_DEVICE"
        echo "✅ TV display detected: $TV_DISPLAY"
    fi
fi

# Fall 2: DSI/DPI (officiell RPi touch)
if ls /sys/class/drm/*DSI* >/dev/null 2>&1; then
    DSI_DEVICE=$(ls /sys/class/drm/*DSI* | head -1 | xargs basename)
    TOUCH_DISPLAY="$DSI_DEVICE"
    echo "✅ Touch display detected (DSI): $TOUCH_DISPLAY"
elif ls /sys/class/drm/*DPI* >/dev/null 2>&1; then
    DPI_DEVICE=$(ls /sys/class/drm/*DPI* | head -1 | xargs basename)
    TOUCH_DISPLAY="$DPI_DEVICE"
    echo "✅ Touch display detected (DPI): $TOUCH_DISPLAY"
fi

# Fall 3: Ingen DSI/DPI hittad, använd första anslutna
if [ -z "$TOUCH_DISPLAY" ]; then
    FIRST_CONNECTED=$(find /sys/class/drm/ -name "status" -exec grep -l "connected" {} \; | head -1)
    if [ -n "$FIRST_CONNECTED" ]; then
        TOUCH_DISPLAY=$(basename $(dirname "$FIRST_CONNECTED"))
        echo "⚠️  Using first connected as touch: $TOUCH_DISPLAY"
    fi
fi

# === OM INGEN DISPLAY HITTATS ===
if [ -z "$TOUCH_DISPLAY" ] && [ -z "$TV_DISPLAY" ]; then
    echo ""
    echo "❌ CRITICAL: No displays detected via standard methods!"
    echo ""
    echo "Possible solutions:"
    echo "1. Is the touch screen properly connected and powered?"
    echo "2. Check /boot/config.txt for display settings"
    echo "3. Try: tvservice -l"
    echo "4. Try: dmesg | grep -i drm"
    echo ""
    echo "For now, we'll try to start anyway on default display..."
    
    # Försök starta ändå på :0
    TOUCH_DISPLAY="default"
fi

# === STARTA SYSTEMET ===
echo ""
echo "🎯 Starting system with:"
echo "  Touch: $TOUCH_DISPLAY"
echo "  TV:    $TV_DISPLAY"

# Starta servern
cd ~/infoscreen-system
node webserver.js &
sleep 3

# Starta touch display
echo "👆 Starting touch control..."
if [ "$TOUCH_DISPLAY" = "default" ] || [ -z "$TOUCH_DISPLAY" ]; then
    # Ingen specific display, använd standard
    chromium \
        --kiosk \
        --noerrdialogs \
        --disable-translate \
        --app="http://localhost:8080/touch-control" \
        --window-size=800,1280 \
        --start-fullscreen \
        --user-data-dir=/tmp/chrome-touch-$(date +%s) &
else
    # Specifik display
    chromium \
        --kiosk \
        --noerrdialogs \
        --disable-translate \
        --app="http://localhost:8080/touch-control" \
        --window-size=800,1280 \
        --start-fullscreen \
        --user-data-dir=/tmp/chrome-touch-$(date +%s) &
fi

# Starta TV om den hittades
if [ -n "$TV_DISPLAY" ] && [ "$TV_DISPLAY" != "$TOUCH_DISPLAY" ]; then
    echo "📺 Starting TV display..."
    sleep 2
    
    chromium \
        --kiosk \
        --noerrdialogs \
        --disable-translate \
        --app="http://localhost:8080/" \
        --window-size=1920,1080 \
        --start-fullscreen \
        --user-data-dir=/tmp/chrome-tv-$(date +%s) &
fi

echo ""
echo "✅ System startup attempted!"
echo "If windows appear on wrong screen, we need to debug further."