#!/bin/bash
# Rotate display for touch screen

echo "🔄 Rotating display..."

# Check if config.txt exists
if [ ! -f /boot/config.txt ]; then
    echo "❌ /boot/config.txt not found"
    exit 1
fi

# Backup config
sudo cp /boot/config.txt /boot/config.txt.backup

# Add rotation settings
sudo tee -a /boot/config.txt << EOF

# Display rotation
display_rotate=1
EOF

echo "✅ Display rotated to portrait"
echo "🔄 Reboot required: sudo reboot"