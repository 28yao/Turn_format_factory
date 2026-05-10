/**
 * KGG 解密模块
 *
 * KGG 是酷狗音乐的 KGM v5 加密音频格式。
 * 参考实现: https://github.com/DHJComical/kgg-dec-mirror
 * (commit 1259d3c 之前的 src/ 源码)
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

// ==================== 常量 ====================

const KGG_MAGIC = Buffer.from([0x7C, 0xD5, 0x32, 0xEB, 0x86, 0x02, 0x7F, 0x4B,
                               0xA8, 0xAF, 0xA6, 0x8E, 0x0F, 0xFF, 0x99, 0x14]);

// TEA 常量
const TEA_ROUNDS = 16;
const TEA_DELTA = 0x9E3779B9;
const TEA_SUM = (TEA_ROUNDS * TEA_DELTA) >>> 0;

// EKey V2 前缀 (Base64 of "QQMusic EncV2,Key:")
const EKEY_V2_PREFIX = 'UUFNus1cIEunVjI2LEV5ZTo=';

// EKey V2 密钥 (big-endian 16 字节)
const EKEY_V2_KEY1 = Buffer.from([0x33, 0x38, 0x36, 0x5A, 0x4A, 0x59, 0x21, 0x40,
                                   0x23, 0x2A, 0x24, 0x25, 0x5E, 0x26, 0x29, 0x28]);
const EKEY_V2_KEY2 = Buffer.from([0x2A, 0x2A, 0x23, 0x21, 0x28, 0x23, 0x24, 0x25,
                                   0x26, 0x5E, 0x61, 0x31, 0x63, 0x5A, 0x2C, 0x54]);

// QMC2 常量
const kMapIndexOffset = 71214;
const kMapKeySize = 128;
const kMapOffsetBoundary = 0x7FFF;
const kFirstSegmentSize = 0x0080;
const kOtherSegmentSize = 0x1400;
const kRC4StreamSize = kOtherSegmentSize + 512;

const kTeaBlockSize = 8;
const kFixedSaltLen = 2;
const kZeroPadLen = 7;

// ==================== 辅助函数 ====================

/** 大端 64-bit 读取 (返回 BigInt 避免精度丢失) */
function be_u64_read(buf, offset = 0) {
    return (BigInt(buf.readUInt32BE(offset)) << 32n) | BigInt(buf.readUInt32BE(offset + 4));
}

/** 大端 64-bit 写入 (接受 BigInt) */
function be_u64_write(buf, offset, value) {
    buf.writeUInt32BE(Number((value >> 32n) & 0xFFFFFFFFn), offset);
    buf.writeUInt32BE(Number(value & 0xFFFFFFFFn), offset + 4);
}

/** 大端 32-bit 读取 */
function be_u32_read(buf, offset = 0) {
    return buf.readUInt32BE(offset);
}

// ==================== TEA ECB ====================
// 参考: tea_ecb.h
// BIG ENDIAN 处理

function tc_tea_single_round(value, sum, key1, key2) {
    return (((value << 4) + key1) ^ (value + sum) ^ ((value >>> 5) + key2)) >>> 0;
}

/**
 * TEA ECB 解密 (BIG ENDIAN)
 * value: BigInt (大端 64-bit)
 * key: Uint32Array[4]
 */
function tc_tea_ecb_decrypt(value, key) {
    const y = Number((value >> 32n) & 0xFFFFFFFFn);
    const z = Number(value & 0xFFFFFFFFn);

    let v0 = y >>> 0;
    let v1 = z >>> 0;
    let sum = TEA_SUM;

    for (let i = 0; i < TEA_ROUNDS; i++) {
        v1 = (v1 - tc_tea_single_round(v0, sum, key[2], key[3])) >>> 0;
        v0 = (v0 - tc_tea_single_round(v1, sum, key[0], key[1])) >>> 0;
        sum = (sum - TEA_DELTA) >>> 0;
    }

    return (BigInt(v0) << 32n) | BigInt(v1);
}

// ==================== TEA CBC ====================
// 参考: tc_tea.cpp
// 双 IV 方案，大端读写，2-block header，特殊填充

