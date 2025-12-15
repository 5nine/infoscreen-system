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
        await this.loadConfig();
        this.setupMiddleware();
        this.setupRoutes();
        this.setupWebSocket();
        await this.loadImages();
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
        this.app.use(express.static(path.join(__dirname, '..', 'public')));
        this.app.use(express.json());
        this.app.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
            next();
        });
        this.app.use((req, res, next) => {
            console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
            next();
        });
    }
    
    setupRoutes() {
        this.app.get('/api/images', async (req, res) => {
            try {
                res.json(this.images);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        
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
			},
			// LÄGG TILL DETTA för att behålla filnamn:
			storage: multer.diskStorage({
				destination: path.join(__dirname, '..', 'images'),
				filename: (req, file, cb) => {
					// Behåll originalnamnet, men lägg till timestamp för att undvika dubbletter
					const timestamp = Date.now();
					const name = path.parse(file.originalname).name;
					const ext = path.extname(file.originalname);
					cb(null, `${name}_${timestamp}${ext}`);
				}
			})
		});
        
        this.app.post('/api/upload', upload.single('image'), async (req, res) => {
            try {
                if (!req.file) throw new Error('No file');
                
                const imageData = {
                    id: Date.now(),
                    filename: req.file.filename,
                    originalname: req.file.originalname,
                    path: req.file.path,
                    size: req.file.size,
                    uploaded: new Date().toISOString(),
                    title: path.parse(req.file.originalname).name,
                    description: '',
                    order: this.images.length + 1,
                    active: true
                };
                
                this.images.push(imageData);
                await this.generateThumbnail(imageData);
                
                this.broadcastToAll({
                    type: 'image-uploaded',
                    image: imageData
                });
                
                res.json({ success: true, image: imageData });
                
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        
        this.app.put('/api/images/:id', async (req, res) => {
            try {
                const imageId = parseInt(req.params.id);
                const index = this.images.findIndex(img => img.id === imageId);
                
                if (index === -1) return res.status(404).json({ error: 'Image not found' });
                
                this.images[index] = { ...this.images[index], ...req.body, updated: new Date().toISOString() };
                
                this.broadcastToAll({
                    type: 'image-updated',
                    image: this.images[index]
                });
                
                res.json({ success: true, image: this.images[index] });
                
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        
        this.app.delete('/api/images/:id', async (req, res) => {
            try {
                const imageId = parseInt(req.params.id);
                const index = this.images.findIndex(img => img.id === imageId);
                
                if (index === -1) return res.status(404).json({ error: 'Image not found' });
                
                const image = this.images[index];
                
                try {
                    await fs.unlink(image.path);
                    const thumbPath = path.join(__dirname, '..', 'thumbnails', image.filename);
                    await fs.unlink(thumbPath);
                } catch (error) {
                    console.warn('Could not delete files:', error);
                }
                
                this.images.splice(index, 1);
                
                this.broadcastToAll({
                    type: 'image-deleted',
                    imageId: imageId
                });
                
                res.json({ success: true });
                
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        
        this.app.get('/api/weather', async (req, res) => {
            try {
                if (!this.config.weather.enabled) return res.json({ enabled: false });
                
                const weatherData = {
                    current: {
                        temp: -5,
                        feels_like: -8,
                        humidity: 85,
                        wind_speed: 3.2,
                        clouds: 40,
                        weather: [{
                            description: 'Delvis molnigt',
                            icon: '02d'
                        }]
                    },
                    daily: [
                        { dt: Math.floor(Date.now() / 1000) + 86400, temp: { day: -5 }, weather: [{ description: 'Soligt' }] },
                        { dt: Math.floor(Date.now() / 1000) + 172800, temp: { day: -3 }, weather: [{ description: 'Mulet' }] },
                        { dt: Math.floor(Date.now() / 1000) + 259200, temp: { day: -7 }, weather: [{ description: 'Snö' }] },
                        { dt: Math.floor(Date.now() / 1000) + 345600, temp: { day: -2 }, weather: [{ description: 'Soligt' }] },
                        { dt: Math.floor(Date.now() / 1000) + 432000, temp: { day: -4 }, weather: [{ description: 'Mulet' }] }
                    ]
                };
                
                res.json(weatherData);
                
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        
        this.app.get('/api/calendar', async (req, res) => {
            try {
                if (!this.config.calendar.enabled) return res.json({ enabled: false, events: [] });
                
                const events = [
                    {
                        id: 1,
                        title: 'Projektmöte',
                        start: new Date().toISOString(),
                        end: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
                        location: 'Konferensrum 1'
                    },
                    {
                        id: 2,
                        title: 'Kundbesök',
                        start: new Date(Date.now() + 86400000).toISOString(),
                        end: new Date(Date.now() + 86400000 + 2 * 60 * 60 * 1000).toISOString(),
                        location: 'Huvudkontor'
                    }
                ];
                
                res.json(events);
                
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        
        this.app.get('/api/health', (req, res) => {
            res.json({
                status: 'healthy',
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                images: this.images.length
            });
        });
        
        this.app.get('/api/system', async (req, res) => {
            try {
                const si = require('systeminformation');
                const [cpu, mem] = await Promise.all([si.cpu(), si.mem()]);
                
                res.json({
                    memory: {
                        total: mem.total,
                        used: mem.used,
                        percent: (mem.used / mem.total * 100).toFixed(1)
                    },
                    images: this.images.length,
                    version: this.config.system.version
                });
                
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        
        this.app.get('/admin', (req, res) => {
            res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
        });
        
        this.app.get('/update-manager', (req, res) => {
            res.sendFile(path.join(__dirname, '..', 'public', 'update-manager.html'));
        });
        
        this.app.get('*', (req, res) => {
            res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
        });
    }
    
    setupWebSocket() {
        this.wss = new WebSocket.Server({ port: 8081 });
        
        this.wss.on('connection', (ws) => {
            console.log('🔗 New WebSocket (info screen)');
            
            ws.send(JSON.stringify({
                type: 'images-list',
                images: this.images
            }));
            
            ws.on('message', (message) => {
                try {
                    const data = JSON.parse(message);
                    this.handleWebSocketMessage(ws, data);
                } catch (error) {
                    console.error('WebSocket error:', error);
                }
            });
        });
        
        this.controlWss = new WebSocket.Server({ port: 8082 });
        
        this.controlWss.on('connection', (ws) => {
            console.log('👆 New WebSocket (touch control)');
            
            ws.send(JSON.stringify({
                type: 'current-slide',
                slideIndex: 0
            }));
            
            ws.on('message', (message) => {
                try {
                    const data = JSON.parse(message);
                    this.handleControlMessage(ws, data);
                } catch (error) {
                    console.error('Control error:', error);
                }
            });
        });
        
        console.log('✅ WebSocket servers started');
    }
    
    handleWebSocketMessage(ws, data) {
        switch (data.type) {
            case 'slide-changed':
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
            if (client.readyState === WebSocket.OPEN) client.send(messageStr);
        });
    }
    
    broadcastToControl(message) {
        if (!this.controlWss) return;
        const messageStr = JSON.stringify(message);
        this.controlWss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) client.send(messageStr);
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
            
            console.log(`✅ Thumbnail: ${imageData.filename}`);
            
        } catch (error) {
            console.error('Thumbnail failed:', error);
        }
    }
    
    startServer() {
        this.app.listen(this.port, () => {
            console.log(`✅ Server on port ${this.port}`);
            console.log(`📡 http://localhost:${this.port}`);
            console.log(`👆 Touch: http://localhost:${this.port}/touch-control.html`);
            console.log(`🛠️ Admin: http://localhost:${this.port}/admin`);
        });
    }
}

if (require.main === module) {
    const server = new InfoScreenServer();
    
    process.on('SIGINT', () => {
        console.log('\n👋 Shutting down...');
        process.exit(0);
    });
}

module.exports = InfoScreenServer;