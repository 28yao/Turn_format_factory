const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { convertImage, getImageInfo } = require('./converter');
const { convertAudio, getAudioInfo: getAudioInfoFn, AUDIO_FORMATS: AUDIO_FORMATS_LIST } = require('./audioConverter');
const { convertVideo, getVideoInfo: getVideoInfoFn, VIDEO_FORMATS: VIDEO_FORMATS_LIST } = require('./videoConverter');
const { convertFile, checkAllEngines, isFileToPdfExt, FILE_TO_PDF_INPUT_EXTS, PDF_TO_FILE_FORMATS, WORD_CONVERT_FORMATS } = require('./docConverter');

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

const VIDEO_FILE_FILTERS = [
    { name: '所有视频格式', extensions: ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'gif'] },
    { name: 'MP4', extensions: ['mp4'] },
    { name: 'AVI', extensions: ['avi'] },
    { name: 'MKV', extensions: ['mkv'] },
    { name: 'MOV', extensions: ['mov'] },
    { name: 'WMV', extensions: ['wmv'] },
    { name: 'FLV', extensions: ['flv'] },
    { name: 'WebM', extensions: ['webm'] },
    { name: 'GIF', extensions: ['gif'] }
];

const AUDIO_FILE_FILTERS = [
    { name: '所有音频格式', extensions: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'opus', 'wma', 'kgm', 'kgma', 'kgg', 'ncm'] },
    { name: 'MP3', extensions: ['mp3'] },
    { name: 'WAV', extensions: ['wav'] },
    { name: 'FLAC', extensions: ['flac'] },
    { name: 'AAC', extensions: ['aac'] },
    { name: 'OGG', extensions: ['ogg'] },
    { name: 'M4A', extensions: ['m4a'] },
    { name: 'Opus', extensions: ['opus'] },
    { name: 'WMA', extensions: ['wma'] },
    { name: 'KGM (酷狗加密)', extensions: ['kgm', 'kgma', 'kgg'] },
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

// === 视频相关 ===

// 获取视频格式列表
ipcMain.handle('get-video-formats', () => {
    return { formats: VIDEO_FORMATS_LIST };
});

// 选择视频文件（单张模式）
ipcMain.handle('select-video-files', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: '选择视频文件',
        properties: ['openFile', 'multiSelections'],
        filters: VIDEO_FILE_FILTERS
    });
    if (result.canceled) return { files: [] };

    const filesInfo = [];
    for (const filePath of result.filePaths) {
        try {
            const info = await getVideoInfoFn(filePath);
            filesInfo.push(info);
        } catch {
            const stat = fs.statSync(filePath);
            filesInfo.push({
                path: filePath,
                name: path.basename(filePath),
                ext: path.extname(filePath).toLowerCase(),
                size: stat.size
            });
        }
    }
    return { files: filesInfo };
});

// 选择视频文件夹（批量模式）
ipcMain.handle('select-video-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: '选择包含视频文件的文件夹',
        properties: ['openDirectory']
    });
    if (result.canceled) return { files: [] };

    const dir = result.filePaths[0];
    const validExts = ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.gif'];
    const files = [];

    const dirEntries = fs.readdirSync(dir);
    for (const entry of dirEntries) {
        const ext = path.extname(entry).toLowerCase();
        if (validExts.includes(ext)) {
            const fullPath = path.join(dir, entry);
            try {
                const info = await getVideoInfoFn(fullPath);
                files.push(info);
            } catch {
                const stat = fs.statSync(fullPath);
                files.push({
                    path: fullPath,
                    name: entry,
                    ext: ext,
                    size: stat.size
                });
            }
        }
    }

    return { files, folderPath: dir };
});

// 获取视频格式详情（含编码器信息）
ipcMain.handle('get-video-format-details', () => {
    return { formats: VIDEO_FORMATS_LIST };
});