function tc_tea_cbc_decrypt(cipher, keyU32) {
    if (cipher.length % kTeaBlockSize !== 0 || cipher.length < kTeaBlockSize * 2) {
        return Buffer.alloc(0);
    }

    // 解密 round 函数 (iv1, iv2 均为 BigInt)
    function decrypt_round(p_cipher, iv1, iv2) {
        const iv1_next = be_u64_read(p_cipher, 0);
        const iv2_next = tc_tea_ecb_decrypt(iv1_next ^ iv2, keyU32);
        const plain = iv2_next ^ iv1;
        return { iv1_next, iv2_next, plain };
    }

    let iv1 = 0n;
    let iv2 = 0n;

    // 前两个 block 为 header
    const header = Buffer.alloc(kTeaBlockSize * 2);
    let inOffset = 0;

    let r = decrypt_round(cipher.slice(inOffset, inOffset + kTeaBlockSize), iv1, iv2);
    iv1 = r.iv1_next;
    iv2 = r.iv2_next;
    be_u64_write(header, 0, r.plain);
    inOffset += kTeaBlockSize;

    r = decrypt_round(cipher.slice(inOffset, inOffset + kTeaBlockSize), iv1, iv2);
    iv1 = r.iv1_next;
    iv2 = r.iv2_next;
    be_u64_write(header, kTeaBlockSize, r.plain);
    inOffset += kTeaBlockSize;

    // 计算 header 跳过长度
    const hdr_skip_len = 1 + (header[0] & 7) + kFixedSaltLen;
    const real_plain_len = cipher.length - hdr_skip_len - kZeroPadLen;

    if (real_plain_len <= 0) {
        return Buffer.alloc(0);
    }

    const result = Buffer.alloc(real_plain_len);
    let outOffset = 0;

    // 复制 header 中的第一块明文
    const headerData = header.slice(hdr_skip_len);
    const copyLen = Math.min(headerData.length, real_plain_len);
    headerData.copy(result, 0, 0, copyLen);
    outOffset = copyLen;

    if (real_plain_len !== copyLen) {
        // 解密剩余的 blocks
        const remainingCipherLen = cipher.length - inOffset - kTeaBlockSize;
        if (remainingCipherLen > 0) {
            for (let ci = kTeaBlockSize; ci <= remainingCipherLen; ci += kTeaBlockSize) {
                const blockStart = inOffset;
                r = decrypt_round(cipher.slice(blockStart, blockStart + kTeaBlockSize), iv1, iv2);
                iv1 = r.iv1_next;
                iv2 = r.iv2_next;
                be_u64_write(result, outOffset, r.plain);
                outOffset += kTeaBlockSize;
                inOffset += kTeaBlockSize;
            }
        }

        // 解密最后一个 block 到 header[8:16]，只取第一字节
        r = decrypt_round(cipher.slice(inOffset, inOffset + kTeaBlockSize), iv1, iv2);
        be_u64_write(header, kTeaBlockSize, r.plain);
        result[outOffset] = header[kTeaBlockSize];
    }

    // 验证零填充 (最后7字节必须为零)
    const lastBlock = header.slice(kTeaBlockSize, kTeaBlockSize + kTeaBlockSize);
    const verify = (be_u64_read(lastBlock, 0) << 8n) & 0xFFFFFFFFFFFFFFFFn;
    if (verify !== 0n) {
        return Buffer.alloc(0);
    }

    return result;
}

// ==================== EKey 解密 ====================
// 参考: ekey.cpp

function remove_trailing_zeros(buf) {
    let len = buf.length;
    while (len > 0 && buf[len - 1] === 0) {
        len--;
    }
    return buf.slice(0, len);
}

/**
 * EKey V1 解密
 * key 公式（注意最后3个常量不同！）:
 *   key[0] = 0x69005600 | result[0]<<16 | result[1]
 *   key[1] = 0x46003800 | result[2]<<16 | result[3]
 *   key[2] = 0x2b002000 | result[4]<<16 | result[5]
 *   key[3] = 0x15000b00 | result[6]<<16 | result[7]
 */
