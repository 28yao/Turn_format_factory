const path = require('path');
const fs = require('fs');
const { promises: fsp } = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const FfmpegCommand = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffprobePath = path.join(path.dirname(ffmpegPath), 'ffprobe.exe');

// 设置 FFmpeg 路径
FfmpegCommand.setFfmpegPath(ffmpegPath);
FfmpegCommand.setFfprobePath(ffprobePath);

// 支持的视频格式定义
const VIDEO_FORMATS = [
    { label: 'MP4 (.mp4)', ext: '.mp4', container: 'mp4', codec: 'libx264', lossy: true },
    { label: 'AVI (.avi)', ext: '.avi', container: 'avi', codec: 'mpeg4', lossy: true },
    { label: 'MKV (.mkv)', ext: '.mkv', container: 'matroska', codec: 'libx264', lossy: true },
    { label: 'MOV (.mov)', ext: '.mov', container: 'mov', codec: 'libx264', lossy: true },
    { label: 'WMV (.wmv)', ext: '.wmv', container: 'asf', codec: 'wmv2', lossy: true },
    { label: 'FLV (.flv)', ext: '.flv', container: 'flv', codec: 'flv', lossy: true },
    { label: 'WebM (.webm)', ext: '.webm', container: 'webm', codec: 'libvpx', lossy: true },
    { label: 'GIF (.gif)', ext: '.gif', container: 'gif', codec: 'gif', lossy: true }
];

const ALL_VIDEO_EXTS = ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.gif'];

// 质量值映射到各编码器的参数
function mapQuality(quality, codec) {
    // quality: 0-100, 越高越好
    const q = Math.max(0, Math.min(100, quality));
    switch (codec) {
        case 'libx264':
            // CRF 0-51, 默认23, 值越高画质越差
            return { crf: Math.round(51 - (q / 100) * 48) };
        case 'mpeg4':
        case 'wmv2':
        case 'flv':
            // qscale:v 1-31, 值越高画质越差
            return { qscale: Math.round(31 - (q / 100) * 28) };
        case 'libvpx':
            // VP8 CRF 0-63, 值越高画质越差
            return { crf: Math.round(63 - (q / 100) * 58) };
        default:
            return {};
    }
}

/**
 * 获取视频文件信息（通过 ffprobe）
 */
async function getVideoInfo(filePath) {
    const stat = fs.statSync(filePath);
    const name = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();

    return new Promise((resolve, reject) => {
        FfmpegCommand.ffprobe(filePath, (err, metadata) => {
            if (err) {
                reject(new Error('无法读取视频信息，文件可能已损坏'));
                return;
            }

            const videoStream = metadata.streams && metadata.streams.find(s => s.codec_type === 'video');
            const audioStream = metadata.streams && metadata.streams.find(s => s.codec_type === 'audio');
            const formatInfo = metadata.format || {};

            resolve({
                path: filePath,
                name,
                ext,
                format: ext.slice(1),
                size: stat.size,
                duration: formatInfo.duration ? parseFloat(formatInfo.duration) : 0,
                width: videoStream ? (videoStream.width || 0) : 0,
                height: videoStream ? (videoStream.height || 0) : 0,
                codec: videoStream ? videoStream.codec_name : '',
                bitrate: videoStream ? (videoStream.bit_rate ? parseInt(videoStream.bit_rate) : 0) : 0,
                fps: videoStream ? evalFps(videoStream) : 0,
                hasAudio: !!audioStream,
                audioCodec: audioStream ? audioStream.codec_name : ''
            });
        });
    });
}

function evalFps(stream) {
    const r = stream.avg_frame_rate || stream.r_frame_rate;
    if (!r) return 0;
    const parts = r.split('/');
    if (parts.length !== 2) return 0;
    const num = parseFloat(parts[0]);
    const den = parseFloat(parts[1]);
    return den > 0 ? Math.round(num / den) : 0;
}

/**
 * 构建输出文件路径
 */
function buildOutputPath(inputPath, targetFormat, outputDir) {
    const parsed = path.parse(inputPath);
    const outputFileName = parsed.name + targetFormat;
    const dir = outputDir || parsed.dir;

    let outputPath = path.join(dir, outputFileName);
    let counter = 1;
    while (fs.existsSync(outputPath)) {
        outputPath = path.join(dir, `${parsed.name}_${counter}${targetFormat}`);
        counter++;
    }

    return outputPath;
}

/**
 * 查找目标格式定义
 */
function findFormat(targetExt) {
    return VIDEO_FORMATS.find(f => f.ext === targetExt);
}

/**
 * 视频转 GIF（两遍 palette 优化）
 */
async function convertToGif(inputPath, outputPath) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fmt-gif-'));
    const palettePath = path.join(tmpDir, 'palette.png');

    try {
        // 第一遍：生成调色板
        await new Promise((resolve, reject) => {
            const args = [
                '-i', inputPath,
                '-vf', "fps=15,scale='min(600,iw)':'min(600,ih)':flags=lanczos,palettegen=stats_mode=diff",
                '-y', palettePath
            ];
            const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
            let stderr = '';
            proc.stderr.on('data', (d) => { stderr += d.toString(); });
            proc.on('close', (code) => {
                code === 0 ? resolve() : reject(new Error(`调色板生成失败: ${stderr.slice(-200)}`));
            });
            proc.on('error', reject);
        });

        // 第二遍：使用调色板生成 GIF
        await new Promise((resolve, reject) => {
            const args = [
                '-i', inputPath,
                '-i', palettePath,
                '-filter_complex', "[0:v]fps=15,scale='min(600,iw)':'min(600,ih)':flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5",
                '-y', outputPath
            ];
            const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
            let stderr = '';
            proc.stderr.on('data', (d) => { stderr += d.toString(); });
            proc.on('close', (code) => {
                code === 0 ? resolve() : reject(new Error(`GIF 生成失败: ${stderr.slice(-200)}`));
            });
            proc.on('error', reject);
        });
    } finally {
        // 清理临时文件
        try { await fsp.unlink(palettePath); } catch {}
        try { await fsp.rmdir(tmpDir); } catch {}
    }
}

