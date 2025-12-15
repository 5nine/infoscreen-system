#!/usr/bin/env node
/**
 * Auto-Update System for Själevads Bygg Info Screen
 */

const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const https = require('https');
const WebSocket = require('ws');

class AutoUpdateSystem {
    constructor() {
        this.config = {
            githubRepo: '5nine/infoscreen-system',
            currentVersion: '1.0.0',
            updateChannel: 'stable',
            autoUpdate: true,
            backupBeforeUpdate: true,
            notifyOnUpdate: true,
            updateCheckInterval: 3600000,
            maxBackups: 5,
            logLevel: 'info'
        };
        
        this.directories = {
            root: '.',
            update: './.update',
            backup: './.update/backups',
            temp: './.update/temp',
            logs: './logs'
        };
        
        this.updateInProgress = false;
        this.updateClients = new Set();
        this.init();
    }
    
    async init() {
        console.log('🚀 Auto-Update System initializing...');
        await this.ensureDirectories();
        await this.loadConfig();
        this.startUpdateWebSocket();
        this.startUpdateChecker();
        this.startSystemMonitor();
        console.log('✅ Auto-Update System ready');
        
        if (process.argv.length > 2) {
            await this.handleCliArguments();
        }
    }
    
    async handleCliArguments() {
        const args = process.argv.slice(2);
        
        for (const arg of args) {
            switch (arg) {
                case '--check': await this.checkForUpdates(true); break;
                case '--force': await this.performUpdate(true); break;
                case '--auto': 
                    const update = await this.checkForUpdates();
                    if (update.updateAvailable) await this.performUpdate();
                    break;
                case '--backup': await this.createBackup(); break;
                case '--restore': await this.restoreFromLatestBackup(); break;
                case '--status': await this.showSystemStatus(); break;
                case '--help': this.showHelp(); break;
                case '--version': console.log(`Version: ${this.config.currentVersion}`); break;
            }
        }
    }
    
    showHelp() {
        console.log(`
📦 Auto-Update System
─────────────────────
Usage: node auto-update.js [options]

Options:
  -c, --check      Check for updates
  -f, --force      Force update
  -a, --auto       Auto-update if available
  -b, --backup     Create backup
  -r, --restore    Restore from backup
  -s, --status     Show system status
  -v, --version    Show version
  -h, --help       Show help
        `);
    }
    
    async ensureDirectories() {
        for (const dir of Object.values(this.directories)) {
            try {
                await fs.mkdir(dir, { recursive: true });
            } catch (error) {
                this.log(`Failed to create directory ${dir}: ${error.message}`, 'error');
            }
        }
    }
    
    async loadConfig() {
        try {
            const configPath = path.join(this.directories.root, 'config.json');
            if (await this.fileExists(configPath)) {
                const configData = await fs.readFile(configPath, 'utf8');
                const savedConfig = JSON.parse(configData);
                this.config = { ...this.config, ...savedConfig.update };
            }
            
            const packagePath = path.join(this.directories.root, 'package.json');
            if (await this.fileExists(packagePath)) {
                const packageData = await fs.readFile(packagePath, 'utf8');
                const packageJson = JSON.parse(packageData);
                this.config.currentVersion = packageJson.version;
            }
        } catch (error) {
            this.log(`Failed to load config: ${error.message}`, 'error');
        }
    }
    
    async checkForUpdates(cli = false) {
        this.log('Checking for updates...', 'info');
        
        try {
            const latestRelease = await this.fetchLatestRelease();
            
            if (!latestRelease) {
                return { updateAvailable: false, error: 'Could not fetch release' };
            }
            
            const updateAvailable = this.isNewerVersion(
                latestRelease.tag_name,
                this.config.currentVersion
            );
            
            const result = {
                updateAvailable,
                currentVersion: this.config.currentVersion,
                latestVersion: latestRelease.tag_name,
                releaseNotes: latestRelease.body || 'No release notes',
                publishedAt: latestRelease.published_at
            };
            
            if (updateAvailable) {
                this.log(`Update available: ${latestRelease.tag_name}`, 'info');
            } else {
                this.log('System is up to date', 'info');
            }
            
            if (cli) console.log(JSON.stringify(result, null, 2));
            return result;
            
        } catch (error) {
            const message = `Update check failed: ${error.message}`;
            this.log(message, 'error');
            if (cli) console.error(message);
            return { updateAvailable: false, error: message };
        }
    }
    