function decrypt_ekey_v1(ekeyStr) {
    let result = Buffer.from(ekeyStr, 'base64');
    result = remove_trailing_zeros(result);

    // TEA 密钥派生
    const tea_key = new Uint32Array(4);
    tea_key[0] = (0x69005600 | (result[0] << 16) | result[1]) >>> 0;
    tea_key[1] = (0x46003800 | (result[2] << 16) | result[3]) >>> 0;
    tea_key[2] = (0x2b002000 | (result[4] << 16) | result[5]) >>> 0;
    tea_key[3] = (0x15000b00 | (result[6] << 16) | result[7]) >>> 0;

    // TEA CBC 解密（跳过前 8 字节密钥头）
    const cipherPart = result.slice(8);
    const decrypted = tc_tea_cbc_decrypt(cipherPart, tea_key);
    if (decrypted.length === 0) {
        return Buffer.alloc(0);
    }

    // 拼接：前8字节 + 解密后的数据
    const keyHead = result.slice(0, 8);
    return Buffer.concat([keyHead, decrypted]);
}

/**
 * EKey V2 解密
 * 双重 TEA CBC + V1 流程
 */
function decrypt_ekey_v2(ekeyStr) {
    const key1_u32 = new Uint32Array(4);
    const key2_u32 = new Uint32Array(4);
    for (let i = 0; i < 4; i++) {
        key1_u32[i] = be_u32_read(EKEY_V2_KEY1, i * 4);
        key2_u32[i] = be_u32_read(EKEY_V2_KEY2, i * 4);
    }

    const buf = Buffer.from(ekeyStr); // V2 payload 已经是 Base64 编码
    // 实际上 ekeyStr 在 V2 时已去除前缀，但它是 Base64 字符串
    // 需要先 Base64 解码，然后 TEA CBC
    let data = Buffer.from(ekeyStr, 'base64');
    let result = tc_tea_cbc_decrypt(data, key1_u32);
    result = tc_tea_cbc_decrypt(result, key2_u32);

    // 结果作为字符串传给 V1
    const resultStr = result.toString('utf-8').replace(/\0+$/, '');
    return decrypt_ekey_v1(resultStr);
}

/**
 * EKey 主入口
 */
function decrypt_ekey(ekeyStr) {
    if (ekeyStr.startsWith(EKEY_V2_PREFIX)) {
        const payload = ekeyStr.slice(EKEY_V2_PREFIX.length);
        return decrypt_ekey_v2(payload);
    }
    return decrypt_ekey_v1(ekeyStr);
}

// ==================== QMC2 MAP ====================
// 参考: qmc2_map.cpp
// key 初始化: j = (i*i + kMapIndexOffset) % n, 然后 (key[j] << ((j+4)%8)) | (key[j] >> ((j+4)%8))
// Decrypt: idx = (offset <= 0x7FFF) ? offset : (offset % 0x7FFF); xor with key_[idx % 128]

class QMC2_MAP {
    constructor(key) {
        this.key_ = new Uint8Array(kMapKeySize);
        const n = key.length;
        for (let i = 0; i < kMapKeySize; i++) {
            const j = (i * i + kMapIndexOffset) % n;
            const shift = (j + 4) % 8;
            this.key_[i] = ((key[j] << shift) | (key[j] >>> shift)) & 0xFF;
        }
    }

    decrypt(data) {
        for (let i = 0; i < data.length; i++) {
            const offset = i;
            const idx = (offset <= kMapOffsetBoundary) ? offset : (offset % kMapOffsetBoundary);
            data[i] ^= this.key_[idx % kMapKeySize];
        }
    }
}

// ==================== QMC2 RC4 ====================
// 参考: qmc2_rc4.cpp
// hash: 连续乘积 key[*key]，遇到 0 跳过，乘积溢出（≤前值）停止
// RC4 初始化: state = 0..n-1, j = (j + state[i] + key[i % key_len]) % key_len
// Derive: i=(i+1)%n, j=(j+s[i])%n, swap, it ^= s[(s[i]+s[j])%n]
// FirstSegment: idx = hash/(seed*(n+1))*100 % n, xor key[idx]
// OtherSegment: skip = hash/(seed*(n+1))*100 & 0x1FF, xor stream[skip + sub_offset]

