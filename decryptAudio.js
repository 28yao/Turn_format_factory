const path = require('path');
const fs = require('fs');
const os = require('os');

const DECRYPTION_BUF_SIZE = 2 * 1024 * 1024;

/**
 * 检测文件是否为加密格式
 */
function isEncryptedFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.kgm' || ext === '.kgma') return { encrypted: true, type: 'kgm' };
    if (ext === '.ncm') return { encrypted: true, type: 'ncm' };
    return { encrypted: false };
}

/**
 * 获取临时工作目录
 */
function getTempDir() {
    const tmpRoot = path.join(os.tmpdir(), 'format-factory-decrypt');
    if (!fs.existsSync(tmpRoot)) {
        fs.mkdirSync(tmpRoot, { recursive: true });
    }
    return fs.mkdtempSync(path.join(tmpRoot, 'tmp-'));
}

/**
 * 解密 KGM 文件
 * @param {string} inputPath - KGM 文件路径
 * @param {string} outputDir - 输出目录
 * @returns {Promise<string>} 解密后的文件路径
 */
async function decryptKgm(inputPath, outputDir) {
    const KgmCryptoModule = require('@xhacker/kgmwasm');
    const KgmCryptoObj = await KgmCryptoModule();

    const kgmBuf = new Uint8Array(fs.readFileSync(inputPath));
    const ext = path.extname(inputPath).toLowerCase(); // .kgm or .kgma

    // 申请 WASM 内存
    const pKgmBuf = KgmCryptoObj._malloc(DECRYPTION_BUF_SIZE);

    try {
        // 写入初始数据到 WASM 堆（包含文件头）
        const preDecDataSize = Math.min(DECRYPTION_BUF_SIZE, kgmBuf.byteLength);
        KgmCryptoObj.writeArrayToMemory(kgmBuf.slice(0, preDecDataSize), pKgmBuf);

        // 初始化解密，返回头部大小
        const headerSize = KgmCryptoObj.preDec(pKgmBuf, preDecDataSize, ext);

        // 跳过头部数据
        const audioData = kgmBuf.slice(headerSize);
        const decryptedParts = [];
        let offset = 0;
        let bytesToDecrypt = audioData.length;

        while (bytesToDecrypt > 0) {
            const blockSize = Math.min(bytesToDecrypt, DECRYPTION_BUF_SIZE);
            const blockData = audioData.slice(offset, offset + blockSize);
            KgmCryptoObj.writeArrayToMemory(blockData, pKgmBuf);
            KgmCryptoObj.decBlob(pKgmBuf, blockSize, offset);
            decryptedParts.push(KgmCryptoObj.HEAPU8.slice(pKgmBuf, pKgmBuf + blockSize));
            offset += blockSize;
            bytesToDecrypt -= blockSize;
        }

        // 合并所有解密后的数据块
        const totalLength = decryptedParts.reduce((sum, part) => sum + part.length, 0);
        const result = new Uint8Array(totalLength);
        let pos = 0;
        for (const part of decryptedParts) {
            result.set(part, pos);
            pos += part.length;
        }

        // 检测解密后的文件格式
        const detectedExt = detectAudioFormat(result);

        // 写入输出文件
        const baseName = path.basename(inputPath, ext);
        const outputPath = path.join(outputDir, baseName + detectedExt);
        fs.writeFileSync(outputPath, result);

        return outputPath;
    } finally {
        KgmCryptoObj._free(pKgmBuf);
    }
}

/**
 * 解密 NCM 文件
 * @param {string} inputPath - NCM 文件路径
 * @param {string} outputDir - 输出目录
 * @returns {Promise<string>} 解密后的文件路径
 */
async function decryptNcm(inputPath, outputDir) {
    const { NcmConvertor } = require('@lengineerc/ncm-convertor');

    const convertor = new NcmConvertor(inputPath, outputDir);
    const success = await convertor.dump();
    if (!success) {
        throw new Error('NCM 文件解密失败');
    }

    // 查找解密后的输出文件（NcmConvertor 自动命名: "artist - title.format"）
    const files = fs.readdirSync(outputDir);
    // 找出最新创建的音频文件（排除临时/图片文件）
    const audioFiles = files.filter(f => {
        const e = path.extname(f).toLowerCase();
        return ['.mp3', '.flac', '.wav', '.ape'].includes(e);
    });

    if (audioFiles.length === 0) {
        throw new Error('未找到解密后的音频文件');
    }

    // 返回最新修改的文件
    const sorted = audioFiles
        .map(f => ({ name: f, mtime: fs.statSync(path.join(outputDir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);

    return path.join(outputDir, sorted[0].name);
}

/**
 * 通过魔数检测音频格式
 */
function detectAudioFormat(data) {
    if (data.length < 4) return '.mp3';

    // FLAC: fLaC
    if (data[0] === 0x66 && data[1] === 0x4C && data[2] === 0x61 && data[3] === 0x43) {
        return '.flac';
    }
    // OGG: OggS
    if (data[0] === 0x4F && data[1] === 0x67 && data[2] === 0x67 && data[3] === 0x53) {
        return '.ogg';
    }
    // MP4/M4A: ftyp (3g2a, isom, M4A, mp42)
    if (data[4] === 0x66 && data[5] === 0x74 && data[6] === 0x79 && data[7] === 0x70) {
        return '.m4a';
    }
    // WAV: RIFF
    if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46) {
        return '.wav';
    }
    // APE: MAC
    if (data[0] === 0x4D && data[1] === 0x41 && data[2] === 0x43 && data[3] === 0x20) {
        return '.ape';
    }

    // 默认 MP3（ID3 头或以 0xFF 开头的 MPEG 帧）
    return '.mp3';
}

/**
 * 解密加密音频文件
 * @param {string} inputPath - 输入文件路径
 * @param {string} outputDir - 输出目录
 * @returns {Promise<string>} 解密后的标准音频文件路径
 */
async function decryptAudio(inputPath, outputDir) {
    const check = isEncryptedFile(inputPath);
    if (!check.encrypted) {
        return inputPath; // 不是加密文件，直接返回原路径
    }

    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    if (check.type === 'kgm') {
        return await decryptKgm(inputPath, outputDir);
    } else if (check.type === 'ncm') {
        return await decryptNcm(inputPath, outputDir);
    }

    return inputPath;
}

module.exports = {
    decryptAudio,
    isEncryptedFile,
    decryptKgm,
    decryptNcm
};