    async performUpdate(force = false) {
        if (this.updateInProgress) {
            return { success: false, error: 'Update already in progress' };
        }
        
        this.updateInProgress = true;
        this.broadcastUpdateStatus('start', { message: 'Starting update...' });
        
        try {
            if (!force) {
                const updateCheck = await this.checkForUpdates();
                if (!updateCheck.updateAvailable) {
                    this.updateInProgress = false;
                    return { success: false, error: 'No update available' };
                }
            }
            
            let backupPath = null;
            if (this.config.backupBeforeUpdate) {
                backupPath = await this.createBackup();
            }
            
            this.broadcastUpdateStatus('progress', { percentage: 10, message: 'Downloading...' });
            const updatePath = await this.downloadUpdate();
            
            this.broadcastUpdateStatus('progress', { percentage: 30, message: 'Validating...' });
            await this.validateUpdate(updatePath);
            
            this.broadcastUpdateStatus('progress', { percentage: 50, message: 'Installing...' });
            await this.installUpdate(updatePath);
            
            this.broadcastUpdateStatus('progress', { percentage: 80, message: 'Configuring...' });
            await this.updateConfiguration();
            
            this.broadcastUpdateStatus('progress', { percentage: 90, message: 'Cleaning up...' });
            await this.cleanupUpdate(updatePath);
            
            const result = {
                success: true,
                message: 'Update completed',
                previousVersion: this.config.currentVersion,
                newVersion: await this.getLatestVersion(),
                backupPath: backupPath,
                timestamp: new Date().toISOString()
            };
            
            this.log(`Update successful: ${result.previousVersion} → ${result.newVersion}`, 'info');
            this.broadcastUpdateStatus('complete', result);
            
            setTimeout(async () => {
                await this.restartSystem();
            }, 3000);
            
            return result;
            
        } catch (error) {
            this.log(`Update failed: ${error.message}`, 'error');
            await this.restoreFromBackup();
            
            const result = {
                success: false,
                error: error.message,
                message: 'Update failed, restored from backup'
            };
            
            this.broadcastUpdateStatus('error', result);
            this.updateInProgress = false;
            return result;
        }
    }
    
    async createBackup() {
        this.log('Creating backup...', 'info');
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').split('.')[0];
        const backupName = `backup_${timestamp}_v${this.config.currentVersion}`;
        const backupPath = path.join(this.directories.backup, backupName);
        
        try {
            await fs.mkdir(backupPath, { recursive: true });
            
            const filesToBackup = [
                'package.json',
                'config.json',
                'server/',
                'public/',
                'images/',
                'thumbnails/'
            ];
            
            for (const item of filesToBackup) {
                const source = path.join(this.directories.root, item);
                const destination = path.join(backupPath, item);
                
                if (await this.fileExists(source)) {
                    if ((await fs.stat(source)).isDirectory()) {
                        await this.copyDirectory(source, destination);
                    } else {
                        await fs.copyFile(source, destination);
                    }
                }
            }
            
            const manifest = {
                timestamp: new Date().toISOString(),
                version: this.config.currentVersion,
                backupName: backupName
            };
            
            await fs.writeFile(
                path.join(backupPath, 'manifest.json'),
                JSON.stringify(manifest, null, 2),
                'utf8'
            );
            
            await this.manageBackupRetention();
            this.log(`Backup created: ${backupName}`, 'info');
            return backupPath;
            
        } catch (error) {
            this.log(`Backup failed: ${error.message}`, 'error');
            throw error;
        }
    }
    
