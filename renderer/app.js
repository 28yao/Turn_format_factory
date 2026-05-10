// === 状态 ===
const appState = {
    currentPage: 'home',
    convertType: null,
    mode: 'single',
    files: [],
    outputDir: null,
    originalDir: null,
    isSingleFile: true
};

const LOSSY_FORMATS = ['.jpg', '.jpeg', '.webp', '.avif'];
const IMAGE_FORMATS = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tiff', '.tif', '.ico', '.avif'];

const AUDIO_EXTS = ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.opus', '.wma', '.kgm', '.kgma', '.ncm'];
const AUDIO_LOSSY_FORMATS = ['.mp3', '.aac', '.ogg', '.m4a', '.opus', '.wma'];
const ENCRYPTED_AUDIO_EXTS = ['.kgm', '.kgma', '.ncm'];

// 音频格式码率范围映射
const AUDIO_BITRATE_MAP = {
    '.mp3': { min: 32, max: 320, step: 32 },
    '.aac': { min: 32, max: 320, step: 32 },
    '.ogg': { min: 32, max: 320, step: 32 },
    '.m4a': { min: 32, max: 320, step: 32 },
    '.opus': { min: 6, max: 510, step: 16 },
    '.wma': { min: 32, max: 320, step: 32 }
};

// 首页卡片配置
const HOME_CARDS = [
    {
        type: 'image',
        icon: '🖼',
        iconClass: 'image',
        title: '图片转换',
        formats: 'JPG / PNG / WebP / BMP\nGIF / TIFF / ICO / AVIF',
        status: 'ready',
        statusText: '可用',
        actionText: '进入转换'
    },
    {
        type: 'video',
        icon: '🎬',
        iconClass: 'video',
        title: '视频转换',
        formats: 'MP4 / AVI / MKV / MOV\nWMV / FLV / WebM',
        status: 'coming',
        statusText: '即将推出',
        actionText: '敬请期待'
    },
    {
        type: 'audio',
        icon: '🎵',
        iconClass: 'audio',
        title: '音频转换',
        formats: 'MP3 / WAV / FLAC / AAC\nOGG / WMA / M4A / Opus\n+KGM / NCM 加密解密',
        status: 'ready',
        statusText: '可用',
        actionText: '进入转换'
    }
];

// === DOM 引用 ===
const $ = (id) => document.getElementById(id);

const pageTitle = $('page-title');
const pageHome = $('page-home');
const pageConvert = $('page-convert');
const sidebar = $('sidebar');
const homeCards = $('home-cards');

const modeTabs = document.querySelectorAll('.mode-tab');
const dropzone = $('dropzone');
const dropzoneLabel = $('dropzone-label');
const selectBtn = $('select-btn');
const fileInput = $('file-input');
const fileInfo = $('file-info');

// 图片设置
const imageSettings = $('image-settings');
const targetFormat = $('target-format');
const qualitySlider = $('quality-slider');
const qualityValue = $('quality-value');
const resizeWidth = $('resize-width');
const resizeHeight = $('resize-height');
const resizeOriginalBtn = $('resize-original-btn');
const keepAspectRatio = $('keep-aspect-ratio');

// 音频设置
const audioSettings = $('audio-settings');
const audioTargetFormat = $('audio-target-format');
const bitrateSlider = $('bitrate-slider');
const bitrateValue = $('bitrate-value');

// 通用
const videoPlaceholder = $('video-placeholder');

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
    // 先检查音频扩展名
    for (const ext of AUDIO_EXTS) {
        if (name.endsWith(ext)) return ext;
    }
    // 再检查图片扩展名
    for (const ext of IMAGE_FORMATS) {
        if (name.endsWith(ext)) return ext;
    }
    return '';
}

function isAudioExt(ext) {
    return AUDIO_EXTS.includes(ext);
}

function isImageExt(ext) {
    return IMAGE_FORMATS.includes(ext);
}

function formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatBitrate(bps) {
    if (!bps || bps <= 0) return '';
    return Math.round(bps / 1000) + 'kbps';
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

function updateDropzoneText() {
    if (appState.convertType === 'audio') {
        if (appState.mode === 'single') {
            dropzoneLabel.textContent = '点击选择文件或拖拽音频到此处';
        } else {
            dropzoneLabel.textContent = '点击选择文件夹或拖拽音频到此处';
        }
    } else {
        if (appState.mode === 'single') {
            dropzoneLabel.textContent = '点击选择文件或拖拽图片到此处';
        } else {
            dropzoneLabel.textContent = '点击选择文件夹或拖拽图片到此处';
        }
    }
}

// === 页面导航 ===

function navigateTo(page, convertType) {
    // 重置状态
    appState.files = [];
    appState.outputDir = null;
    appState.originalDir = null;
    fileInfo.style.display = 'none';
    convertBtn.disabled = true;
    clearLogs();

    appState.currentPage = page;
    appState.convertType = convertType || null;

    // 更新侧边栏
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        const p = item.dataset.page;
        const t = item.dataset.type;
        if ((page === 'home' && p === 'home') ||
            (page === 'convert' && p === 'convert' && t === convertType)) {
            item.classList.add('active');
        }
    });

    // 切换页面显示
    if (page === 'home') {
        pageHome.style.display = 'block';
        pageConvert.style.display = 'none';
        pageTitle.textContent = '首页';
    } else {
        pageHome.style.display = 'none';
        pageConvert.style.display = 'block';

        // 更新标题
        const typeNames = { image: '图片转换', video: '视频转换', audio: '音频转换' };
        pageTitle.textContent = typeNames[convertType] || '转换';

        // 切换对应的设置面板
        imageSettings.style.display = 'none';
        audioSettings.style.display = 'none';
        videoPlaceholder.style.display = 'none';
        document.querySelector('.mode-tabs').style.display = 'flex';
        document.querySelector('#dropzone').closest('.section').style.display = 'block';

        if (convertType === 'image') {
            imageSettings.style.display = 'block';
        } else if (convertType === 'audio') {
            audioSettings.style.display = 'block';
            updateAudioBitrateRange();
        } else {
            // 视频占位
            videoPlaceholder.style.display = 'block';
            document.querySelector('.mode-tabs').style.display = 'none';
            document.querySelector('#dropzone').closest('.section').style.display = 'none';
        }

        updateDropzoneText();
    }
}

// === 渲染首页 ===

function renderHome() {
    homeCards.innerHTML = HOME_CARDS.map(card => `
        <div class="home-card" data-type="${card.type}">
            <div class="card-icon-wrap ${card.iconClass}">${card.icon}</div>
            <div class="card-title">${card.title}</div>
            <div class="card-formats">${card.formats.replace(/\n/g, '<br>')}</div>
            <span class="card-status ${card.status}">${card.statusText}</span>
            <button class="card-action ${card.status !== 'ready' ? 'disabled' : ''}">
                ${card.actionText}
            </button>
        </div>
    `).join('');
}

// === 首页卡片点击 ===
homeCards.addEventListener('click', (e) => {
    const card = e.target.closest('.home-card');
    if (!card) return;
    const type = card.dataset.type;
    if (type === 'image' || type === 'audio') {
        navigateTo('convert', type);
    } else if (type === 'video') {
        navigateTo('convert', 'video');
    }
});

// 首页卡片按钮点击（阻止冒泡 + 独立处理）
homeCards.addEventListener('click', (e) => {
    const btn = e.target.closest('.card-action');
    if (!btn) return;
    e.stopPropagation();
    const card = btn.closest('.home-card');
    const type = card.dataset.type;
    if (type === 'image' || type === 'audio') {
        navigateTo('convert', type);
    }
});

// === 侧边栏导航 ===
sidebar.addEventListener('click', (e) => {
    const item = e.target.closest('.nav-item');
    if (!item) return;

    const page = item.dataset.page;
    const type = item.dataset.type;

    if (page === 'home') {
        navigateTo('home');
    } else if (page === 'convert') {
        navigateTo('convert', type);
    }
});

