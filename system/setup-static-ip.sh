#!/bin/bash
# Setup static IP for Raspberry Pi

echo "🔧 Setting up static IP..."

# Backup current config
sudo cp /etc/dhcpcd.conf /etc/dhcpcd.conf.backup

# Get current network info
INTERFACE=$(ip route | grep default | awk '{print $5}')
CURRENT_IP=$(hostname -I | awk '{print $1}')
GATEWAY=$(ip route | grep default | awk '{print $3}')
DNS_SERVER="8.8.8.8"

echo "Interface: $INTERFACE"
echo "Current IP: $CURRENT_IP"
echo "Gateway: $GATEWAY"

# Ask for static IP
read -p "Enter static IP [$CURRENT_IP]: " STATIC_IP
STATIC_IP=${STATIC_IP:-$CURRENT_IP}

# Configure static IP
sudo tee -a /etc/dhcpcd.conf << EOF

# Static IP configuration for $INTERFACE
interface $INTERFACE
static ip_address=$STATIC_IP/24
static routers=$GATEWAY
static domain_name_servers=$DNS_SERVER
EOF

echo "✅ Static IP configured: $STATIC_IP"
echo "📝 Restart network with: sudo systemctl restart dhcpcd"