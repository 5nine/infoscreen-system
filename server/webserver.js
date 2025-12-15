const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const WebSocket = require('ws');
const multer = require('multer');
const sharp = require('sharp');

class InfoScreenServer {
    constructor() {
        this.app = express();
        this.port = process.env.PORT || 8080;
        this.config = {};
        this.wss = null;
        this.controlWss = null;
        this.images = [];
        
        this.init();
    }
    
    async init() {
        console.log('🚀 Starting Själevads Bygg Info Screen Server...');
        
        // Load configuration
        await this.loadConfig();
        
        // Setup middleware
        this.setupMiddleware();
        
        // Setup routes
        this.setupRoutes();
        
        // Setup WebSocket
        this.setupWebSocket();
        
        // Load images
        await this.loadImages();
        
        // Start server
        this.startServer();
    }
    
    async loadConfig() {
        try {
            const configPath = path.join(__dirname, '..', 'config.json');
            const configData = await fs.readFile(configPath, 'utf8');
            this.config = JSON.parse(configData);
            console.log('✅ Configuration loaded');
        } catch (error) {
            console.error('❌ Failed to load config:', error);
            this.config = require('../config.json');
        }
    }
    
    setupMiddleware() {
        // Serve static files
        this.app.use(express.static(path.join(__dirname, '..', 'public')));
        
        // Parse JSON
        this.app.use(express.json());
        
        // CORS
        this.app.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
            next();
        });
        
        // Request logging
        this.app.use((req, res, next) => {
            console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
            next();
        });
    }
    
    setupRoutes() {
        // API: Get all images
        this.app.get('/api/images', async (req, res) => {
            try {
                res.json(this.images);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        
        // API: Get single image
        this.app.get('/api/images/:id', async (req, res) => {
            try {
                const image = this.images.find(img => img.id == req.params.id);
                if (image) {
                    res.json(image);
                } else {
                    res.status(404).json({ error: 'Image not found' });
                }
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        
        // API: Upload image
        const upload = multer({
            dest: path.join(__dirname, '..', 'images'),
            limits: {
                fileSize: this.config.images.maxFileSize || 5242880
            },
            fileFilter: (req, file, cb) => {
                const ext = path.extname(file.originalname).toLowerCase();
                if (this.config.images.allowedExtensions.includes(ext)) {
                    cb(null, true);
                } else {
                    cb(new Error('Invalid file type'));
                }
            }
        });
        
        this.app.post('/api/upload', upload.single('image'), async (req, res) => {
            try {
                if (!req.file) {
                    throw new Error('No file uploaded');
                }
                
                const imageData = {
                    id: Date.now(),
                    filename: req.file.filename,
                    originalname: req.file.originalname,
                    path: req.file.path,
                    size: req.file.size,
                    mimetype: req.file.mimetype,
                    uploaded: new Date().toISOString(),
                    title: path.parse(req.file.originalname).name,
                    description: '',
                    order: this.images.length + 1,
                    active: true
                };
                
                // Save to database
                this.images.push(imageData);
                await this.saveImages();
                
                // Generate thumbnail
                await this.generateThumbnail(imageData);
                
                // Notify all connected clients
                this.broadcastToAll({
                    type: 'image-uploaded',
                    image: imageData
                });
                
                res.json({
                    success: true,
                    image: imageData
                });
                
            } catch (error) {
                console.error('Upload error:', error);
                res.status(500).json({ error: error.message });
            }
        });
        
        // API: Update image
        this.app.put('/api/images/:id', async (req, res) => {
            try {
                const imageId = parseInt(req.params.id);
                const index = this.images.findIndex(img => img.id === imageId);
                
                if (index === -1) {
                    return res.status(404).json({ error: 'Image not found' });
                }
                
                // Update image data
                this.images[index] = {
                    ...this.images[index],
                    ...req.body,
                    updated: new Date().toISOString()
                };
                
                await this.saveImages();
                
                // Notify clients
                this.broadcastToAll({
                    type: 'image-updated',
                    image: this.images[index]
                });
                
                res.json({
                    success: true,
                    image: this.images[index]
                });
                
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        
        // API: Delete image
        this.app.delete('/api/images/:id', async (req, res) => {
            try {
                const imageId = parseInt(req.params.id);
                const index = this.images.findIndex(img => img.id === imageId);
                
                if (index === -1) {
                    return res.status(404).json({ error: 'Image not found' });
                }
                
                const image = this.images[index];
                
                // Delete files
                try {
                    await fs.unlink(image.path);
                    const thumbPath = path.join(__dirname, '..', 'thumbnails', image.filename);
                    await fs.unlink(thumbPath);
                } catch (error) {
                    console.warn('Could not delete image files:', error);
                }
                
                // Remove from array
                this.images.splice(index, 1);
                await this.saveImages();
                
                // Notify clients
                this.broadcastToAll({
                    type: 'image-deleted',
                    imageId: imageId
                });
                
                res.json({ success: true });
                
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        
        // API: Weather data
        this.app.get('/api/weather', async (req, res) => {
            try {
                if (!this.config.weather.enabled) {
                    return res.json({ enabled: false });
                }
                
                // In production, you would fetch from OpenWeatherMap API
                // For now, return mock data
                const weatherData = {
                    current: {
                        temp: -5,
                        feels_like: -8,
                        humidity: 85,
                        wind_speed: 3.2,
                        clouds: 40,
                        weather: [{
                            id: 801,
                            main: 'Clouds',
                            description: 'Delvis molnigt',
                            icon: '02d'
                        }]
                    },
                    daily: [
                        {
                            dt: Math.floor(Date.now() / 1000) + 86400,
                            temp: { day: -5 },
                            weather: [{ description: 'Soligt' }]
                        },
                        // ... more days
                    ]
                };
                
                res.json(weatherData);
                
            } catch (error) {
                console.error('Weather API error:', error);
                res.status(500).json({ error: error.message });
            }
        });
        
        // API: Calendar events
        this.app.get('/api/calendar', async (req, res) => {
            try {
                if (!this.config.calendar.enabled) {
                    return res.json({ enabled: false, events: [] });
                }
                
                // In production, fetch from Google Calendar
                // For now, return mock data
                const events = [
                    {
                        id: 1,
                        title: 'Projektmöte',
                        start: new Date().toISOString(),
                        end: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
                        location: 'Konferensrum 1'
                    },
                    // ... more events
                ];
                
                res.json(events);
                
            } catch (error) {
                console.error('Calendar API error:', error);
                res.status(500).json({ error: error.message });
            }
        });
        
        // API: System health
        this.app.get('/api/health', (req, res) => {
            res.json({
                status: 'healthy',
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                images: this.images.length,
                connections: this.wss ? this.wss.clients.size : 0
            });
        });
        
        // API: System info
        this.app.get('/api/system', async (req, res) => {
            try {
                const si = require('systeminformation');
                
                const [cpu, mem, fs] = await Promise.all([
                    si.cpu(),
                    si.mem(),
                    si.fsSize()
                ]);
                
                res.json({
                    cpu,
                    memory: {
                        total: mem.total,
                        used: mem.used,
                        free: mem.free,
                        percent: (mem.used / mem.total * 100).toFixed(1)
                    },
                    disk: fs[0] || {},
                    images: this.images.length,
                    version: this.config.system.version
                });
                
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        
        // API: Update check
        this.app.get('/api/update/check', async (req, res) => {
            try {
                const AutoUpdateSystem = require('../auto-update');
                const updateSystem = new AutoUpdateSystem();
                const updateInfo = await updateSystem.checkForUpdates();
                res.json(updateInfo);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        
        // API: Perform update
        this.app.post('/api/update/perform', async (req, res) => {
            try {
                const AutoUpdateSystem = require('../auto-update');
                const updateSystem = new AutoUpdateSystem();
                const result = await updateSystem.performUpdate(req.body.force || false);
                res.json(result);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        
        // Admin page
        this.app.get('/admin', (req, res) => {
            res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
        });
        
        // Update manager
        this.app.get('/update-manager', (req, res) => {
            res.sendFile(path.join(__dirname, '..', 'public', 'update-manager.html'));
        });
        
        // Catch-all route for SPA
        this.app.get('*', (req, res) => {
            res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
        });
    }
    
    setupWebSocket() {
        // Main WebSocket for info screen
        this.wss = new WebSocket.Server({ port: 8081 });
        
        this.wss.on('connection', (ws) => {
            console.log('🔗 New WebSocket connection (info screen)');
            
            // Send current images list
            ws.send(JSON.stringify({
                type: 'images-list',
                images: this.images
            }));
            
            ws.on('message', (message) => {
                try {
                    const data = JSON.parse(message);
                    this.handleWebSocketMessage(ws, data);
                } catch (error) {
                    console.error('WebSocket message error:', error);
                }
            });
            
            ws.on('close', () => {
                console.log('🔌 WebSocket connection closed (info screen)');
            });
        });
        
        // Control WebSocket for touch control
        this.controlWss = new WebSocket.Server({ port: 8082 });
        
        this.controlWss.on('connection', (ws) => {
            console.log('👆 New WebSocket connection (touch control)');
            
            // Send current slide
            ws.send(JSON.stringify({
                type: 'current-slide',
                slideIndex: 0
            }));
            
            ws.on('message', (message) => {
                try {
                    const data = JSON.parse(message);
                    this.handleControlMessage(ws, data);
                } catch (error) {
                    console.error('Control WebSocket error:', error);
                }
            });
            
            ws.on('close', () => {
                console.log('🔌 WebSocket connection closed (touch control)');
            });
        });
        
        console.log('✅ WebSocket servers started on ports 8081 and 8082');
    }
    
    handleWebSocketMessage(ws, data) {
        switch (data.type) {
            case 'slide-changed':
                // Broadcast to all control clients
                this.broadcastToControl({
                    type: 'current-slide',
                    slideIndex: data.slideIndex
                });
                break;
                
            case 'play-state':
                this.broadcastToControl({
                    type: 'play-state',
                    isPlaying: data.isPlaying
                });
                break;
        }
    }
    
    handleControlMessage(ws, data) {
        switch (data.type) {
            case 'navigate':
                // Broadcast to all info screen clients
                this.broadcastToAll({
                    type: 'navigate-to',
                    slideIndex: data.slideIndex
                });
                break;
                
            case 'playPause':
                this.broadcastToAll({
                    type: 'play-pause',
                    isPlaying: data.isPlaying
                });
                break;
                
            case 'request-images':
                ws.send(JSON.stringify({
                    type: 'images-list',
                    images: this.images
                }));
                break;
        }
    }
    
    broadcastToAll(message) {
        if (!this.wss) return;
        
        const messageStr = JSON.stringify(message);
        this.wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(messageStr);
            }
        });
    }
    
    broadcastToControl(message) {
        if (!this.controlWss) return;
        
        const messageStr = JSON.stringify(message);
        this.controlWss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(messageStr);
            }
        });
    }
    
    async loadImages() {
        try {
            const imagesPath = path.join(__dirname, '..', 'images');
            const files = await fs.readdir(imagesPath);
            
            this.images = files
                .filter(file => {
                    const ext = path.extname(file).toLowerCase();
                    return this.config.images.allowedExtensions.includes(ext);
                })
                .map((file, index) => ({
                    id: index + 1,
                    filename: file,
                    title: path.parse(file).name,
                    description: '',
                    order: index + 1,
                    active: true,
                    uploaded: new Date().toISOString()
                }));
            
            console.log(`✅ Loaded ${this.images.length} images`);
            
        } catch (error) {
            console.error('Failed to load images:', error);
            this.images = [];
        }
    }
    
    async saveImages() {
        try {
            const imagesPath = path.join(__dirname, '..', 'data', 'images.json');
            await fs.mkdir(path.dirname(imagesPath), { recursive: true });
            await fs.writeFile(imagesPath, JSON.stringify(this.images, null, 2));
        } catch (error) {
            console.error('Failed to save images:', error);
        }
    }
    
    async generateThumbnail(imageData) {
        try {
            const inputPath = imageData.path;
            const outputPath = path.join(__dirname, '..', 'thumbnails', imageData.filename);
            
            await sharp(inputPath)
                .resize(this.config.images.thumbnailWidth, this.config.images.thumbnailHeight, {
                    fit: 'cover',
                    position: 'center'
                })
                .jpeg({ quality: this.config.images.quality || 80 })
                .toFile(outputPath);
            
            console.log(`✅ Thumbnail generated: ${imageData.filename}`);
            
        } catch (error) {
            console.error('Failed to generate thumbnail:', error);
        }
    }
    
    startServer() {
        this.app.listen(this.port, () => {
            console.log(`✅ Server running on port ${this.port}`);
            console.log(`📡 Access URLs:`);
            console.log(`   • http://localhost:${this.port}`);
            console.log(`   • http://[YOUR_IP]:${this.port}`);
            console.log(`   • Touch control: http://localhost:${this.port}/touch-control.html`);
            console.log(`   • Admin panel: http://localhost:${this.port}/admin`);
        });
    }
}

// Start the server
if (require.main === module) {
    const server = new InfoScreenServer();
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n👋 Shutting down server...');
        process.exit(0);
    });
    
    process.on('uncaughtException', (error) => {
        console.error('💥 Uncaught exception:', error);
    });
    
    process.on('unhandledRejection', (reason, promise) => {
        console.error('💥 Unhandled rejection at:', promise, 'reason:', reason);
    });
}

module.exports = InfoScreenServer;