    async restoreFromBackup(backupName = null) {
        this.log('Restoring from backup...', 'info');
        
        try {
            let backupPath;
            if (backupName) {
                backupPath = path.join(this.directories.backup, backupName);
            } else {
                const backups = await this.listBackups();
                if (backups.length === 0) throw new Error('No backups available');
                backupPath = backups[0].path;
            }
            
            if (!await this.fileExists(backupPath)) {
                throw new Error(`Backup not found: ${backupPath}`);
            }
            
            const manifestPath = path.join(backupPath, 'manifest.json');
            if (!await this.fileExists(manifestPath)) {
                throw new Error('Invalid backup: no manifest');
            }
            
            const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
            
            const items = await fs.readdir(backupPath);
            for (const item of items) {
                if (item === 'manifest.json') continue;
                const source = path.join(backupPath, item);
                const destination = path.join(this.directories.root, item);
                
                if ((await fs.stat(source)).isDirectory()) {
                    await this.copyDirectory(source, destination);
                } else {
                    await fs.copyFile(source, destination);
                }
            }
            
            this.log(`System restored from backup: ${manifest.backupName}`, 'info');
            await this.restartSystem();
            
            return {
                success: true,
                message: 'System restored',
                backup: manifest
            };
            
        } catch (error) {
            this.log(`Restore failed: ${error.message}`, 'error');
            throw error;
        }
    }
    
    async downloadUpdate() {
        const tempPath = path.join(this.directories.temp, `update_${Date.now()}`);
        await fs.mkdir(tempPath, { recursive: true });
        
        try {
            const latestRelease = await this.fetchLatestRelease();
            if (!latestRelease || !latestRelease.zipball_url) {
                throw new Error('No download URL');
            }
            
            const zipUrl = latestRelease.zipball_url;
            const zipPath = path.join(tempPath, 'update.zip');
            
            await this.downloadFile(zipUrl, zipPath);
            await execAsync(`unzip -q "${zipPath}" -d "${tempPath}/extracted"`);
            
            const extractedDir = path.join(tempPath, 'extracted');
            const items = await fs.readdir(extractedDir, { withFileTypes: true });
            
            let updateDir = null;
            for (const item of items) {
                if (item.isDirectory()) {
                    updateDir = path.join(extractedDir, item.name);
                    break;
                }
            }
            
            if (!updateDir) throw new Error('Could not find update directory');
            
            this.log(`Update downloaded to: ${updateDir}`, 'info');
            return updateDir;
            
        } catch (error) {
            await fs.rm(tempPath, { recursive: true, force: true });
            throw error;
        }
    }
    
    async validateUpdate(updatePath) {
        const requiredFiles = [
            'package.json',
            'server/webserver.js',
            'public/index.html'
        ];
        
        for (const file of requiredFiles) {
            const filePath = path.join(updatePath, file);
            if (!await this.fileExists(filePath)) {
                throw new Error(`Missing file: ${file}`);
            }
        }
        
        const packagePath = path.join(updatePath, 'package.json');
        const packageData = JSON.parse(await fs.readFile(packagePath, 'utf8'));
        if (!packageData.version) throw new Error('No version in package.json');
        
        this.log(`Update validated: ${packageData.version}`, 'info');
    }
    
    async installUpdate(updatePath) {
        const packagePath = path.join(updatePath, 'package.json');
        if (await this.fileExists(packagePath)) {
            await fs.copyFile(packagePath, path.join(this.directories.root, 'package.json'));
            await execAsync('npm install --production', { cwd: this.directories.root });
        }
        
        const serverSource = path.join(updatePath, 'server');
        const serverDest = path.join(this.directories.root, 'server');
        if (await this.fileExists(serverSource)) {
            await this.copyDirectory(serverSource, serverDest);
        }
        
        const publicSource = path.join(updatePath, 'public');
        const publicDest = path.join(this.directories.root, 'public');
        if (await this.fileExists(publicSource)) {
            await this.copyDirectory(publicSource, publicDest);
        }
        
        const items = await fs.readdir(updatePath, { withFileTypes: true });
        for (const item of items) {
            const source = path.join(updatePath, item.name);
            const destination = path.join(this.directories.root, item.name);
            
            if (['server', 'public', 'images', 'thumbnails', 'logs', 'node_modules'].includes(item.name)) {
                continue;
            }
            
            if (item.isDirectory()) {
                await this.copyDirectory(source, destination);
            } else {
                await fs.copyFile(source, destination);
            }
        }
        
        this.log('Update installed', 'info');
    }
    
