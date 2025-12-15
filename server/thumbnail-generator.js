const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');

class ThumbnailGenerator {
    constructor() {
        this.config = {
            imagesDir: './images',
            thumbnailsDir: './thumbnails',
            width: 400,
            height: 300,
            quality: 80
        };
    }
    
    async init() {
        console.log('🖼️ Starting Thumbnail Generator...');
        
        await this.loadConfig();
        await this.ensureDirectories();
        await this.generateAllThumbnails();
        
        console.log('✅ Thumbnail generation complete');
    }
    
    async loadConfig() {
        try {
            const configPath = path.join(__dirname, '..', 'config.json');
            const configData = await fs.readFile(configPath, 'utf8');
            const config = JSON.parse(configData);
            
            if (config.images) {
                this.config.imagesDir = config.images.directory || this.config.imagesDir;
                this.config.thumbnailsDir = config.images.thumbnailsDirectory || this.config.thumbnailsDir;
                this.config.width = config.images.thumbnailWidth || this.config.width;
                this.config.height = config.images.thumbnailHeight || this.config.height;
                this.config.quality = config.images.quality || this.config.quality;
            }
            
            console.log('✅ Configuration loaded');
        } catch (error) {
            console.warn('⚠️ Using default configuration:', error.message);
        }
    }
    
    async ensureDirectories() {
        try {
            await fs.mkdir(this.config.imagesDir, { recursive: true });
            await fs.mkdir(this.config.thumbnailsDir, { recursive: true });
            console.log('✅ Directories ready');
        } catch (error) {
            console.error('❌ Failed to create directories:', error);
            throw error;
        }
    }
    
    async generateAllThumbnails() {
        try {
            const files = await fs.readdir(this.config.imagesDir);
            const imageFiles = files.filter(file => 
                ['.jpg', '.jpeg', '.png', '.gif'].includes(path.extname(file).toLowerCase())
            );
            
            console.log(`📸 Found ${imageFiles.length} images to process`);
            
            let successCount = 0;
            let errorCount = 0;
            
            for (const file of imageFiles) {
                try {
                    await this.generateThumbnail(file);
                    successCount++;
                } catch (error) {
                    console.error(`❌ Failed to generate thumbnail for ${file}:`, error.message);
                    errorCount++;
                }
            }
            
            console.log(`📊 Results: ${successCount} successful, ${errorCount} failed`);
            
        } catch (error) {
            console.error('❌ Failed to read images directory:', error);
        }
    }
    
    async generateThumbnail(filename) {
        const inputPath = path.join(this.config.imagesDir, filename);
        const outputPath = path.join(this.config.thumbnailsDir, filename);
        
        // Check if thumbnail already exists and is up to date
        try {
            const inputStats = await fs.stat(inputPath);
            const outputStats = await fs.stat(outputPath).catch(() => null);
            
            if (outputStats && outputStats.mtime >= inputStats.mtime) {
                console.log(`⏩ Skipping ${filename} (already up to date)`);
                return;
            }
        } catch (error) {
            // File doesn't exist or other error, proceed with generation
        }
        
        console.log(`🔄 Generating thumbnail for: ${filename}`);
        
        try {
            await sharp(inputPath)
                .resize(this.config.width, this.config.height, {
                    fit: 'cover',
                    position: 'center'
                })
                .jpeg({ 
                    quality: this.config.quality,
                    mozjpeg: true 
                })
                .toFile(outputPath);
            
            console.log(`✅ Created: ${filename}`);
            
        } catch (error) {
            // Try with different approach if first fails
            try {
                await sharp(inputPath)
                    .resize(this.config.width, this.config.height, {
                        fit: 'inside',
                        withoutEnlargement: true
                    })
                    .jpeg({ quality: this.config.quality })
                    .toFile(outputPath);
                
                console.log(`✅ Created (alternative method): ${filename}`);
                
            } catch (secondError) {
                console.error(`❌ Failed completely for ${filename}:`, secondError.message);
                throw secondError;
            }
        }
    }
    
    async generateForSingleImage(filePath) {
        try {
            const filename = path.basename(filePath);
            await this.generateThumbnail(filename);
            return { success: true, filename };
        } catch (error) {
            return { success: false, error: error.message, filename };
        }
    }
    
    async cleanupOrphanedThumbnails() {
        try {
            const imageFiles = await fs.readdir(this.config.imagesDir);
            const thumbnailFiles = await fs.readdir(this.config.thumbnailsDir);
            
            const imageSet = new Set(imageFiles);
            let deletedCount = 0;
            
            for (const thumbnail of thumbnailFiles) {
                if (!imageSet.has(thumbnail)) {
                    const thumbnailPath = path.join(this.config.thumbnailsDir, thumbnail);
                    await fs.unlink(thumbnailPath);
                    console.log(`🗑️ Deleted orphaned thumbnail: ${thumbnail}`);
                    deletedCount++;
                }
            }
            
            console.log(`🧹 Cleanup complete: ${deletedCount} orphaned thumbnails removed`);
            
        } catch (error) {
            console.error('❌ Cleanup failed:', error);
        }
    }
}

// Run if called directly
if (require.main === module) {
    const generator = new ThumbnailGenerator();
    generator.init().catch(console.error);
}

module.exports = ThumbnailGenerator;