// === 模式切换 ===
modeTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        modeTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        appState.mode = tab.dataset.mode;
        appState.files = [];
        appState.outputDir = null;
        appState.originalDir = null;
        fileInfo.style.display = 'none';
        convertBtn.disabled = true;
        clearLogs();

        updateDropzoneText();
    });
});

// === 文件选择 ===
selectBtn.addEventListener('click', async () => {
    let result;

    if (appState.convertType === 'audio') {
        if (appState.mode === 'single') {
            result = await window.electronAPI.selectAudioFiles();
        } else {
            result = await window.electronAPI.selectAudioFolder();
        }
    } else {
        if (appState.mode === 'single') {
            result = await window.electronAPI.selectFiles();
        } else {
            result = await window.electronAPI.selectFolder();
        }
    }

    if (result.files && result.files.length > 0) {
        appState.files = result.files;
        appState.isSingleFile = result.files.length === 1;
        if (result.folderPath) {
            appState.originalDir = result.folderPath;
        } else {
            appState.originalDir = null;
        }
        renderFileInfo();
        convertBtn.disabled = false;
    }
});

// 拖拽
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

    const paths = [];
    const skippedFiles = [];

    for (const file of files) {
        // 优先使用 file.path（Electron 完整路径），否则用 file.name 兜底
        const sourcePath = file.path || file.name;
        const ext = getExtFromPath(sourcePath);

        if (!ext) {
            skippedFiles.push(file.name);
            continue;
        }

        // 根据当前页面类型过滤：音频页只接受音频，图片页只接受图片
        if (appState.convertType === 'audio' && !isAudioExt(ext)) {
            skippedFiles.push(file.name);
            continue;
        }
        if ((!appState.convertType || appState.convertType === 'image') && !isImageExt(ext)) {
            skippedFiles.push(file.name);
            continue;
        }

        paths.push({
            path: file.path || sourcePath,
            name: file.name,
            ext: ext
        });
    }

    if (paths.length === 0) {
        const typeLabel = appState.convertType === 'audio' ? '音频' : '图片';
        const detail = skippedFiles.length > 0 ? `（不支持: ${skippedFiles.slice(0, 3).join(', ')}${skippedFiles.length > 3 ? '...' : ''}）` : '';
        addLog('error', `请拖拽支持的${typeLabel}格式文件${detail}`);
        return;
    }

    appState.files = paths;
    appState.isSingleFile = paths.length === 1;
    appState.originalDir = null;
    convertBtn.disabled = false;
    renderFileInfo();
});

// 移除单个文件
function removeFile(index) {
    appState.files.splice(index, 1);
    if (appState.files.length === 0) {
        appState.isSingleFile = true;
        fileInfo.style.display = 'none';
        convertBtn.disabled = true;
    } else {
        renderFileInfo();
    }
}

// 移除全部文件
function removeAllFiles() {
    appState.files = [];
    appState.isSingleFile = true;
    fileInfo.style.display = 'none';
    convertBtn.disabled = true;
}

// === 文件列表事件委托（移除按钮） ===
fileInfo.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('.file-remove-btn');
    if (removeBtn) {
        const index = parseInt(removeBtn.dataset.index);
        if (!isNaN(index)) {
            removeFile(index);
        }
        return;
    }

    const removeAllBtn = e.target.closest('.remove-all-btn');
    if (removeAllBtn) {
        removeAllFiles();
    }
});

