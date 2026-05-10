/**
 * KGG 解密模块
 *
 * KGG 是酷狗音乐的加密音频格式（KGM v5）。
 * 解密流程：
 * 1. 逐页解密 KGMusicV3.db（SEE: AES-128-CBC）获取密钥映射表
 * 2. 从 KGG 文件头读取音频哈希，到映射表查找对应密钥（ekey）
 * 3. 解密 ekey（Base64 + TEA CBC）得到 QMC2 密钥
 * 4. 使用 QMC2 算法（MAP 或 RC4）解密音频数据
 * 5. 检测解密后的音频格式
 *
 * 参考实现: https://github.com/DHJComical/kgg-dec-mirror
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const initSqlJs = require('sql.js');

// ==================== 常量 ====================

// KGMusicV3.db 的 SEE 解密密钥 (16字节)
// kgg-dec 源码中 KugouDb::Open 传参: "7777B48756BA491BB4CEE771A3E2727E"
const KG_DB_KEY = Buffer.from('7777B48756BA491BB4CEE771A3E2727E', 'hex');

const KG_PAGE_SIZE = 1024;

// KGG 文件头魔数
const KGG_MAGIC = Buffer.from([0x7C, 0xD5, 0x32, 0xEB, 0x86, 0x02, 0x7F, 0x4B,
                               0xA8, 0xAF, 0xA6, 0x8E, 0x0F, 0xFF, 0x99, 0x14]);

// TEA 常量
const TEA_ROUNDS = 16;
const TEA_DELTA = 0x9E3779B9;
const TEA_SUM = (TEA_ROUNDS * TEA_DELTA) >>> 0;

// EKey V2 前缀 (Base64 of "QQMusic EncV2,Key:")
const EKEY_V2_PREFIX = 'UUFNus1cIEunVjI2LEV5ZTo=';

// EKey V2 密钥
const EKEY_V2_KEY1 = Buffer.from([0x33, 0x38, 0x36, 0x5A, 0x4A, 0x59, 0x21, 0x40,
                                   0x23, 0x2A, 0x24, 0x25, 0x5E, 0x26, 0x29, 0x28]);
const EKEY_V2_KEY2 = Buffer.from([0x2A, 0x2A, 0x23, 0x21, 0x28, 0x23, 0x24, 0x25,
                                   0x26, 0x5E, 0x61, 0x31, 0x63, 0x5A, 0x2C, 0x54]);

// QMC2 常量
const kMapKeySize = 128;
const kFirstSegmentSize = 0x0080;
const kOtherSegmentSize = 0x1400;
const kRC4StreamSize = kOtherSegmentSize + 512;

// ==================== SEE 数据库解密 ====================

/**
 * 解密 SEE 加密的 SQLite 数据库
 * SEE 使用 AES-128-CBC 逐页加密，IV = page_number (4字节大端) + 12字节零
 */
function decryptSeeDatabase(encryptedPath) {
    const encryptedData = fs.readFileSync(encryptedPath);
    const numPages = Math.floor(encryptedData.length / KG_PAGE_SIZE);

    const decryptedPages = [];
    for (let page = 0; page < numPages; page++) {
        const offset = page * KG_PAGE_SIZE;
        const encryptedPage = encryptedData.slice(offset, offset + KG_PAGE_SIZE);

        // SEE IV: 4字节大端页码 + 12字节零
        const iv = Buffer.alloc(16, 0);
        iv.writeUInt32BE(page, 0);

        const decipher = crypto.createDecipheriv('aes-128-cbc', KG_DB_KEY, iv);
        decipher.setAutoPadding(false);
        const decryptedPage = Buffer.concat([decipher.update(encryptedPage), decipher.final()]);
        decryptedPages.push(decryptedPage);
    }

    return Buffer.concat(decryptedPages);
}

/**
 * 从解密后的数据库加载密钥映射
 */
