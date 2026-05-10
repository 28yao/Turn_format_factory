const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { convertImage, getImageInfo } = require('./converter');
const { convertAudio, getAudioInfo: getAudioInfoFn, AUDIO_FORMATS: AUDIO_FORMATS_LIST } = require('./audioConverter');

let mainWindow = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 900,
        height: 680,
        minWidth: 700,
        minHeight: 550,
        title: '格式工厂',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    mainWindow.setTitle('格式工厂');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// 支持的音频格式
const AUDIO_FORMATS = [
    { label: 'MP3 (.mp3)', ext: '.mp3' },
    { label: 'WAV (.wav)', ext: '.wav' },
    { label: 'FLAC (.flac)', ext: '.flac' },
    { label: 'AAC (.aac)', ext: '.aac' },
    { label: 'OGG (.ogg)', ext: '.ogg' },
    { label: 'M4A (.m4a)', ext: '.m4a' },
    { label: 'Opus (.opus)', ext: '.opus' },
    { label: 'WMA (.wma)', ext: '.wma' }
];

// 支持的图片格式
const IMAGE_FORMATS = [
    { label: 'JPEG (.jpg)', ext: '.jpg', mime: 'image/jpeg' },
    { label: 'PNG (.png)', ext: '.png', mime: 'image/png' },
    { label: 'WebP (.webp)', ext: '.webp', mime: 'image/webp' },
    { label: 'BMP (.bmp)', ext: '.bmp', mime: 'image/bmp' },
    { label: 'GIF (.gif)', ext: '.gif', mime: 'image/gif' },
    { label: 'TIFF (.tiff)', ext: '.tiff', mime: 'image/tiff' },
    { label: 'ICO (.ico)', ext: '.ico', mime: 'image/x-icon' },
    { label: 'AVIF (.avif)', ext: '.avif', mime: 'image/avif' }
];

const AUDIO_FILE_FILTERS = [
    { name: '所有音频格式', extensions: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'opus', 'wma', 'kgm', 'kgma', 'ncm'] },
    { name: 'MP3', extensions: ['mp3'] },
    { name: 'WAV', extensions: ['wav'] },
    { name: 'FLAC', extensions: ['flac'] },
    { name: 'AAC', extensions: ['aac'] },
    { name: 'OGG', extensions: ['ogg'] },
    { name: 'M4A', extensions: ['m4a'] },
    { name: 'Opus', extensions: ['opus'] },
    { name: 'WMA', extensions: ['wma'] },
    { name: 'KGM (酷狗加密)', extensions: ['kgm', 'kgma'] },
    { name: 'NCM (网易云加密)', extensions: ['ncm'] }
];

const FILE_FILTERS = [
    { name: '所有图片格式', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'svg', 'tiff', 'tif', 'ico', 'avif', 'heic', 'heif'] },
    { name: 'JPEG', extensions: ['jpg', 'jpeg'] },
    { name: 'PNG', extensions: ['png'] },
    { name: 'WebP', extensions: ['webp'] },
    { name: 'BMP', extensions: ['bmp'] },
    { name: 'GIF', extensions: ['gif'] },
    { name: 'SVG', extensions: ['svg'] },
    { name: 'TIFF', extensions: ['tiff', 'tif'] },
    { name: 'ICO', extensions: ['ico'] },
    { name: 'AVIF', extensions: ['avif'] },
    { name: 'HEIC', extensions: ['heic', 'heif'] }
];

// === IPC Handlers ===

// 选择文件（单张模式）
ipcMain.handle('select-files', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: '选择图片文件',
        properties: ['openFile', 'multiSelections'],
        filters: FILE_FILTERS
    });
    if (result.canceled) return { files: [] };

    const filesInfo = [];
    for (const filePath of result.filePaths) {
        try {
            const info = await getImageInfo(filePath);
            filesInfo.push(info);
        } catch {
            const stat = fs.statSync(filePath);
            filesInfo.push({
                path: filePath,
                name: path.basename(filePath),
                ext: path.extname(filePath).toLowerCase(),
                size: stat.size,
                error: '无法读取图片信息'
            });
        }
    }
    return { files: filesInfo };
});

// 选择文件夹（批量模式）
ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: '选择包含图片的文件夹',
        properties: ['openDirectory']
    });
    if (result.canceled) return { files: [] };

    const dir = result.filePaths[0];
    const validExts = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.svg', '.tiff', '.tif', '.ico', '.avif', '.heic', '.heif'];
    const files = [];

    const dirEntries = fs.readdirSync(dir);
    for (const entry of dirEntries) {
        const ext = path.extname(entry).toLowerCase();
        if (validExts.includes(ext)) {
            const fullPath = path.join(dir, entry);
            try {
                const info = await getImageInfo(fullPath);
                files.push(info);
            } catch {
                const stat = fs.statSync(fullPath);
                files.push({
                    path: fullPath,
                    name: entry,
                    ext: ext,
                    size: stat.size,
                    error: '无法读取图片信息'
                });
            }
        }
    }

    return { files, folderPath: dir };
});