class QMC2_RC4 {
    constructor(key) {
        this.key_ = Buffer.from(key);
        this.hash_ = this._hash(key);

        // 预计算 RC4 密钥流
        this.key_stream_ = Buffer.alloc(kRC4StreamSize);
        const rc4 = this._createRC4(key);
        rc4.derive(this.key_stream_);
    }

    _hash(key) {
        let hash = 1;
        for (const byte of key) {
            if (byte === 0) continue;
            // 使用 Math.imul 模拟 uint32_t 乘法（32位截断）
            const nextHash = Math.imul(hash, byte) >>> 0;
            if (nextHash <= (hash >>> 0)) break;
            hash = nextHash;
        }
        return hash;
    }

    _createRC4(key) {
        const n = key.length;
        const state = new Uint8Array(n);
        for (let i = 0; i < n; i++) state[i] = i;
        let j = 0;
        for (let i = 0; i < n; i++) {
            j = (j + state[i] + key[i % n]) % n;
            [state[i], state[j]] = [state[j], state[i]];
        }
        return {
            state,
            n,
            i: 0,
            j: 0,
            derive(buffer) {
                let si = this.i;
                let sj = this.j;
                const s = this.state;
                const nn = this.n;
                for (let idx = 0; idx < buffer.length; idx++) {
                    si = (si + 1) % nn;
                    sj = (sj + s[si]) % nn;
                    [s[si], s[sj]] = [s[sj], s[si]];
                    const finalIdx = (s[si] + s[sj]) % nn;
                    // NOTE: 修改为产生 XOR 流 (it ^= s[finalIdx])
                    buffer[idx] = s[finalIdx];
                }
                this.i = si;
                this.j = sj;
            }
        };
    }

    _get_segment_key(segmentId, seed) {
        if (seed === 0) return 0;
        const result = this.hash_ / (seed * (segmentId + 1)) * 100.0;
        return Math.floor(result);
    }

    decrypt(data) {
        let offset = 0;

        // First segment: get_segment_key 使用 byte offset 作为 segmentId (不是固定 0!)
        // 参考: qmc2_rc4.cpp DecryptFirstSegment
        if (offset < kFirstSegmentSize) {
            const n = Math.min(data.length, kFirstSegmentSize - offset);
            const firstKey = this.key_;
            const keyLen = firstKey.length;
            const hashVal = this.hash_;

            for (let i = 0; i < n; i++) {
                const seed = firstKey[offset % keyLen];
                const idx = (seed === 0) ? 0 : (this._get_segment_key(offset, seed) % keyLen);
                data[i] ^= firstKey[idx];
                offset++;
            }
        }

        // Other segments
        while (offset < data.length) {
            const segmentIdx = Math.floor(offset / kOtherSegmentSize);
            const segmentOffset = offset % kOtherSegmentSize;

            const seed = this.key_[segmentIdx % this.key_.length];
            const skipLen = (seed === 0) ? 0 : (this._get_segment_key(segmentIdx, seed) & 0x1FF);
            const processLen = Math.min(data.length - offset, kOtherSegmentSize - segmentOffset);
            const streamStart = skipLen + segmentOffset;

            for (let i = 0; i < processLen; i++) {
                data[offset + i] ^= this.key_stream_[streamStart + i];
            }
            offset += processLen;
        }
    }
}

// ==================== 数据库查询 ====================

/**
 * 通过 C# 辅助程序查询 KGMusicV3.db
 */
function fetchEKeyFromDB(encryptionKeyId) {
    return new Promise((resolve, reject) => {
        const helperExe = path.join(__dirname, 'kgg_key_fetcher.exe');

        if (!fs.existsSync(helperExe)) {
            reject(new Error(`KGG 数据库助手未找到: ${helperExe}`));
            return;
        }

        execFile(helperExe, [encryptionKeyId], { timeout: 15000 }, (err, stdout, stderr) => {
            if (err) {
                reject(new Error(`数据库查询失败: ${err.message}`));
                return;
            }
            try {
                const result = JSON.parse(stdout.trim());
                resolve(result);
            } catch (e) {
                reject(new Error(`解析数据库结果失败: ${e.message}`));
            }
        });
    });
}

