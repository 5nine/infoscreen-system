#!/bin/bash
# Installation script for Själevads Bygg Info Screen System

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
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
        print_error "Please run as root (use sudo)"
        exit 1
    fi
}

check_internet() {
    print_step "Checking internet connection..."
    if ! ping -c 1 -W 5 google.com > /dev/null 2>&1; then
        print_error "No internet connection. Please check your network."
        exit 1
    fi
    print_success "Internet connection OK"
}

update_system() {
    print_step "Updating system packages..."
    apt update && apt upgrade -y
    print_success "System updated"
}

install_dependencies() {
    print_step "Installing system dependencies..."
    
    # Node.js 18+
    if ! command -v node &> /dev/null; then
        print_step "Installing Node.js 18..."
        curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
        apt install -y nodejs
    fi
    
    # Chromium for kiosk mode
    apt install -y chromium-browser
    
    # ImageMagick for image processing
    apt install -y imagemagick
    
    # Git for updates
    apt install -y git
    
    # Network tools
    apt install -y net-tools
    
    # Screen utilities
    apt install -y x11-xserver-utils
    
    print_success "Dependencies installed"
}

configure_system() {
    print_step "Configuring system..."
    
    # Disable screen blanking
    echo -e "\n# Disable screen blanking\nxset s off\nxset -dpms\nxset s noblank" >> /home/$USER/.bashrc
    
    # Disable unnecessary services
    systemctl disable bluetooth > /dev/null 2>&1 || true
    systemctl disable hciuart > /dev/null 2>&1 || true
    systemctl disable triggerhappy > /dev/null 2>&1 || true
    
    # Set Swedish locale
    locale-gen sv_SE.UTF-8
    update-locale LANG=sv_SE.UTF-8
    
    print_success "System configured"
}

setup_project() {
    print_step "Setting up project..."
    
    # Create necessary directories
    mkdir -p $INSTALL_DIR/images
    mkdir -p $INSTALL_DIR/thumbnails
    mkdir -p $INSTALL_DIR/logs
    mkdir -p $INSTALL_DIR/backups
    
    # Set proper permissions
    chown -R $USER:$USER $INSTALL_DIR
    chmod 755 $INSTALL_DIR
    
    print_success "Project directories created"
}

install_node_modules() {
    print_step "Installing Node.js modules..."
    
    cd $INSTALL_DIR
    sudo -u $USER npm install --production
    
    print_success "Node.js modules installed"
}

setup_service() {
    print_step "Setting up system service..."
    
    # Copy service file
    cp $INSTALL_DIR/infoscreen.service /etc/systemd/system/
    
    # Reload systemd
    systemctl daemon-reload
    
    # Enable service
    systemctl enable $SERVICE_NAME
    
    print_success "System service configured"
}

configure_kiosk() {
    print_step "Configuring kiosk mode..."
    
    # Create autostart script for kiosk mode
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
    
    print_success "Kiosk mode configured"
}

generate_ssl() {
    print_step "Generating SSL certificates (for HTTPS)..."
    
    cd $INSTALL_DIR
    if [ ! -f "ssl/cert.pem" ] || [ ! -f "ssl/key.pem" ]; then
        mkdir -p ssl
        openssl req -x509 -newkey rsa:4096 -keyout ssl/key.pem -out ssl/cert.pem -days 365 -nodes -subj "/C=SE/ST=Vasternorrland/L=Ornskoldsvik/O=Sjalevads Bygg/CN=infoscreen.local"
        chmod 600 ssl/*
        chown -R $USER:$USER ssl
    fi
    
    print_success "SSL certificates generated"
}

post_install() {
    print_step "Running post-installation tasks..."
    
    # Generate initial thumbnails
    cd $INSTALL_DIR
    sudo -u $USER node server/thumbnail-generator.js
    
    # Start the service
    systemctl start $SERVICE_NAME
    
    # Wait a bit for service to start
    sleep 3
    
    print_success "Post-installation tasks completed"
}

show_summary() {
    print_header "INSTALLATION COMPLETE"
    
    # Get IP address
    IP_ADDRESS=$(hostname -I | awk '{print $1}')
    
    echo -e "${GREEN}🎉 Själevads Bygg Info Screen System has been installed!${NC}"
    echo ""
    echo -e "${YELLOW}📡 Access URLs:${NC}"
    echo -e "  • Info Screen:      http://$IP_ADDRESS:8080"
    echo -e "  • Touch Control:    http://$IP_ADDRESS:8080/touch-control.html"
    echo -e "  • Admin Panel:      http://$IP_ADDRESS:8080/admin"
    echo -e "  • Update Manager:   http://$IP_ADDRESS:8080/update-manager"
    echo ""
    echo -e "${YELLOW}🔧 System Commands:${NC}"
    echo -e "  • Start service:    sudo systemctl start $SERVICE_NAME"
    echo -e "  • Stop service:     sudo systemctl stop $SERVICE_NAME"
    echo -e "  • Check status:     sudo systemctl status $SERVICE_NAME"
    echo -e "  • View logs:        sudo journalctl -u $SERVICE_NAME -f"
    echo ""
    echo -e "${YELLOW}📝 Next Steps:${NC}"
    echo -e "  1. Upload images to: $INSTALL_DIR/images/"
    echo -e "  2. Configure weather API in: $INSTALL_DIR/config.json"
    echo -e "  3. Add Google Calendar URL in config.json"
    echo -e "  4. Reboot the system: sudo reboot"
    echo ""
    echo -e "${GREEN}Need help? Check the documentation in $INSTALL_DIR/docs/${NC}"
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

# Run main function
main