    async updateConfiguration() {
        const configPath = path.join(this.directories.root, 'config.json');
        const defaultConfig = {
            version: await this.getLatestVersion(),
            lastUpdated: new Date().toISOString()
        };
        
        let currentConfig = {};
        if (await this.fileExists(configPath)) {
            const currentData = await fs.readFile(configPath, 'utf8');
            currentConfig = JSON.parse(currentData);
        }
        
        const mergedConfig = { ...defaultConfig, ...currentConfig };
        mergedConfig.version = defaultConfig.version;
        mergedConfig.lastUpdated = defaultConfig.lastUpdated;
        
        await fs.writeFile(configPath, JSON.stringify(mergedConfig, null, 2), 'utf8');
        this.config.currentVersion = mergedConfig.version;
        
        this.log('Configuration updated', 'info');
    }
    
    async cleanupUpdate(updatePath) {
        const tempDir = path.dirname(updatePath);
        await fs.rm(tempDir, { recursive: true, force: true });
        this.log('Temporary files cleaned up', 'info');
    }
    
    async restartSystem() {
        this.log('Restarting system...', 'info');
        try {
            await execAsync('sudo systemctl restart infoscreen');
        } catch (error) {
            process.exit(0);
        }
    }
    
    async showSystemStatus() {
        const status = {
            system: {
                version: this.config.currentVersion,
                updateInProgress: this.updateInProgress
            },
            updates: await this.checkForUpdates(),
            backups: await this.listBackups()
        };
        
        console.log(JSON.stringify(status, null, 2));
        return status;
    }
    
    startUpdateWebSocket() {
        const wss = new WebSocket.Server({ port: 8082, path: '/ws/update' });
        
        wss.on('connection', (ws) => {
            this.updateClients.add(ws);
            ws.on('close', () => this.updateClients.delete(ws));
        });
        
        this.log('Update WebSocket server started on port 8082', 'info');
    }
    
    broadcastUpdateStatus(type, data) {
        const message = JSON.stringify({ type, timestamp: new Date().toISOString(), ...data });
        for (const client of this.updateClients) {
            if (client.readyState === WebSocket.OPEN) client.send(message);
        }
    }
    
    startUpdateChecker() {
        if (this.config.autoUpdate) {
            setInterval(async () => {
                if (!this.updateInProgress) {
                    const update = await this.checkForUpdates();
                    if (update.updateAvailable) {
                        await this.performUpdate();
                    }
                }
            }, this.config.updateCheckInterval);
        }
    }
    
    startSystemMonitor() {
        setInterval(async () => {
            try {
                const stats = await this.getSystemStats();
                if (stats.memory.percent > 90) this.log(`High memory: ${stats.memory.percent}%`, 'warn');
                if (stats.cpu.load > 80) this.log(`High CPU: ${stats.cpu.load}%`, 'warn');
                if (stats.disk.percent > 90) this.log(`Low disk: ${100 - stats.disk.percent}% free`, 'warn');
            } catch (error) {
                this.log(`Monitor error: ${error.message}`, 'error');
            }
        }, 60000);
    }
    
    async fileExists(filePath) {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }
    
    async copyDirectory(src, dest) {
        await fs.mkdir(dest, { recursive: true });
        const entries = await fs.readdir(src, { withFileTypes: true });
        
        for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);
            