async function loadEKeyDB() {
    // KGMusicV3.db 路径
    const appDataDir = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const dbPath = path.join(appDataDir, 'Kugou8', 'KGMusicV3.db');

    if (!fs.existsSync(dbPath)) {
        throw new Error(`KGMusicV3.db 未找到: ${dbPath}\n请确保已安装酷狗音乐并播放过 KGG 文件。`);
    }

    // 解密数据库
    const decryptedDb = decryptSeeDatabase(dbPath);

    // 用 sql.js 加载解密后的数据库
    const SQL = await initSqlJs();
    const db = new SQL.Database(new Uint8Array(decryptedDb));

    // 查询密钥映射: EncryptionKeyId(音频哈希) → EncryptionKey(Base64 ekey)
    const stmt = db.prepare(
        'SELECT EncryptionKeyId, EncryptionKey FROM ShareFileItems WHERE EncryptionKey != \'\''
    );
    const ekeyDB = new Map();
    while (stmt.step()) {
        const row = stmt.getAsObject();
        ekeyDB.set(row.EncryptionKeyId, row.EncryptionKey);
    }
    stmt.free();
    db.close();

    return ekeyDB;
}

// ==================== Base64 工具 ====================

const BASE64_TABLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_REVERSE = (() => {
    const table = new Uint8Array(256);
    for (let i = 0; i < 64; i++) {
        table[BASE64_TABLE.charCodeAt(i)] = i;
    }
    table['-'.charCodeAt(0)] = 62; // URL-safe variant
    table['_'.charCodeAt(0)] = 63;
    return table;
})();

/**
 * Base64 解码
 */
function b64Decode(input) {
    const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, 'ascii');
    const len = buf.length;
    const output = Buffer.alloc(Math.ceil(len / 4) * 3);
    let outPos = 0;

    const decodeBlock = (p) => {
        const a = BASE64_REVERSE[buf[p]];
        const b = BASE64_REVERSE[buf[p + 1]];
        const c = BASE64_REVERSE[buf[p + 2]];
        const d = BASE64_REVERSE[buf[p + 3]];

        output[outPos++] = (a << 2) | (b >> 4);
        output[outPos++] = (b << 4) | (c >> 2);
        output[outPos++] = (c << 6) | d;

        if (buf[p + 2] === 0x3D /* '=' */) {
            outPos -= 2;
            return true;
        }
        if (buf[p + 3] === 0x3D /* '=' */) {
            outPos -= 1;
            return true;
        }
        return false;
    };

    for (let p = 0; p <= len - 4; p += 4) {
        if (decodeBlock(p)) break;
    }

    const remaining = len % 4;
    if (remaining > 0) {
        const padded = Buffer.alloc(4, 0x3D /* '=' */);
        buf.copy(padded, 0, len - remaining, len);
        decodeBlock(0);
    }

    return output.slice(0, outPos);
}

// ==================== TEA CBC 实现 ====================

/**
 * TEA ECB 单块解密
 */
function teaEcbDecrypt(value, key) {
    let y = (value >>> 32) >>> 0;
    let z = (value & 0xFFFFFFFF) >>> 0;
    let sum = TEA_SUM;

    for (let i = 0; i < TEA_ROUNDS; i++) {
        // z -= ((y << 4) + key[2]) ^ (y + sum) ^ ((y >>> 5) + key[3])
        const yShift4 = ((y << 4) + key[2]) >>> 0;
        const yPlusSum = (y + sum) >>> 0;
        const yShift5 = ((y >>> 5) + key[3]) >>> 0;
        z = ((z - (yShift4 ^ yPlusSum ^ yShift5)) & 0xFFFFFFFF) >>> 0;

        // y -= ((z << 4) + key[0]) ^ (z + sum) ^ ((z >>> 5) + key[1])
        const zShift4 = ((z << 4) + key[0]) >>> 0;
        const zPlusSum = (z + sum) >>> 0;
        const zShift5 = ((z >>> 5) + key[1]) >>> 0;
        y = ((y - (zShift4 ^ zPlusSum ^ zShift5)) & 0xFFFFFFFF) >>> 0;

        sum = ((sum - TEA_DELTA) & 0xFFFFFFFF) >>> 0;
    }

    return (BigInt(y) << 32n) | BigInt(z);
}

/**
 * TEA CBC 解密（匹配 kgg-dec 实现）
 * 自定义 padding: 1字节header + salt + data + 7字节零填充
 */
