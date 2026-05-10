const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
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
    }
});