// 选择输出目录
ipcMain.handle('select-output', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: '选择输出目录',
        properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled) return { path: null };
    return { path: result.filePaths[0] };
});

// 获取格式列表
ipcMain.handle('get-formats', () => {
    return { formats: IMAGE_FORMATS };
});

// 获取音频格式列表
ipcMain.handle('get-audio-formats', () => {
    return { formats: AUDIO_FORMATS };
});

// 获取音频格式详情（含编码器/码率信息）
ipcMain.handle('get-audio-format-details', () => {
    return { formats: AUDIO_FORMATS_LIST };
});

// === 音频文件选择 ===

// 选择音频文件（单张模式）
ipcMain.handle('select-audio-files', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: '选择音频文件',
        properties: ['openFile', 'multiSelections'],
        filters: AUDIO_FILE_FILTERS
    });
    if (result.canceled) return { files: [] };

    const filesInfo = [];
    for (const filePath of result.filePaths) {
        try {
            const info = await getAudioInfoFn(filePath);
            filesInfo.push(info);
        } catch {
            const stat = fs.statSync(filePath);
            filesInfo.push({
                path: filePath,
                name: path.basename(filePath),
                ext: path.extname(filePath).toLowerCase(),
                size: stat.size,
                error: '无法读取音频信息'
            });
        }
    }
    return { files: filesInfo };
});

// 选择音频文件夹（批量模式）
ipcMain.handle('select-audio-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: '选择包含音频文件的文件夹',
        properties: ['openDirectory']
    });
    if (result.canceled) return { files: [] };

    const dir = result.filePaths[0];
    const validExts = ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.opus', '.wma', '.kgm', '.kgma', '.ncm'];
    const files = [];

    const dirEntries = fs.readdirSync(dir);
    for (const entry of dirEntries) {
        const ext = path.extname(entry).toLowerCase();
        if (validExts.includes(ext)) {
            const fullPath = path.join(dir, entry);
            try {
                const info = await getAudioInfoFn(fullPath);
                files.push(info);
            } catch {
                const stat = fs.statSync(fullPath);
                files.push({
                    path: fullPath,
                    name: entry,
                    ext: ext,
                    size: stat.size,
                    error: '无法读取音频信息'
                });
            }
        }
    }

    return { files, folderPath: dir };
});

// === 音频转换 ===

// 单张音频转换
ipcMain.handle('convert-audio-single', async (event, options) => {
    const { inputPath, targetFormat, bitrate, outputDir } = options;
    try {
        const result = await convertAudio(inputPath, targetFormat, {
            bitrate,
            outputDir
        });
        return { success: true, ...result };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// 批量音频转换
ipcMain.handle('convert-audio-batch', async (event, options) => {
    const { files, targetFormat, bitrate, outputDir } = options;
    const results = [];

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
            const result = await convertAudio(file.path, targetFormat, {
                bitrate,
                outputDir
            });
            results.push({ success: true, file: file.name, ...result, index: i, total: files.length });
        } catch (err) {
            results.push({ success: false, file: file.name, error: err.message, index: i, total: files.length });
        }

        // 发送进度
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('audio-batch-progress', {
                current: i + 1,
                total: files.length,
                lastResult: results[results.length - 1]
            });
        }
    }

    return results;
});

// 单张转换
ipcMain.handle('convert-single', async (event, options) => {
    const { inputPath, targetFormat, quality, resize, keepAspectRatio, outputDir } = options;
    try {
        const result = await convertImage(inputPath, targetFormat, {
            quality,
            resize,
            keepAspectRatio,
            outputDir
        });
        return { success: true, ...result };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// 批量转换
ipcMain.handle('convert-batch', async (event, options) => {
    const { files, targetFormat, quality, resize, keepAspectRatio, outputDir } = options;
    const results = [];

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
            const result = await convertImage(file.path, targetFormat, {
                quality,
                resize,
                keepAspectRatio,
                outputDir
            });
            results.push({ success: true, file: file.name, ...result, index: i, total: files.length });
        } catch (err) {
            results.push({ success: false, file: file.name, error: err.message, index: i, total: files.length });
        }

        // 发送进度
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('batch-progress', {
                current: i + 1,
                total: files.length,
                lastResult: results[results.length - 1]
            });
        }
    }

    return results;
});
