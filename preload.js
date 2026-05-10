const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
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
    }
});