// 获取单个视频文件详细信息
ipcMain.handle('get-video-info-single', async (event, filePath) => {
    try {
        const info = await getVideoInfoFn(filePath);
        return { success: true, info };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// 获取单个图片文件信息
ipcMain.handle('get-image-info-single', async (event, filePath) => {
    try {
        const info = await getImageInfo(filePath);
        return { success: true, info };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// === 视频转换 ===

// 单张视频转换
ipcMain.handle('convert-video-single', async (event, options) => {
    const { inputPath, targetFormat, quality, resize, keepAspectRatio, outputDir, scalePercent } = options;
    try {
        const result = await convertVideo(inputPath, targetFormat, {
            quality,
            resize,
            keepAspectRatio,
            scalePercent,
            outputDir
        });
        return { success: true, ...result };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// 批量视频转换
ipcMain.handle('convert-video-batch', async (event, options) => {
    const { files, targetFormat, quality, resize, keepAspectRatio, outputDir, scalePercent } = options;
    const results = [];

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
            const result = await convertVideo(file.path, targetFormat, {
                quality,
                resize,
                keepAspectRatio,
                scalePercent,
                outputDir
            });
            results.push({ success: true, file: file.name, ...result, index: i, total: files.length });
        } catch (err) {
            results.push({ success: false, file: file.name, error: err.message, index: i, total: files.length });
        }

        // 发送进度
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('video-batch-progress', {
                current: i + 1,
                total: files.length,
                lastResult: results[results.length - 1]
            });
        }
    }

    return results;
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
    const validExts = ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.opus', '.wma', '.kgm', '.kgma', '.kgg', '.ncm'];
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

// === 通用 ===

// 保存拖拽文件到临时目录（当 file.path 不可用时）
ipcMain.handle('save-temp-file', async (event, { name, buffer }) => {
    try {
        const tmpDir = os.tmpdir();
        const safeName = Date.now() + '_' + name.replace(/[^\w.-]/g, '_');
        const dest = path.join(tmpDir, safeName);
        fs.writeFileSync(dest, Buffer.from(buffer));
        return { success: true, path: dest };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// === 文档/PDF 相关 ===

// 文档/PDF文件过滤
const DOC_FILE_FILTERS = [
    { name: '所有文档和图片', extensions: ['docx', 'xlsx', 'pptx', 'jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'tiff', 'tif', 'txt'] },
    { name: 'Word 文档', extensions: ['docx'] },
    { name: 'Excel 表格', extensions: ['xlsx'] },
    { name: 'PPT 演示', extensions: ['pptx'] },
    { name: '图片文件', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'tiff', 'tif'] },
    { name: '文本文件', extensions: ['txt'] }
];

const PDF_FILE_FILTERS = [
    { name: 'PDF 文件', extensions: ['pdf'] }
];

const WORD_FILE_FILTERS = [
    { name: 'Word 文档', extensions: ['docx'] }
];

// 获取文档转换格式列表
ipcMain.handle('get-doc-formats', () => {
    return {
        pdfToFileFormats: PDF_TO_FILE_FORMATS,
        wordConvertFormats: WORD_CONVERT_FORMATS
    };
});

// 检查所有可用转换引擎
ipcMain.handle('check-libreoffice', async () => {
    return await checkAllEngines();
});

// 选择文件（文件转PDF/PDF转文件/Word转换）
ipcMain.handle('select-office-files', async (event, convertType) => {
    let filters;
    let title;
    if (convertType === 'file-to-pdf') {
        filters = DOC_FILE_FILTERS;
        title = '选择要转换为 PDF 的文件';
    } else if (convertType === 'pdf-to-file') {
        filters = PDF_FILE_FILTERS;
        title = '选择 PDF 文件';
    } else {
        filters = WORD_FILE_FILTERS;
        title = '选择 Word 文档';
    }

    const result = await dialog.showOpenDialog(mainWindow, {
        title,
        properties: ['openFile', 'multiSelections'],
        filters
    });
    if (result.canceled) return { files: [] };

    const filesInfo = [];
    for (const filePath of result.filePaths) {
        const stat = fs.statSync(filePath);
        filesInfo.push({
            path: filePath,
            name: path.basename(filePath),
            ext: path.extname(filePath).toLowerCase(),
            size: stat.size
        });
    }
    return { files: filesInfo };
});

// 选择文件夹（批量模式）
ipcMain.handle('select-office-folder', async (event, convertType) => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: '选择包含文件的文件夹',
        properties: ['openDirectory']
    });
    if (result.canceled) return { files: [] };

    const dir = result.filePaths[0];
    let validExts;
    if (convertType === 'file-to-pdf') {
        validExts = FILE_TO_PDF_INPUT_EXTS;
    } else if (convertType === 'pdf-to-file') {
        validExts = ['.pdf'];
    } else {
        validExts = ['.docx'];
    }

    const files = [];
    const dirEntries = fs.readdirSync(dir);
    for (const entry of dirEntries) {
        const ext = path.extname(entry).toLowerCase();
        if (validExts.includes(ext)) {
            const fullPath = path.join(dir, entry);
            const stat = fs.statSync(fullPath);
            files.push({
                path: fullPath,
                name: entry,
                ext: ext,
                size: stat.size
            });
        }
    }

    return { files, folderPath: dir };
});

// 单张文档转换
ipcMain.handle('convert-office-single', async (event, options) => {
    const { inputPath, targetFormat, outputDir } = options;
    try {
        const result = await convertFile(inputPath, targetFormat, outputDir);
        return { success: true, ...result };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// 批量文档转换
ipcMain.handle('convert-office-batch', async (event, options) => {
    const { files, targetFormat, outputDir } = options;
    const results = [];

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
            const result = await convertFile(file.path, targetFormat, outputDir);
            results.push({ success: true, file: file.name, ...result, index: i, total: files.length });
        } catch (err) {
            results.push({ success: false, file: file.name, error: err.message, index: i, total: files.length });
        }

        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('office-batch-progress', {
                current: i + 1,
                total: files.length,
                lastResult: results[results.length - 1]
            });
        }
    }

    return results;
});
