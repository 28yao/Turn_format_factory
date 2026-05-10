// === 状态 ===
let state = {
    mode: 'single',
    files: [],
    outputDir: null,
    originalDir: null,
    isSingleImage: true
};

const LOSSY_FORMATS = ['.jpg', '.jpeg', '.webp', '.avif'];
const IMAGE_FORMATS = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tiff', '.tif', '.ico', '.avif'];

// === DOM 引用 ===
const $ = (id) => document.getElementById(id);

const modeTabs = document.querySelectorAll('.mode-tab');
const dropzone = $('dropzone');
const dropzoneLabel = $('dropzone-label');
const selectBtn = $('select-btn');
const fileInput = $('file-input');
const fileInfo = $('file-info');
const targetFormat = $('target-format');
const qualitySlider = $('quality-slider');
const qualityValue = $('quality-value');
const resizeWidth = $('resize-width');
const resizeHeight = $('resize-height');
const resizeOriginalBtn = $('resize-original-btn');
const keepAspectRatio = $('keep-aspect-ratio');
const outputDirInput = $('output-dir');
const selectOutputBtn = $('select-output-btn');
const convertBtn = $('convert-btn');
const logSection = $('log-section');
const logContainer = $('log-container');
const progressBar = $('progress-bar');
const progressFill = $('progress-fill');
const progressText = $('progress-text');

// === 工具函数 ===

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function getExtFromPath(filePath) {
    const name = filePath.toLowerCase();
    for (const ext of IMAGE_FORMATS) {
        if (name.endsWith(ext)) return ext;
    }
    return '';
}

function now() {
    const d = new Date();
    return d.toLocaleTimeString('zh-CN', { hour12: false });
}

function addLog(type, message) {
    logSection.style.display = 'block';
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `<span class="log-time">[${now()}]</span><span class="log-msg">${message}</span>`;
    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;
}

function clearLogs() {
    logContainer.innerHTML = '';
    logSection.style.display = 'none';
    progressBar.style.display = 'none';
}

function setProgress(current, total) {
    progressBar.style.display = 'block';
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    progressFill.style.width = pct + '%';
    progressText.textContent = `${current}/${total}`;
}

// === 模式切换 ===

modeTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        modeTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        state.mode = tab.dataset.mode;
        state.files = [];
        state.outputDir = null;
        state.originalDir = null;
        fileInfo.style.display = 'none';
        convertBtn.disabled = true;
        clearLogs();

        if (state.mode === 'single') {
            dropzoneLabel.textContent = '点击选择文件或拖拽图片到此处';
            selectBtn.textContent = '选择文件';
        } else {
            dropzoneLabel.textContent = '点击选择文件夹或拖拽图片到此处';
            selectBtn.textContent = '选择文件夹';
        }
    });
});

// === 文件选择 ===

// 点击选择按钮
selectBtn.addEventListener('click', async () => {
    let result;
    if (state.mode === 'single') {
        result = await window.electronAPI.selectFiles();
    } else {
        result = await window.electronAPI.selectFolder();
    }

    if (result.files && result.files.length > 0) {
        state.files = result.files;
        state.isSingleImage = state.files.length === 1;
        if (result.folderPath) {
            state.originalDir = result.folderPath;
        } else {
            state.originalDir = null;
        }
        renderFileInfo();
        convertBtn.disabled = false;
    }
});

// 拖拽支持
dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
});

dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
});

dropzone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');

    const files = e.dataTransfer.files;
    if (files.length === 0) return;

    // 对于拖拽，我们用 file-input 的 files，实际通过 IPC 读取路径
    // 由于 Electron 拖拽可以获得路径
    const paths = [];
    for (const file of files) {
        if (file.path) {
            const ext = getExtFromPath(file.path);
            if (ext) paths.push(file.path);
        }
    }

    if (paths.length === 0) {
        addLog('error', '请拖拽支持的图片格式文件');
        return;
    }

    // 构造模拟结果
    const result = { files: [] };
    const isDir = paths.length > 1 && state.mode === 'batch';

    for (const filePath of paths) {
        result.files.push({
            path: filePath,
            name: filePath.split('\\').pop().split('/').pop(),
            ext: getExtFromPath(filePath)
        });
    }

    state.files = result.files;
    state.isSingleImage = state.files.length === 1;
    state.originalDir = null;
    renderFileInfo();
    convertBtn.disabled = false;
});

// === 渲染文件信息 ===