function teaCbcDecrypt(cipher, keyU32) {
    const blockSize = 8;
    const fixedSaltLen = 2;
    const zeroPadLen = 7;

    if (cipher.length % blockSize !== 0 || cipher.length < blockSize * 2) {
        return Buffer.alloc(0);
    }

    let iv1 = 0n;
    let iv2 = 0n;

    // 解密前两个块
    const decryptRound = (pCipher) => {
        const cipherVal = pCipher.readBigUInt64BE(0);
        const iv2Next = teaEcbDecrypt(cipherVal ^ iv2, keyU32);
        const plain = iv2Next ^ iv1;
        iv1 = cipherVal;
        iv2 = iv2Next;
        return plain;
    };

    const header = Buffer.alloc(16);
    let inPos = 0;

    header.writeBigUInt64BE(decryptRound(cipher.slice(inPos)), inPos);
    inPos += 8;
    header.writeBigUInt64BE(decryptRound(cipher.slice(inPos)), inPos);
    inPos += 8;

    const hdrSkipLen = 1 + (header[0] & 7) + fixedSaltLen;
    const realPlainLen = cipher.length - hdrSkipLen - zeroPadLen;

    if (realPlainLen <= 0) {
        return Buffer.alloc(0);
    }

    const result = Buffer.alloc(realPlainLen);
    let outPos = 0;

    // 从 header 复制第一部分明文
    const copyLen = Math.min(16 - hdrSkipLen, realPlainLen);
    header.copy(result, 0, hdrSkipLen, hdrSkipLen + copyLen);
    outPos += copyLen;

    if (realPlainLen !== copyLen) {
        // 解密中间块
        const midLen = cipher.length - blockSize * 3;
        for (let i = 0; i < midLen; i += blockSize) {
            result.writeBigUInt64BE(decryptRound(cipher.slice(inPos)), outPos);
            inPos += blockSize;
            outPos += 8;
        }

        // 解密最后一个块，只取第一个字节
        const lastPlain = decryptRound(cipher.slice(inPos));
        result[outPos] = Number(lastPlain >> 56n);
        outPos += 1;
    }

    // 验证零填充
    const verifyBlock = Buffer.alloc(8);
    verifyBlock.writeBigUInt64BE(iv2);
    if (verifyBlock[0] !== 0 || bufferIsAllZeros(verifyBlock)) {
        // zero padding 验证失败，可能数据无效
    }

    return result;
}

function bufferIsAllZeros(buf) {
    for (let i = 0; i < buf.length; i++) {
        if (buf[i] !== 0) return false;
    }
    return true;
}

// ==================== EKey 解密 ====================

function removeTrailingZeros(buf) {
    let end = buf.length;
    while (end > 0 && buf[end - 1] === 0) {
        end--;
    }
    return buf.slice(0, end);
}

/**
 * 解密 EKey V1
 */
function decryptEKeyV1(ekeyStr) {
    const decoded = b64Decode(ekeyStr);
    const cleaned = removeTrailingZeros(decoded);

    if (cleaned.length < 8) {
        return Buffer.alloc(0);
    }

    // TEA 密钥从明文前8字节构造
    // key[0] = 0x69005600 | (data[0] << 16) | data[1]
    const teaKey = new Uint32Array(4);
    teaKey[0] = (0x69005600 | (cleaned[0] << 16) | cleaned[1]) >>> 0;
    teaKey[1] = (0x46003800 | (cleaned[2] << 16) | cleaned[3]) >>> 0;
    teaKey[2] = (0x2B002000 | (cleaned[4] << 16) | cleaned[5]) >>> 0;
    teaKey[3] = (0x15000B00 | (cleaned[6] << 16) | cleaned[7]) >>> 0;

    // TEA CBC 解密剩余数据
    const encrypted = cleaned.slice(8);
    const decrypted = teaCbcDecrypt(encrypted, teaKey);

    // 组合: 前8字节(TEA密钥部分) + 解密后的数据
    const result = Buffer.alloc(8 + decrypted.length);
    cleaned.copy(result, 0, 0, 8);
    decrypted.copy(result, 8);

    return result;
}

/**
 * 解密 EKey V2: 额外两层 TEA CBC → V1
 */
