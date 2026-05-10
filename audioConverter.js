const path = require('path');
const fs = require('fs');
const { promises: fsp } = require('fs');
const FfmpegCommand = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffprobePath = require('path').join(require('path').dirname(ffmpegPath), 'ffprobe.exe');
const { decryptAudio, isEncryptedFile } = require('./decryptAudio');

// 设置 FFmpeg 路径
FfmpegCommand.setFfmpegPath(ffmpegPath);
FfmpegCommand.setFfprobePath(ffprobePath);

// 支持的音频格式定义
const AUDIO_FORMATS = [
    { label: 'MP3 (.mp3)', ext: '.mp3', container: 'mp3', codec: 'libmp3lame', lossy: true, defaultBitrate: '192k', bitrateRange: { min: 32, max: 320 } },
    { label: 'WAV (.wav)', ext: '.wav', container: 'wav', codec: 'pcm_s16le', lossy: false },
    { label: 'FLAC (.flac)', ext: '.flac', container: 'flac', codec: 'flac', lossy: false },
    { label: 'AAC (.aac)', ext: '.aac', container: 'adts', codec: 'aac', lossy: true, defaultBitrate: '192k', bitrateRange: { min: 32, max: 320 } },
    { label: 'OGG (.ogg)', ext: '.ogg', container: 'ogg', codec: 'libvorbis', lossy: true, defaultBitrate: '192k', bitrateRange: { min: 32, max: 320 } },
    { label: 'M4A (.m4a)', ext: '.m4a', container: 'mp4', codec: 'aac', lossy: true, defaultBitrate: '192k', bitrateRange: { min: 32, max: 320 } },
    { label: 'Opus (.opus)', ext: '.opus', container: 'opus', codec: 'libopus', lossy: true, defaultBitrate: '128k', bitrateRange: { min: 6, max: 510 } },
    { label: 'WMA (.wma)', ext: '.wma', container: 'asf', codec: 'wmav2', lossy: true, defaultBitrate: '192k', bitrateRange: { min: 32, max: 320 } }
];

const LOSSY_AUDIO_FORMATS = ['.mp3', '.aac', '.ogg', '.m4a', '.opus', '.wma'];
const ALL_AUDIO_EXTS = ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.opus', '.wma', '.kgm', '.kgma', '.ncm'];
const ENCRYPTED_AUDIO_EXTS = ['.kgm', '.kgma', '.ncm'];

/**
 * 获取音频文件信息（通过 ffprobe）
 */
async function getAudioInfo(filePath) {
    const stat = fs.statSync(filePath);
    const name = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();

    // 加密格式（KGM/NCM）ffprobe 无法解析，直接返回基本信息
    if (ENCRYPTED_AUDIO_EXTS.includes(ext)) {
        return {
            path: filePath,
            name,
            ext,
            size: stat.size,
            format: ext.slice(1).toUpperCase(),
            encrypted: true,
            encryptedType: ext === '.ncm' ? 'NCM (网易云加密)' : 'KGM (酷狗加密)'
        };
    }

    return new Promise((resolve, reject) => {
        FfmpegCommand.ffprobe(filePath, (err, metadata) => {
            if (err) {
                // ffprobe 失败时返回基本信息
                resolve({
                    path: filePath,
                    name,
                    ext,
                    size: stat.size,
                    format: ext.slice(1),
                    error: '无法读取音频信息，文件可能已损坏'
                });
                return;
            }

            const stream = metadata.streams && metadata.streams.find(s => s.codec_type === 'audio');
            const formatInfo = metadata.format || {};

            resolve({
                path: filePath,
                name,
                ext,
                format: ext.slice(1),
                size: stat.size,
                duration: formatInfo.duration ? parseFloat(formatInfo.duration) : 0,
                bitrate: stream ? (stream.bit_rate ? parseInt(stream.bit_rate) : 0) : 0,
                sampleRate: stream ? (stream.sample_rate ? parseInt(stream.sample_rate) : 0) : 0,
                channels: stream ? (stream.channels || 0) : 0,
                codec: stream ? stream.codec_name : ''
            });
        });
    });
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
    return AUDIO_FORMATS.find(f => f.ext === targetExt);
}

/**
 * 转换音频核心
 * @param {string} inputPath - 输入文件路径
 * @param {string} targetFormat - 目标格式扩展名 (如 '.mp3')
 * @param {object} options - 转换选项
 * @param {string} [options.bitrate] - 音频码率 (如 '192k')
 * @param {string} [options.outputDir] - 输出目录
 */
async function convertAudio(inputPath, targetFormat, options = {}) {
    const { bitrate, outputDir = null } = options;

    const ext = path.extname(inputPath).toLowerCase();
    const targetExt = targetFormat.startsWith('.') ? targetFormat.toLowerCase() : `.${targetFormat.toLowerCase()}`;

    // 验证目标格式
    const fmt = findFormat(targetExt);
    if (!fmt) {
        throw new Error(`不支持输出格式: ${targetExt}`);
    }

    // 如果是加密格式，先解密
    let effectiveInputPath = inputPath;
    let tempDecryptDir = null;
    const encCheck = isEncryptedFile(inputPath);
    if (encCheck.encrypted) {
        // 确定输出目录
        const decryptDir = outputDir || path.dirname(inputPath);
        // 先解密到输出目录
        effectiveInputPath = await decryptAudio(inputPath, decryptDir);
        // 如果解密后的文件路径跟 inputPath 不同，且输出目录就是解密目录，记录以便清理
        if (effectiveInputPath !== inputPath) {
            tempDecryptDir = effectiveInputPath;
        }
    }

    // 构建输出路径
    const outputPath = buildOutputPath(effectiveInputPath, targetExt, outputDir);

    // 获取输入文件信息
    const info = await getAudioInfo(effectiveInputPath);

    return new Promise((resolve, reject) => {
        const command = new FfmpegCommand(effectiveInputPath);

        // 设置输出容器格式
        command.outputFormat(fmt.container);

        // 设置音频编码器
        command.audioCodec(fmt.codec);

        // 设置码率（仅对有损格式生效）
        if (fmt.lossy && bitrate) {
            command.audioBitrate(bitrate);
        }

        // 如果输入是 WAV 或其他无压缩格式，可以保留更高品质
        command.on('start', (cmdLine) => {
            // console.log('FFmpeg command:', cmdLine);
        });

        command.on('end', async () => {
            try {
                const outStat = await fsp.stat(outputPath);
                let outInfo = {};
                try {
                    outInfo = await getAudioInfo(outputPath);
                } catch { }
                resolve({
                    outputPath,
                    outputName: path.basename(outputPath),
                    outputSize: outStat.size,
                    duration: info.duration,
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
    convertAudio,
    getAudioInfo,
    AUDIO_FORMATS,
    LOSSY_AUDIO_FORMATS,
    ALL_AUDIO_EXTS,
    ENCRYPTED_AUDIO_EXTS,
    findFormat
};
