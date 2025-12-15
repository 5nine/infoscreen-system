#!/bin/bash
# Remote installation script

echo "🌐 Remote installation..."

# Download from GitHub
cd /home/pi
if [ -d "infoscreen-system" ]; then
    echo "Updating existing installation..."
    cd infoscreen-system
    git pull
else
    echo "Cloning repository..."
    git clone https://github.com/din-organisation/infoscreen-system.git
    cd infoscreen-system
fi

# Install
sudo ./install.sh

echo "✅ Remote installation complete"