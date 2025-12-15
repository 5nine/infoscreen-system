#!/bin/bash
# Installation script for Själevads Bygg Info Screen System

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

INSTALL_DIR="/home/pi/infoscreen-system"
SERVICE_NAME="infoscreen"
USER="pi"

print_header() {
    echo -e "\n${GREEN}========================================${NC}"
    echo -e "${GREEN}$1${NC}"
    echo -e "${GREEN}========================================${NC}\n"
}

print_step() {
    echo -e "${YELLOW}[+] $1${NC}"
}

print_success() {
    echo -e "${GREEN}[✓] $1${NC}"
}

print_error() {
    echo -e "${RED}[✗] $1${NC}"
}

check_root() {
    if [ "$EUID" -ne 0 ]; then 
        print_error "Run as root (use sudo)"
        exit 1
    fi
}

check_internet() {
    print_step "Checking internet..."
    if ! ping -c 1 -W 5 google.com > /dev/null 2>&1; then
        print_error "No internet"
        exit 1
    fi
    print_success "Internet OK"
}

update_system() {
    print_step "Updating system..."
    apt update && apt upgrade -y
    print_success "System updated"
}

install_dependencies() {
    print_step "Installing dependencies..."
    
    if ! command -v node &> /dev/null; then
        print_step "Installing Node.js..."
        curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
        apt install -y nodejs
    fi
    
    apt install -y chromium-browser imagemagick git net-tools
    print_success "Dependencies installed"
}

configure_system() {
    print_step "Configuring system..."
    echo -e "\n# Disable screen blanking\nxset s off\nxset -dpms\nxset s noblank" >> /home/$USER/.bashrc
    print_success "System configured"
}

setup_project() {
    print_step "Setting up project..."
    mkdir -p $INSTALL_DIR/images $INSTALL_DIR/thumbnails $INSTALL_DIR/logs $INSTALL_DIR/backups
    chown -R $USER:$USER $INSTALL_DIR
    chmod 755 $INSTALL_DIR
    print_success "Project directories created"
}

install_node_modules() {
    print_step "Installing Node modules..."
    cd $INSTALL_DIR
    sudo -u $USER npm install --production
    print_success "Node modules installed"
}

setup_service() {
    print_step "Setting up service..."
    cp $INSTALL_DIR/infoscreen.service /etc/systemd/system/
    systemctl daemon-reload
    systemctl enable $SERVICE_NAME
    print_success "Service configured"
}

configure_kiosk() {
    print_step "Configuring kiosk..."
    AUTOSTART_DIR="/home/$USER/.config/autostart"
    mkdir -p $AUTOSTART_DIR
    
    cat > $AUTOSTART_DIR/infoscreen.desktop << EOF
[Desktop Entry]
Type=Application
Name=Info Screen
Exec=chromium-browser --kiosk --incognito --disable-features=TranslateUI --disable-component-update --disable-pinch --noerrdialogs --disable-infobars http://localhost:8080
Hidden=false
X-GNOME-Autostart-enabled=true
EOF
    
    chown -R $USER:$USER $AUTOSTART_DIR
    print_success "Kiosk configured"
}

generate_ssl() {
    print_step "Generating SSL..."
    cd $INSTALL_DIR
    if [ ! -f "ssl/cert.pem" ] || [ ! -f "ssl/key.pem" ]; then
        mkdir -p ssl
        openssl req -x509 -newkey rsa:4096 -keyout ssl/key.pem -out ssl/cert.pem -days 365 -nodes -subj "/C=SE/ST=Vasternorrland/L=Ornskoldsvik/O=Sjalevads Bygg/CN=infoscreen.local"
        chmod 600 ssl/*
        chown -R $USER:$USER ssl
    fi
    print_success "SSL generated"
}

post_install() {
    print_step "Post-install..."
    cd $INSTALL_DIR
    sudo -u $USER node server/thumbnail-generator.js
    systemctl start $SERVICE_NAME
    sleep 3
    print_success "Post-install done"
}

show_summary() {
    print_header "INSTALLATION COMPLETE"
    
    IP_ADDRESS=$(hostname -I | awk '{print $1}')
    
    echo -e "${GREEN}🎉 Själevads Bygg Info Screen System installed!${NC}"
    echo ""
    echo -e "${YELLOW}📡 Access URLs:${NC}"
    echo -e "  • Info Screen:      http://$IP_ADDRESS:8080"
    echo -e "  • Touch Control:    http://$IP_ADDRESS:8080/touch-control.html"
    echo -e "  • Admin Panel:      http://$IP_ADDRESS:8080/admin"
    echo ""
    echo -e "${YELLOW}🔧 Commands:${NC}"
    echo -e "  • Start:  sudo systemctl start $SERVICE_NAME"
    echo -e "  • Stop:   sudo systemctl stop $SERVICE_NAME"
    echo -e "  • Status: sudo systemctl status $SERVICE_NAME"
    echo -e "  • Logs:   sudo journalctl -u $SERVICE_NAME -f"
    echo ""
    echo -e "${YELLOW}📝 Next:${NC}"
    echo -e "  1. Upload images to: $INSTALL_DIR/images/"
    echo -e "  2. Configure config.json"
    echo -e "  3. Reboot: sudo reboot"
}

main() {
    print_header "SJÄLEVADS BYGG INFO SCREEN INSTALLATION"
    check_root
    check_internet
    update_system
    install_dependencies
    configure_system
    setup_project
    install_node_modules
    setup_service
    configure_kiosk
    generate_ssl
    post_install
    show_summary
}

main