function decryptEKeyV2(ekeyStr) {
    // 移除 V2 前缀
    const payload = ekeyStr.slice(EKEY_V2_PREFIX.length);
    const payloadBuf = Buffer.from(payload, 'ascii');

    // 第一层 TEA CBC
    const key1U32 = new Uint32Array(4);
    for (let i = 0; i < 4; i++) {
        key1U32[i] = EKEY_V2_KEY1.readUInt32BE(i * 4);
    }
    const step1 = teaCbcDecrypt(payloadBuf, key1U32);

    // 第二层 TEA CBC
    const key2U32 = new Uint32Array(4);
    for (let i = 0; i < 4; i++) {
        key2U32[i] = EKEY_V2_KEY2.readUInt32BE(i * 4);
    }
    const step2 = teaCbcDecrypt(step1, key2U32);

    // 结果作为 V1 输入
    return decryptEKeyV1(step2.toString('ascii'));
}

/**
 * 解密 EKey，返回 QMC2 密钥
 */
function decryptEKey(ekeyStr) {
    if (ekeyStr.startsWith(EKEY_V2_PREFIX)) {
        return decryptEKeyV2(ekeyStr);
    }
    return decryptEKeyV1(ekeyStr);
}

// ==================== QMC2 算法 ====================

/**
 * QMC2 MAP 解密器（短密钥 < 300 字节）
 */
class QMC2_MAP {
    constructor(key) {
        this.key = Buffer.alloc(128, 0);
        // 取前128字节作为映射表
        const keyLen = Math.min(key.length, 128);
        for (let i = 0; i < keyLen; i++) {
            this.key[i] = key[i];
        }
    }

    decrypt(data, offset) {
        for (let i = 0; i < data.length; i++) {
            const idx = (i + offset + 71214) % 128;
            data[i] ^= this.key[idx];
        }
    }
}

/**
 * QMC2 RC4 解密器（长密钥 >= 300 字节）
 */
class QMC2_RC4 {
    constructor(key) {
        this.key = Buffer.from(key);
        this.hash = this._calcHash(key);
        this.keyStream = this._deriveKeyStream(key);
    }

    _calcHash(key) {
        let hash = 1;
        for (let i = 0; i < key.length; i++) {
            if (key[i] === 0) continue;
            const nextHash = hash * key[i];
            if (nextHash <= hash || nextHash > 0xFFFFFFFF) break;
            hash = nextHash;
        }
        return hash;
    }

    _getSegmentKey(segmentId, seed) {
        if (seed === 0) return 0;
        const result = this.hash / (seed * (segmentId + 1)) * 100.0;
        return Math.floor(result);
    }

    _deriveKeyStream(key) {
        const n = key.length;
        const state = new Uint8Array(n);
        for (let i = 0; i < n; i++) state[i] = i;

        for (let i = 0, j = 0; i < n; i++) {
            j = (j + state[i] + key[i]) % n;
            [state[i], state[j]] = [state[j], state[i]];
        }

        const stream = Buffer.alloc(kRC4StreamSize);
        let i2 = 0, j2 = 0;
        for (let idx = 0; idx < kRC4StreamSize; idx++) {
            i2 = (i2 + 1) % n;
            j2 = (j2 + state[i2]) % n;
            [state[i2], state[j2]] = [state[j2], state[i2]];
            const finalIdx = (state[i2] + state[j2]) % n;
            stream[idx] = state[finalIdx];
        }

        return stream;
    }

    decrypt(data, offset) {
        const key = this.key;
        const n = key.length;
        let pos = offset;

        let i = 0;
        // 第一段 (0x80 字节)
        if (pos < kFirstSegmentSize) {
            const processLen = Math.min(data.length, kFirstSegmentSize - pos);
            for (let j = 0; j < processLen; j++) {
                const idx = this._getSegmentKey(pos / kOtherSegmentSize, key[pos % n]) % n;
                data[i++] ^= key[idx];
                pos++;
            }
        }

        // 后续段
        while (i < data.length) {
            const segmentIdx = Math.floor(pos / kOtherSegmentSize);
            const segmentOffset = pos % kOtherSegmentSize;
            const skipLen = this._getSegmentKey(segmentIdx, key[segmentIdx % n]) & 0x1FF;
            const processLen = Math.min(data.length - i, kOtherSegmentSize - segmentOffset);

            for (let j = 0; j < processLen; j++) {
                data[i++] ^= this.keyStream[skipLen + segmentOffset + j];
            }
            pos += processLen;
        }
    }
}

/**
 * 根据 ekey 创建 QMC2 解密器
 */
function createQMC2Decryptor(ekeyStr) {
    const key = decryptEKey(ekeyStr);
    if (key.length === 0) return null;

    if (key.length < 300) {
        return new QMC2_MAP(key);
    } else {
        return new QMC2_RC4(key);
    }
}