// ==================== 工具函数 ====================

function detectAudioFormat(audioData) {
    if (audioData.length < 4) return 'mp3';
    if (audioData[0] === 0x66 && audioData[1] === 0x4C && audioData[2] === 0x61 && audioData[3] === 0x43) return 'flac';
    if (audioData[0] === 0x4F && audioData[1] === 0x67 && audioData[2] === 0x67 && audioData[3] === 0x53) return 'ogg';
    return 'mp3';
}

function isKggSupported() {
    const appDataDir = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const helperExe = path.join(__dirname, 'kgg_key_fetcher.exe');
    return fs.existsSync(helperExe);
}

// ==================== 主入口 ====================

async function decryptKgg(inputPath, outputDir) {
    if (!fs.existsSync(inputPath)) {
        throw new Error(`文件不存在: ${inputPath}`);
    }

    // 1. 读取 KGG 头部 (0x70 = 112 字节)
    const header = Buffer.alloc(0x70);
    const fd = fs.openSync(inputPath, 'r');
    fs.readSync(fd, header, 0, 0x70, 0);
    fs.closeSync(fd);

    // 验证魔数
    if (!header.slice(0, 16).equals(KGG_MAGIC)) {
        throw new Error('不是有效的 KGG 文件（魔数不匹配）');
    }

    const encryptMode = header.readUInt32LE(0x14);
    const audioOffset = header.readUInt32LE(0x10);

    if (encryptMode !== 5) {
        throw new Error(`不支持的加密模式: ${encryptMode}（仅支持 KGG v5）`);
    }

    // 2. 读取 EncryptionKeyId (KGG header offset 0x48)
    const hashLen = header.readUInt32LE(0x44);
    let encryptionKeyId = '';
    if (hashLen > 0) {
        const idBuf = header.slice(0x48, 0x48 + Math.min(hashLen, 32));
        encryptionKeyId = idBuf.toString('utf-8').replace(/\0/g, '').trim();
    }
    if (!encryptionKeyId || encryptionKeyId.length < 8) {
        // 兜底：尝试 32 字节原始读
        const idBuf = header.slice(0x48, 0x48 + 32);
        encryptionKeyId = idBuf.toString('utf-8').replace(/\0/g, '').trim();
    }

    // 3. 通过 C# 助手查询数据库获取 EncryptionKey
    const dbResult = await fetchEKeyFromDB(encryptionKeyId);
    if (!dbResult.found) {
        throw new Error(`未在数据库中查到密钥 (EncryptionKeyId: ${encryptionKeyId})\n请确保已在酷狗音乐中播放过此文件。`);
    }

    const ekeyStr = dbResult.EncryptionKey;
    if (!ekeyStr) {
        throw new Error('数据库中的加密密钥为空');
    }

    // 4. 解密 ekey → QMC2 密钥
    const qmcKey = decrypt_ekey(ekeyStr);
    if (!qmcKey || qmcKey.length === 0) {
        throw new Error('QMC2 密钥解密失败');
    }

    // 5. 读取加密的音频数据
    const fileSize = fs.statSync(inputPath).size;
    const audioData = Buffer.alloc(fileSize - audioOffset);
    const fd2 = fs.openSync(inputPath, 'r');
    fs.readSync(fd2, audioData, 0, audioData.length, audioOffset);
    fs.closeSync(fd2);

    // 6. QMC2 解密
    if (qmcKey.length < 300) {
        const decryptor = new QMC2_MAP(qmcKey);
        decryptor.decrypt(audioData);
    } else {
        const decryptor = new QMC2_RC4(qmcKey);
        decryptor.decrypt(audioData);
    }

    // 7. 检测音频格式
    const ext = detectAudioFormat(audioData);

    // 8. 写入输出
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const baseName = path.basename(inputPath, path.extname(inputPath));
    const outputPath = path.join(outputDir, `${baseName}.${ext}`);
    fs.writeFileSync(outputPath, audioData);

    return outputPath;
}

module.exports = { decryptKgg, isKggSupported };