            if (entry.isDirectory()) {
                await this.copyDirectory(srcPath, destPath);
            } else {
                await fs.copyFile(srcPath, destPath);
            }
        }
    }
    
    async listBackups() {
        try {
            const backups = [];
            const items = await fs.readdir(this.directories.backup, { withFileTypes: true });
            
            for (const item of items) {
                if (item.isDirectory()) {
                    const manifestPath = path.join(this.directories.backup, item.name, 'manifest.json');
                    if (await this.fileExists(manifestPath)) {
                        const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
                        backups.push({
                            name: item.name,
                            path: path.join(this.directories.backup, item.name),
                            ...manifest
                        });
                    }
                }
            }
            
            backups.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            return backups;
        } catch (error) {
            this.log(`Failed to list backups: ${error.message}`, 'error');
            return [];
        }
    }
    
    async manageBackupRetention() {
        try {
            const backups = await this.listBackups();
            if (backups.length > this.config.maxBackups) {
                const toDelete = backups.slice(this.config.maxBackups);
                for (const backup of toDelete) {
                    await fs.rm(backup.path, { recursive: true, force: true });
                }
            }
        } catch (error) {
            this.log(`Backup retention failed: ${error.message}`, 'error');
        }
    }
    
    async fetchLatestRelease() {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'api.github.com',
                path: `/repos/${this.config.githubRepo}/releases/latest`,
                headers: {
                    'User-Agent': 'Själevads-Bygg-Info-Screen',
                    'Accept': 'application/vnd.github.v3+json'
                }
            };
            
            https.get(options, (res) => {
                if (res.statusCode !== 200) {
                    reject(new Error(`GitHub API error: ${res.statusCode}`));
                    return;
                }
                
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (error) {
                        reject(new Error(`Failed to parse response: ${error.message}`));
                    }
                });
            }).on('error', (error) => {
                reject(new Error(`GitHub API request failed: ${error.message}`));
            });
        });
    }
    
    async downloadFile(url, destPath) {
        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(destPath);
            
            https.get(url, (response) => {
                if (response.statusCode !== 200) {
                    reject(new Error(`Download failed: ${response.statusCode}`));
                    return;
                }
                
                response.pipe(file);
                file.on('finish', () => {
                    file.close();
                    resolve();
                });
            }).on('error', (error) => {
                fs.unlink(destPath, () => {});
                reject(new Error(`Download error: ${error.message}`));
            });
        });
    }
    
    async getLatestVersion() {
        try {
            const release = await this.fetchLatestRelease();
            return release.tag_name;
        } catch {
            return this.config.currentVersion;
        }
    }
    
    isNewerVersion(latest, current) {
        const latestClean = latest.replace(/^v/, '');
        const currentClean = current.replace(/^v/, '');
        
        const latestParts = latestClean.split('.').map(Number);
        const currentParts = currentClean.split('.').map(Number);
        
        for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
            const latestPart = latestParts[i] || 0;
            const currentPart = currentParts[i] || 0;
            
            if (latestPart > currentPart) return true;
            if (latestPart < currentPart) return false;
        }
        
        return false;
    }
    
    async getSystemStats() {
        const si = require('systeminformation');
        
        const [memory, cpu, fsSize] = await Promise.all([
            si.mem(),
            si.currentLoad(),
            si.fsSize()
        ]);
        
        return {
            memory: {
                total: memory.total,
                used: memory.used,
                percent: Math.round((memory.used / memory.total) * 100)
            },
            cpu: {
                load: Math.round(cpu.currentLoad)
            },
            disk: {
                percent: fsSize[0]?.use || 0
            },
            timestamp: new Date().toISOString()
        };
    }
    
    log(message, level = 'info') {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
        
        if (level === 'error') console.error(logMessage);
        else if (level === 'warn') console.warn(logMessage);
        else if (this.config.logLevel === 'debug' || level !== 'debug') console.log(logMessage);
        
        this.logToFile(logMessage);
    }
    
    async logToFile(message) {
        try {
            const logPath = path.join(this.directories.logs, 'auto-update.log');
            await fs.appendFile(logPath, message + '\n', 'utf8');
        } catch (error) {
            console.error(`Failed to write to log: ${error.message}`);
        }
    }
}

// Main
if (require.main === module) {
    const updateSystem = new AutoUpdateSystem();
    
    process.on('SIGINT', () => {
        console.log('\n👋 Shutting down...');
        process.exit(0);
    });
    
    process.on('uncaughtException', (error) => {
        console.error('💥 Uncaught exception:', error);
        process.exit(1);
    });
}

module.exports = AutoUpdateSystem;