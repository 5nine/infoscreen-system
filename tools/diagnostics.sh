#!/bin/bash
# System diagnostics tool

echo "🩺 Running diagnostics..."

# System info
echo "=== SYSTEM ==="
uname -a
echo "Uptime: $(uptime)"
echo ""

# Disk space
echo "=== DISK ==="
df -h
echo ""

# Memory
echo "=== MEMORY ==="
free -h
echo ""

# Network
echo "=== NETWORK ==="
ifconfig | grep -A 1 "inet "
echo ""

# Service status
echo "=== SERVICES ==="
systemctl status infoscreen --no-pager
echo ""

# Node processes
echo "=== PROCESSES ==="
ps aux | grep node
echo ""

echo "✅ Diagnostics complete"