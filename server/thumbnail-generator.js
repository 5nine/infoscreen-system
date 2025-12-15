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
            quality: 80,
            format: 'jpeg'
        };
        
        this.stats = {
            processed: 0,
            skipped: 0,
            failed: 0,
            startTime: null
        };
    }
    
    async init() {
        console.log('🖼️  Starting Thumbnail Generator for Själevads Bygg Info Screen...');
        this.stats.startTime = Date.now();
        
        try {
            await this.loadConfig();
            await this.ensureDirectories();
            
            const result = await this.generateAllThumbnails();
            await this.cleanupOrphanedThumbnails();
            
            this.printSummary(result);
            
        } catch (error) {
            console.error('❌ Initialization failed:', error.message);
            process.exit(1);
        }
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
            
            console.log('✅ Configuration loaded:');
            console.log(`   Source: ${this.config.imagesDir}`);
            console.log(`   Target: ${this.config.thumbnailsDir}`);
            console.log(`   Size: ${this.config.width}x${this.config.height}`);
            console.log(`   Quality: ${this.config.quality}%`);
            
        } catch (error) {
            console.warn('⚠️  Using default configuration');
        }
    }
    
    async ensureDirectories() {
        try {
            await fs.mkdir(this.config.imagesDir, { recursive: true });
            await fs.mkdir(this.config.thumbnailsDir, { recursive: true });
            
            console.log('✅ Directories ready');
            
        } catch (error) {
            console.error('❌ Failed to create directories:', error.message);
            throw error;
        }
    }
    
    async generateAllThumbnails() {
        try {
            console.log('\n📸 Scanning for images...');
            
            const files = await fs.readdir(this.config.imagesDir);
            
            // Filter for image files
            const imageFiles = files.filter(file => {
                const ext = path.extname(file).toLowerCase();
                return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext);
            });
            
            if (imageFiles.length === 0) {
                console.log('ℹ️  No images found in', this.config.imagesDir);
                return { total: 0, processed: 0, skipped: 0, failed: 0 };
            }
            
            console.log(`   Found ${imageFiles.length} image(s)`);
            
            // Process images
            for (const [index, filename] of imageFiles.entries()) {
                try {
                    const progress = Math.round(((index + 1) / imageFiles.length) * 100);
                    process.stdout.write(`\r🔄 Processing: ${progress}% (${index + 1}/${imageFiles.length})`);
                    
                    await this.generateThumbnail(filename);
                    this.stats.processed++;
                    
                } catch (error) {
                    console.error(`\n❌ Failed: ${filename} - ${error.message}`);
                    this.stats.failed++;
                }
            }
            
            console.log('\n'); // New line after progress
            
            return {
                total: imageFiles.length,
                processed: this.stats.processed,
                skipped: this.stats.skipped,
                failed: this.stats.failed
            };
            
        } catch (error) {
            console.error('❌ Failed to scan images:', error.message);
            return { total: 0, processed: 0, skipped: 0, failed: 1 };
        }
    }
    
    async generateThumbnail(filename) {
        const inputPath = path.join(this.config.imagesDir, filename);
        const outputPath = path.join(this.config.thumbnailsDir, filename);
        
        // Check if thumbnail already exists and is up to date
        try {
            const inputStats = await fs.stat(inputPath);
            const outputStats = await fs.stat(outputPath).catch(() => null);
            
            // Skip if thumbnail exists and is newer than source
            if (outputStats && outputStats.mtime >= inputStats.mtime) {
                this.stats.skipped++;
                return { skipped: true, filename };
            }
            
        } catch (error) {
            // File doesn't exist or other error, proceed with generation
        }
        
        try {
            const image = sharp(inputPath);
            const metadata = await image.metadata();
            
            // Determine output format based on input or config
            const outputFormat = this.config.format || (metadata.format === 'png' ? 'png' : 'jpeg');
            
            // Generate thumbnail
            await image
                .resize(this.config.width, this.config.height, {
                    fit: 'cover',
                    position: 'center',
                    withoutEnlargement: true
                })
                .toFormat(outputFormat, {
                    quality: this.config.quality,
                    progressive: true,
                    optimiseScans: true
                })
                .toFile(outputPath);
            
            return { success: true, filename, format: outputFormat };
            
        } catch (error) {
            // Fallback: try simpler resize if first attempt fails
            try {
                await sharp(inputPath)
                    .resize(this.config.width, this.config.height, {
                        fit: 'inside',
                        withoutEnlargement: true
                    })
                    .jpeg({ quality: this.config.quality })
                    .toFile(outputPath);
                
                return { success: true, filename, format: 'jpeg (fallback)' };
                
            } catch (fallbackError) {
                throw new Error(`Generation failed: ${fallbackError.message}`);
            }
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
                    deletedCount++;
                }
            }
            
            if (deletedCount > 0) {
                console.log(`🧹 Cleanup: Removed ${deletedCount} orphaned thumbnail(s)`);
            }
            
        } catch (error) {
            console.warn('⚠️  Cleanup failed:', error.message);
        }
    }
    
    printSummary(result) {
        const duration = ((Date.now() - this.stats.startTime) / 1000).toFixed(1);
        
        console.log('📊 Summary:');
        console.log('────────────────────');
        console.log(`   Total images:    ${result.total}`);
        console.log(`   Processed:       ${result.processed} ✅`);
        console.log(`   Skipped (fresh): ${result.skipped} ⏭️`);
        console.log(`   Failed:          ${result.failed} ❌`);
        console.log(`   Time:            ${duration}s ⏱️`);
        console.log('────────────────────');
        
        if (result.failed === 0) {
            console.log('🎉 All thumbnails generated successfully!');
        } else {
            console.log(`ℹ️  ${result.failed} thumbnail(s) failed to generate`);
        }
    }
    
    // Method to generate thumbnail for a single file (for use by webserver)
    async generateForSingleImage(filePath) {
        try {
            const filename = path.basename(filePath);
            const result = await this.generateThumbnail(filename);
            
            if (result.skipped) {
                return { success: true, message: 'Thumbnail already up to date', filename };
            }
            
            return { success: true, filename, ...result };
            
        } catch (error) {
            return { success: false, error: error.message, filename: path.basename(filePath) };
        }
    }
    
    // Method to regenerate all thumbnails (force)
    async regenerateAll() {
        console.log('🔄 Forcing regeneration of all thumbnails...');
        
        const files = await fs.readdir(this.config.imagesDir);
        const imageFiles = files.filter(file => {
            const ext = path.extname(file).toLowerCase();
            return ['.jpg', '.jpeg', '.png', '.gif'].includes(ext);
        });
        
        let success = 0;
        let failed = 0;
        
        for (const filename of imageFiles) {
            try {
                const outputPath = path.join(this.config.thumbnailsDir, filename);
                // Delete existing thumbnail
                await fs.unlink(outputPath).catch(() => {});
                
                // Generate new
                await this.generateThumbnail(filename);
                success++;
                
            } catch (error) {
                console.error(`❌ Failed to regenerate ${filename}:`, error.message);
                failed++;
            }
        }
        
        console.log(`✅ Regenerated ${success} thumbnail(s), ${failed} failed`);
        return { success, failed };
    }
}

// Run if called directly
if (require.main === module) {
    const generator = new ThumbnailGenerator();
    
    // Handle command line arguments
    const args = process.argv.slice(2);
    
    const runGenerator = async () => {
        if (args.includes('--force') || args.includes('-f')) {
            await generator.init();
            await generator.regenerateAll();
        } else if (args.includes('--cleanup') || args.includes('-c')) {
            await generator.init();
            await generator.cleanupOrphanedThumbnails();
        } else if (args.includes('--help') || args.includes('-h')) {
            console.log(`
🖼️ Thumbnail Generator for Själevads Bygg Info Screen
─────────────────────────────────────
Usage: node thumbnail-generator.js [options]

Options:
  --force, -f     Force regeneration of all thumbnails
  --cleanup, -c   Clean up orphaned thumbnails only
  --help, -h      Show this help message

Examples:
  node thumbnail-generator.js          # Normal generation
  node thumbnail-generator.js --force  # Force regenerate all
  node thumbnail-generator.js --cleanup # Cleanup only
            `);
        } else {
            await generator.init();
        }
    };
    
    runGenerator().catch(console.error);
}

module.exports = ThumbnailGenerator;