// === 渲染文件信息 ===
function renderFileInfo() {
    fileInfo.style.display = 'block';

    if (appState.convertType === 'audio') {
        // 音频文件信息
        if (appState.mode === 'single' && appState.files.length === 1) {
            const file = appState.files[0];
            const ext = file.ext ? file.ext.toLowerCase() : '';
            const isEncrypted = ENCRYPTED_AUDIO_EXTS.includes(ext);
            const formatBadge = isEncrypted ?
                `<span class="audio-format-badge encrypted">${ext === '.ncm' ? 'NCM' : 'KGM'} 加密</span>` :
                `<span class="audio-format-badge">${ext.slice(1).toUpperCase()}</span>`;
            fileInfo.innerHTML = `
                <div class="file-details">
                    <div class="audio-icon">🎵</div>
                    <div class="file-meta">
                        <div class="file-name">${file.name} ${formatBadge}</div>
                        ${file.duration ? `<div class="file-dimensions">时长: ${formatDuration(file.duration)}</div>` : ''}
                        ${file.bitrate ? `<div class="file-dimensions">码率: ${formatBitrate(file.bitrate)}</div>` : ''}
                        ${file.sampleRate ? `<div class="file-dimensions">采样率: ${file.sampleRate} Hz</div>` : ''}
                        ${file.channels ? `<div class="file-dimensions">声道: ${file.channels === 1 ? '单声道' : file.channels === 2 ? '立体声' : file.channels + ' 声道'}</div>` : ''}
                        ${file.size ? `<div class="file-size">${formatFileSize(file.size)}</div>` : ''}
                        ${file.encrypted ? `<div class="file-decrypt-note">${file.encryptedType}，将先解密再转换为目标格式</div>` : ''}
                        ${file.error && !file.encrypted ? `<div class="file-error">${file.error}</div>` : ''}
                    </div>
                </div>
            `;
        } else {
            let html = `<div class="file-list">`;
            appState.files.forEach((file) => {
                html += `
                    <div class="file-list-item">
                        <span class="file-list-audio-icon">🎵</span>
                        <span class="file-list-name">${file.name}</span>
                        <span class="file-list-size">${file.size ? formatFileSize(file.size) : ''}</span>
                        <button class="file-remove-btn" data-index="${appState.files.indexOf(file)}" title="移除">✕</button>
                    </div>
                `;
            });
            html += `</div>`;
            html += `<div class="file-list-footer"><span style="font-size:13px;color:#888;">共 ${appState.files.length} 个文件</span><button class="remove-all-btn">全部移除</button></div>`;
            fileInfo.innerHTML = html;
        }
    } else {
        // 图片文件信息
        if (appState.mode === 'single' && appState.files.length === 1) {
            const file = appState.files[0];
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

            if (file.width && file.height) {
                resizeWidth.value = file.width;
                resizeHeight.value = file.height;
            }
        } else {
            let html = `<div class="file-list">`;
            appState.files.forEach((file) => {
                const iconPath = `file:///${file.path.replace(/\\/g, '/')}`;
                html += `
                    <div class="file-list-item">
                        <img class="file-list-icon" src="${iconPath}" onerror="this.style.display='none'">
                        <span class="file-list-name">${file.name}</span>
                        <span class="file-list-size">${file.size ? formatFileSize(file.size) : ''}</span>
                        <button class="file-remove-btn" data-index="${appState.files.indexOf(file)}" title="移除">✕</button>
                    </div>
                `;
            });
            html += `</div>`;
            html += `<div class="file-list-footer"><span style="font-size:13px;color:#888;">共 ${appState.files.length} 个文件</span><button class="remove-all-btn">全部移除</button></div>`;
            fileInfo.innerHTML = html;

            resizeWidth.value = '';
            resizeHeight.value = '';
        }
    }
}

// === 图片设置：质量滑块 ===
qualitySlider.addEventListener('input', () => {
    qualityValue.textContent = qualitySlider.value + '%';
});

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

// === 图片设置：原始尺寸按钮 ===
resizeOriginalBtn.addEventListener('click', () => {
    if (appState.files.length === 1) {
        const file = appState.files[0];
        if (file.width && file.height) {
            resizeWidth.value = file.width;
            resizeHeight.value = file.height;
        }
    } else {
        resizeWidth.value = '';
        resizeHeight.value = '';
    }
});

