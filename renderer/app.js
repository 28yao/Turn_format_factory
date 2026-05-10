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
        formats: 'MP3 / WAV / FLAC / AAC\nOGG / WMA / M4A',
        status: 'coming',
        statusText: '即将推出',
        actionText: '敬请期待'
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

// === 页面导航 ===

function navigateTo(page, convertType) {
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

        // 检查是否为占位类型
        if (convertType !== 'image') {
            showComingSoon(convertType);
        }
    }
}

function showComingSoon(type) {
    // 清空转换区并提示即将推出
    const names = { video: '视频转换', audio: '音频转换' };
    pageConvert.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;text-align:center;">
            <div style="font-size:48px;margin-bottom:16px;">${type === 'video' ? '🎬' : '🎵'}</div>
            <h2 style="font-size:20px;color:#333;margin-bottom:8px;">${names[type]}</h2>
            <p style="font-size:14px;color:#888;margin-bottom:4px;">该功能正在开发中，敬请期待！</p>
            <p style="font-size:13px;color:#aaa;">后续将支持多种视频/音频格式之间的互转</p>
        </div>
    `;
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
    if (type === 'image') {
        navigateTo('convert', 'image');
    } else {
        addLog('info', `${type === 'video' ? '视频' : '音频'}转换功能即将推出`);
    }
});

// 首页卡片按钮点击（阻止冒泡 + 独立处理）
homeCards.addEventListener('click', (e) => {
    const btn = e.target.closest('.card-action');
    if (!btn) return;
    e.stopPropagation();
    const card = btn.closest('.home-card');
    const type = card.dataset.type;
    if (type === 'image') {
        navigateTo('convert', 'image');
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

        if (appState.mode === 'single') {
            dropzoneLabel.textContent = '点击选择文件或拖拽图片到此处';
            selectBtn.textContent = '选择文件';
        } else {
            dropzoneLabel.textContent = '点击选择文件夹或拖拽图片到此处';
            selectBtn.textContent = '选择文件夹';
        }
    });
});

// === 文件选择 ===
selectBtn.addEventListener('click', async () => {
    let result;
    if (appState.mode === 'single') {
        result = await window.electronAPI.selectFiles();
    } else {
        result = await window.electronAPI.selectFolder();
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

    const result = { files: [] };
    for (const filePath of paths) {
        result.files.push({
            path: filePath,
            name: filePath.split('\\').pop().split('/').pop(),
            ext: getExtFromPath(filePath)
        });
    }

    appState.files = result.files;
    appState.isSingleFile = result.files.length === 1;
    appState.originalDir = null;
    renderFileInfo();
    convertBtn.disabled = false;
});

// === 渲染文件信息 ===
function renderFileInfo() {
    fileInfo.style.display = 'block';

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
                </div>
            `;
        });
        html += `</div>`;
        html += `<div style="margin-top:8px;font-size:13px;color:#888;">共 ${appState.files.length} 个文件</div>`;
        fileInfo.innerHTML = html;

        resizeWidth.value = '';
        resizeHeight.value = '';
    }
}

// === 质量滑块 ===
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

// === 原始尺寸按钮 ===
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

    convertBtn.disabled = false;
});

// === 初始化 ===
renderHome();
targetFormat.dispatchEvent(new Event('change'));