function renderFileInfo() {
    fileInfo.style.display = 'block';

    if (state.mode === 'single' && state.files.length === 1) {
        const file = state.files[0];
        fileInfo.innerHTML = `
            <div class="file-details">
                <img class="file-thumb" src="file:///${file.path.replace(/\\/g, '/')}" alt="${file.name}"
                     onerror="this.style.display='none'">
                <div class="file-meta">
                    <div class="file-name">${file.name}</div>
                    ${file.width ? `<div class="file-dimensions">${file.width} × ${file.height} 像素</div>` : ''}
                    ${file.size ? `<div class="file-size">${formatFileSize(file.size)}</div>` : ''}
                    ${file.error ? `<div class="file-error">${file.error}</div>` : ''}
                </div>
            </div>
        `;

        // 自动填充原始尺寸
        if (file.width && file.height) {
            resizeWidth.value = file.width;
            resizeHeight.value = file.height;
        }
    } else {
        // 批量模式
        let html = `<div class="file-list">`;
        state.files.forEach((file, i) => {
            const iconPath = `file:///${file.path.replace(/\\/g, '/')}`;
            html += `
                <div class="file-list-item">
                    <img class="file-list-icon" src="${iconPath}" onerror="this.style.display='none'">
                    <span class="file-list-name">${file.name}</span>
                    <span class="file-list-size">${file.size ? formatFileSize(file.size) : ''}</span>
                </div>
            `;
        });
        html += `</div>`;
        html += `<div style="margin-top:8px;font-size:13px;color:#888;">共 ${state.files.length} 个文件</div>`;
        fileInfo.innerHTML = html;

        // 批量清除尺寸预设
        resizeWidth.value = '';
        resizeHeight.value = '';
    }
}

// === 质量滑块 ===

qualitySlider.addEventListener('input', () => {
    qualityValue.textContent = qualitySlider.value + '%';
});

// 格式变更时更新质量状态
targetFormat.addEventListener('change', () => {
    const fmt = targetFormat.value;
    if (LOSSY_FORMATS.includes(fmt)) {
        qualitySlider.disabled = false;
        qualityValue.style.color = '#1a73e8';
    } else {
        qualitySlider.disabled = true;
        qualityValue.textContent = 'N/A';
        qualityValue.style.color = '#999';
    }
});

// === 原始尺寸按钮 ===

resizeOriginalBtn.addEventListener('click', () => {
    if (state.files.length === 1) {
        const file = state.files[0];
        if (file.width && file.height) {
            resizeWidth.value = file.width;
            resizeHeight.value = file.height;
        }
    } else {
        // 批量模式下清空
        resizeWidth.value = '';
        resizeHeight.value = '';
    }
});

// === 输出目录 ===

selectOutputBtn.addEventListener('click', async () => {
    const result = await window.electronAPI.selectOutput();
    if (result.path) {
        state.outputDir = result.path;
        outputDirInput.value = result.path;
    }
});

outputDirInput.addEventListener('click', async () => {
    const result = await window.electronAPI.selectOutput();
    if (result.path) {
        state.outputDir = result.path;
        outputDirInput.value = result.path;
    }
});

// === 开始转换 ===

convertBtn.addEventListener('click', async () => {
    if (state.files.length === 0) return;

    clearLogs();
    convertBtn.disabled = true;

    const targetFmt = targetFormat.value;
    const quality = parseInt(qualitySlider.value);
    const resizeOpts = {};
    if (resizeWidth.value) resizeOpts.width = parseInt(resizeWidth.value);
    if (resizeHeight.value) resizeOpts.height = parseInt(resizeHeight.value);
    const keepAR = keepAspectRatio.checked;

    const options = {
        targetFormat: targetFmt,
        quality,
        resize: (resizeOpts.width || resizeOpts.height) ? resizeOpts : null,
        keepAspectRatio: keepAR,
        outputDir: state.outputDir
    };

    if (state.isSingleImage || state.mode === 'single') {
        // 单张转换
        addLog('info', `开始转换: ${state.files[0].name} → ${targetFmt}`);

        const result = await window.electronAPI.convertSingle({
            inputPath: state.files[0].path,
            ...options
        });

        if (result.success) {
            const ratio = result.originalSize > 0
                ? ((1 - result.outputSize / result.originalSize) * 100).toFixed(1)
                : 0;
            addLog('success',
                `转换成功: ${result.outputName} (${formatFileSize(result.outputSize)}, ` +
                `${ratio > 0 ? `压缩 ${ratio}%` : ''})`
            );
        } else {
            addLog('error', `转换失败: ${result.error}`);
        }
    } else {
        // 批量转换
        addLog('info', `开始批量转换 ${state.files.length} 个文件 → ${targetFmt}`);
        setProgress(0, state.files.length);

        // 监听进度
        window.electronAPI.onBatchProgress((data) => {
            setProgress(data.current, data.total);
            const r = data.lastResult;
            if (r.success) {
                addLog('success', `[${r.index + 1}/${r.total}] ${r.file} → 转换成功 (${formatFileSize(r.outputSize)})`);
            } else {
                addLog('error', `[${r.index + 1}/${r.total}] ${r.file} → ${r.error}`);
            }
        });

        const results = await window.electronAPI.convertBatch({
            files: state.files,
            ...options
        });

        window.electronAPI.removeBatchProgress();

        const successCount = results.filter(r => r.success).length;
        addLog('info', `批量转换完成: ${successCount}/${results.length} 个成功`);
    }

    convertBtn.disabled = false;
});

// === 初始化 ===

// 默认触发一次格式变更以设置质量状态
targetFormat.dispatchEvent(new Event('change'));