// === 音频设置：目标格式切换 ===
function updateAudioBitrateRange() {
    const fmt = audioTargetFormat.value;
    const range = AUDIO_BITRATE_MAP[fmt];
    if (range && AUDIO_LOSSY_FORMATS.includes(fmt)) {
        bitrateSlider.disabled = false;
        bitrateSlider.min = range.min;
        bitrateSlider.max = range.max;
        bitrateSlider.step = range.step;
        // 调整当前值到有效范围内
        let val = parseInt(bitrateSlider.value);
        if (val < range.min) val = range.min;
        if (val > range.max) val = range.max;
        // 对齐到 step
        val = Math.round(val / range.step) * range.step;
        bitrateSlider.value = val;
        bitrateValue.textContent = val + 'kbps';
        bitrateValue.style.color = '#1a73e8';
    } else {
        // WAV/FLAC 等无损格式，禁用码率
        bitrateSlider.disabled = true;
        bitrateValue.textContent = 'N/A';
        bitrateValue.style.color = '#999';
    }
}

audioTargetFormat.addEventListener('change', () => {
    updateAudioBitrateRange();
});

// 码率滑块
bitrateSlider.addEventListener('input', () => {
    bitrateValue.textContent = bitrateSlider.value + 'kbps';
});

// === 输出目录 ===
selectOutputBtn.addEventListener('click', async () => {
    const result = await window.electronAPI.selectOutput();
    if (result.path) {
        appState.outputDir = result.path;
        outputDirInput.value = result.path;
    }
});

outputDirInput.addEventListener('click', async () => {
    const result = await window.electronAPI.selectOutput();
    if (result.path) {
        appState.outputDir = result.path;
        outputDirInput.value = result.path;
    }
});

// === 开始转换 ===
convertBtn.addEventListener('click', async () => {
    if (appState.files.length === 0) return;

    clearLogs();
    convertBtn.disabled = true;

    const isAudio = appState.convertType === 'audio';

    if (isAudio) {
        // === 音频转换 ===
        const targetFmt = audioTargetFormat.value;
        const bitrate = bitrateSlider.disabled ? null : bitrateSlider.value + 'k';

        const options = {
            targetFormat: targetFmt,
            bitrate,
            outputDir: appState.outputDir
        };

        if (appState.isSingleFile || appState.mode === 'single') {
            addLog('info', `开始转换: ${appState.files[0].name} → ${targetFmt}`);

            const result = await window.electronAPI.convertAudioSingle({
                inputPath: appState.files[0].path,
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
            addLog('info', `开始批量转换 ${appState.files.length} 个音频文件 → ${targetFmt}`);
            setProgress(0, appState.files.length);

            window.electronAPI.onAudioBatchProgress((data) => {
                setProgress(data.current, data.total);
                const r = data.lastResult;
                if (r.success) {
                    addLog('success', `[${r.index + 1}/${r.total}] ${r.file} → 转换成功 (${formatFileSize(r.outputSize)})`);
                } else {
                    addLog('error', `[${r.index + 1}/${r.total}] ${r.file} → ${r.error}`);
                }
            });

            const results = await window.electronAPI.convertAudioBatch({
                files: appState.files,
                ...options
            });

            window.electronAPI.removeAudioBatchProgress();

            const successCount = results.filter(r => r.success).length;
            addLog('info', `批量转换完成: ${successCount}/${results.length} 个成功`);
        }
    } else {
        // === 图片转换 ===
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
            outputDir: appState.outputDir
        };

        if (appState.isSingleFile || appState.mode === 'single') {
            addLog('info', `开始转换: ${appState.files[0].name} → ${targetFmt}`);

            const result = await window.electronAPI.convertSingle({
                inputPath: appState.files[0].path,
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
            addLog('info', `开始批量转换 ${appState.files.length} 个文件 → ${targetFmt}`);
            setProgress(0, appState.files.length);

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
                files: appState.files,
                ...options
            });

            window.electronAPI.removeBatchProgress();

            const successCount = results.filter(r => r.success).length;
            addLog('info', `批量转换完成: ${successCount}/${results.length} 个成功`);
        }
    }

    convertBtn.disabled = false;
});

// === 初始化 ===
renderHome();
targetFormat.dispatchEvent(new Event('change'));
audioTargetFormat.dispatchEvent(new Event('change'));