// ==================== 音频格式检测 ====================

function detectAudioFormat(magicBuf) {
    const magic = magicBuf.slice(0, 4).toString('ascii');
    if (magic === 'fLaC') return 'flac';
    if (magic === 'OggS') return 'ogg';
    return 'mp3';
}

// ==================== 主解密函数 ====================

/**
 * 解密一个 KGG 文件
 * @param {string} inputPath - KGG 文件路径
 * @param {string} outputDir - 输出目录
 * @param {Map} ekeyDB - 密钥映射表（可选，不传则自动加载）
 * @returns {Promise<string>} 解密后的文件路径
 */
async function decryptKgg(inputPath, outputDir, ekeyDB) {
    if (!fs.existsSync(inputPath)) {
        throw new Error(`文件不存在: ${inputPath}`);
    }

    // 1. 读取 KGG 文件头
    const fd = fs.openSync(inputPath, 'r');
    const header = Buffer.alloc(0x100);
    fs.readSync(fd, header, 0, 0x100, 0);

    // 验证魔数
    if (!header.slice(0, 16).equals(KGG_MAGIC)) {
        fs.closeSync(fd);
        throw new Error('无效的 KGG 文件头');
    }

    // 解析文件头
    const offsetToAudio = header.readUInt32LE(0x10);
    const encryptMode = header.readUInt32LE(0x14);
    const audioHashLen = header.readUInt32LE(0x44);

    if (encryptMode !== 5) {
        fs.closeSync(fd);
        throw new Error(`不支持的加密版本: ${encryptMode} (期望 5)`);
    }

    if (audioHashLen !== 0x20) {
        fs.closeSync(fd);
        throw new Error(`音频哈希长度无效: ${audioHashLen} (期望 32)`);
    }

    const audioHash = header.toString('ascii', 0x48, 0x48 + audioHashLen);

    // 2. 获取密钥映射表
    if (!ekeyDB) {
        ekeyDB = await loadEKeyDB();
    }

    const ekey = ekeyDB.get(audioHash);
    if (!ekey) {
        fs.closeSync(fd);
        throw new Error(
            `未找到音频哈希 ${audioHash} 对应的密钥\n` +
            '请确保已用酷狗音乐播放过该文件。'
        );
    }

    // 3. 创建 QMC2 解密器
    const qmc2 = createQMC2Decryptor(ekey);
    if (!qmc2) {
        fs.closeSync(fd);
        throw new Error('EKey 解密失败');
    }

    // 4. 检测音频格式
    const magicBuf = Buffer.alloc(4);
    fs.readSync(fd, magicBuf, 0, 4, offsetToAudio);
    qmc2.decrypt(magicBuf, 0);
    const ext = detectAudioFormat(magicBuf);

    // 5. 解密音频数据
    const baseName = path.basename(inputPath, path.extname(inputPath));
    const outputPath = path.join(outputDir, `${baseName}.${ext}`);

    if (fs.existsSync(outputPath)) {
        fs.closeSync(fd);
        throw new Error(`输出文件已存在: ${outputPath}`);
    }

    const wfd = fs.openSync(outputPath, 'w');
    const bufSize = 1024 * 1024; // 1MB buffer
    const readBuf = Buffer.alloc(bufSize);
    let audioOffset = 0;

    try {
        while (true) {
            const bytesRead = fs.readSync(fd, readBuf, 0, bufSize, null);
            if (bytesRead <= 0) break;

            const data = readBuf.slice(0, bytesRead);
            qmc2.decrypt(data, audioOffset);
            fs.writeSync(wfd, data, 0, bytesRead);
            audioOffset += bytesRead;
        }
    } finally {
        fs.closeSync(fd);
        fs.closeSync(wfd);
    }

    return outputPath;
}

/**
 * 返回是否支持 KGG（检查数据库是否存在）
 */
function isKggSupported() {
    const appDataDir = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const dbPath = path.join(appDataDir, 'Kugou8', 'KGMusicV3.db');
    return fs.existsSync(dbPath);
}

module.exports = {
    decryptKgg,
    loadEKeyDB,
    decryptEKey,
    createQMC2Decryptor,
    isKggSupported,
    QMC2_MAP,
    QMC2_RC4
};
