const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // 获取拖拽文件的系统路径（Electron 专用 API）
    getPathForFile: (file) => webUtils.getPathForFile(file),
    // ===== 图片相关 =====
    // 选择图片文件（单张）
    selectFiles: () => ipcRenderer.invoke('select-files'),
    // 选择文件夹（批量）
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    // 选择输出目录
    selectOutput: () => ipcRenderer.invoke('select-output'),
    // 获取支持的格式列表
    getFormats: () => ipcRenderer.invoke('get-formats'),
    // 单张转换
    convertSingle: (options) => ipcRenderer.invoke('convert-single', options),
    // 批量转换
    convertBatch: (options) => ipcRenderer.invoke('convert-batch', options),
    // 批量进度监听
    onBatchProgress: (callback) => {
        ipcRenderer.on('batch-progress', (event, data) => callback(data));
    },
    // 移除进度监听
    removeBatchProgress: () => {
        ipcRenderer.removeAllListeners('batch-progress');
    },

    // ===== 音频相关 =====
    // 选择音频文件（单张）
    selectAudioFiles: () => ipcRenderer.invoke('select-audio-files'),
    // 选择音频文件夹（批量）
    selectAudioFolder: () => ipcRenderer.invoke('select-audio-folder'),
    // 获取音频格式列表
    getAudioFormats: () => ipcRenderer.invoke('get-audio-formats'),
    // 获取音频格式详情（含编码器/码率信息）
    getAudioFormatDetails: () => ipcRenderer.invoke('get-audio-format-details'),
    // 单张音频转换
    convertAudioSingle: (options) => ipcRenderer.invoke('convert-audio-single', options),
    // 批量音频转换
    convertAudioBatch: (options) => ipcRenderer.invoke('convert-audio-batch', options),
    // 音频批量进度监听
    onAudioBatchProgress: (callback) => {
        ipcRenderer.on('audio-batch-progress', (event, data) => callback(data));
    },
    // 移除音频进度监听
    removeAudioBatchProgress: () => {
        ipcRenderer.removeAllListeners('audio-batch-progress');
    },

    // ===== 视频相关 =====
    // 选择视频文件（单张）
    selectVideoFiles: () => ipcRenderer.invoke('select-video-files'),
    // 选择视频文件夹（批量）
    selectVideoFolder: () => ipcRenderer.invoke('select-video-folder'),
    // 获取视频格式列表
    getVideoFormats: () => ipcRenderer.invoke('get-video-formats'),
    // 获取视频格式详情（含编码器信息）
    getVideoFormatDetails: () => ipcRenderer.invoke('get-video-format-details'),
    // 获取单个视频文件信息
    getVideoInfo: (filePath) => ipcRenderer.invoke('get-video-info-single', filePath),
    // 获取单个图片文件信息
    getImageInfo: (filePath) => ipcRenderer.invoke('get-image-info-single', filePath),
    // 单张视频转换
    convertVideoSingle: (options) => ipcRenderer.invoke('convert-video-single', options),
    // 批量视频转换
    convertVideoBatch: (options) => ipcRenderer.invoke('convert-video-batch', options),
    // 视频批量进度监听
    onVideoBatchProgress: (callback) => {
        ipcRenderer.on('video-batch-progress', (event, data) => callback(data));
    },
    // 移除视频进度监听
    removeVideoBatchProgress: () => {
        ipcRenderer.removeAllListeners('video-batch-progress');
    },
    // ===== 通用 =====
    // 保存文件到临时目录（用于 file.path 不可用的拖拽文件）
    saveTempFile: (data) => ipcRenderer.invoke('save-temp-file', data),

    // ===== 文档/PDF 相关 =====
    // 获取文档转换格式列表
    getDocFormats: () => ipcRenderer.invoke('get-doc-formats'),
    // 检查 LibreOffice 是否可用
    checkLibreOffice: () => ipcRenderer.invoke('check-libreoffice'),
    // 选择文件（文件转PDF/PDF转文件/Word转换）
    selectOfficeFiles: (convertType) => ipcRenderer.invoke('select-office-files', convertType),
    // 选择文件夹（批量模式）
    selectOfficeFolder: (convertType) => ipcRenderer.invoke('select-office-folder', convertType),
    // 单张文档转换
    convertOfficeSingle: (options) => ipcRenderer.invoke('convert-office-single', options),
    // 批量文档转换
    convertOfficeBatch: (options) => ipcRenderer.invoke('convert-office-batch', options),
    // 文档批量进度监听
    onOfficeBatchProgress: (callback) => {
        ipcRenderer.on('office-batch-progress', (event, data) => callback(data));
    },
    // 移除文档批量进度监听
    removeOfficeBatchProgress: () => {
        ipcRenderer.removeAllListeners('office-batch-progress');
    }
});