/**
 * 转换视频核心
 * @param {string} inputPath - 输入文件路径
 * @param {string} targetFormat - 目标格式扩展名 (如 '.mp4')
 * @param {object} options - 转换选项
 * @param {number} [options.quality] - 质量 (0-100)
 * @param {object} [options.resize] - 尺寸缩放 {width, height}
 * @param {boolean} [options.keepAspectRatio] - 保持宽高比
 * @param {string} [options.outputDir] - 输出目录
 */
async function convertVideo(inputPath, targetFormat, options = {}) {
    const { quality = 80, resize = null, keepAspectRatio = true, outputDir = null, scalePercent = null } = options;

    const ext = path.extname(inputPath).toLowerCase();
    const targetExt = targetFormat.startsWith('.') ? targetFormat.toLowerCase() : `.${targetFormat.toLowerCase()}`;

    // 验证目标格式
    const fmt = findFormat(targetExt);
    if (!fmt) {
        throw new Error(`不支持输出格式: ${targetExt}`);
    }

    // 构建输出路径
    const outputPath = buildOutputPath(inputPath, targetExt, outputDir);

    // 获取输入文件信息（失败不阻止转换，仅缺少元数据）
    let info = {};
    try {
        info = await getVideoInfo(inputPath);
    } catch {
        info = { size: 0, name: path.basename(inputPath), width: 0, height: 0, duration: 0, hasAudio: false, codec: '' };
    }
    const hasInfo = !!(info.width && info.height);

    // GIF 特殊处理：两遍 palette
    if (targetExt === '.gif') {
        await convertToGif(inputPath, outputPath);

        const outStat = await fsp.stat(outputPath);
        return {
            outputPath,
            outputName: path.basename(outputPath),
            outputSize: outStat.size,
            duration: info.duration,
            width: 0,
            height: 0,
            originalSize: info.size,
            originalName: info.name
        };
    }

    // 正常视频格式转换
    return new Promise((resolve, reject) => {
        const command = new FfmpegCommand(inputPath);

        // 设置输出容器格式
        command.outputFormat(fmt.container);

        // 设置视频编码器
        command.videoCodec(fmt.codec);

        // 设置质量参数
        if (fmt.lossy) {
            const codecParams = mapQuality(quality, fmt.codec);
            if (codecParams.crf !== undefined) {
                command.addOption('-crf', String(codecParams.crf));
            } else if (codecParams.qscale !== undefined) {
                command.addOption('-qscale:v', String(codecParams.qscale));
            }
        }

        // 尺寸缩放（百分比或精确尺寸）
        if (scalePercent && hasInfo) {
            const scaleW = Math.round(info.width * scalePercent / 100);
            const scaleH = Math.round(info.height * scalePercent / 100);
            command.videoFilter(`scale=${scaleW}:${scaleH}:flags=lanczos`);
        } else if (resize && (resize.width || resize.height)) {
            let filter = 'scale=';
            if (keepAspectRatio) {
                filter += `${resize.width || -1}:${resize.height || -1}`;
                filter += ':force_original_aspect_ratio=decrease';
            } else {
                filter += `${resize.width || -1}:${resize.height || -1}`;
            }
            command.videoFilter(filter);
        }

        // WebM VP8 需要额外的比特率参数
        if (fmt.codec === 'libvpx') {
            command.addOption('-b:v', '2M');
            command.addOption('-deadline', 'good');
            command.addOption('-cpu-used', '0');
        }

        // 自动编码音频（如果源有音频流）
        if (info.hasAudio) {
            if (fmt.ext === '.mp4' || fmt.ext === '.mkv' || fmt.ext === '.mov') {
                command.audioCodec('aac');
            } else if (fmt.ext === '.webm') {
                command.audioCodec('libvorbis');
            } else if (fmt.ext === '.flv') {
                command.audioCodec('aac');
            } else if (fmt.ext === '.wmv') {
                command.audioCodec('wmav2');
            } else if (fmt.ext === '.avi') {
                command.audioCodec('mp3');
            }
        } else if (!info.hasAudio && fmt.codec !== 'gif') {
            // 无音频流，不需要音频处理
        }

        command.on('start', (cmdLine) => {
            // console.log('FFmpeg command:', cmdLine);
        });

        command.on('end', async () => {
            try {
                const outStat = await fsp.stat(outputPath);
                let outInfo = {};
                try {
                    outInfo = await getVideoInfo(outputPath);
                } catch {}

                resolve({
                    outputPath,
                    outputName: path.basename(outputPath),
                    outputSize: outStat.size,
                    duration: info.duration,
                    width: info.width,
                    height: info.height,
                    originalSize: info.size,
                    originalName: info.name
                });
            } catch (err) {
                reject(new Error(`输出文件读取失败: ${err.message}`));
            }
        });

        command.on('error', (err, stdout, stderr) => {
            reject(new Error(`转换失败: ${err.message}`));
        });

        command.save(outputPath);
    });
}

module.exports = {
    convertVideo,
    getVideoInfo,
    VIDEO_FORMATS,
    ALL_VIDEO_EXTS,
    findFormat
};
