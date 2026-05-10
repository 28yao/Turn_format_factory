const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { promises: fsp } = require('fs');
const pngToIco = require('png-to-ico');

/**
 * 将 PNG Buffer 转换为 ICO
 */
async function bufferToIco(pngBuffer) {
    const tmpFile = path.join(require('os').tmpdir(), `iconv_${Date.now()}_${Math.random().toString(36).slice(2)}.png`);
    await fsp.writeFile(tmpFile, pngBuffer);
    try {
        const result = await pngToIco.default(tmpFile);
        return result;
    } finally {
        try { await fsp.unlink(tmpFile); } catch {}
    }
}

/**
 * 手动编码 BMP 文件
 * BMP 格式：文件头(14) + DIB头(40) + 像素数据
 */
async function writeBmp(pipeline) {
    const { data, info } = await pipeline
        .raw()
        .toBuffer({ resolveWithObject: true });

    const { width, height, channels } = info;
    const rowSize = Math.ceil((width * channels * 8) / 32) * 4;
    const pixelDataSize = rowSize * height;
    const fileSize = 14 + 40 + pixelDataSize;

    const buffer = Buffer.alloc(fileSize);
    let offset = 0;

    // BMP 文件头 (14 bytes)
    buffer.write('BM', offset, 2, 'ascii'); offset += 2;      // 签名
    buffer.writeUInt32LE(fileSize, offset); offset += 4;        // 文件大小
    buffer.writeUInt16LE(0, offset); offset += 2;               // 保留
    buffer.writeUInt16LE(0, offset); offset += 2;               // 保留
    buffer.writeUInt32LE(54, offset); offset += 4;              // 数据偏移

    // DIB 头 BITMAPINFOHEADER (40 bytes)
    buffer.writeUInt32LE(40, offset); offset += 4;              // 头大小
    buffer.writeInt32LE(width, offset); offset += 4;            // 宽度
    buffer.writeInt32LE(-height, offset); offset += 4;          // 高度（负值表示从上到下）
    buffer.writeUInt16LE(1, offset); offset += 2;               // 色彩平面数
    const bpp = channels * 8;
    buffer.writeUInt16LE(bpp, offset); offset += 2;             // 每像素位数
    buffer.writeUInt32LE(0, offset); offset += 4;               // 压缩方式 (0=无压缩)
    buffer.writeUInt32LE(pixelDataSize, offset); offset += 4;    // 图像数据大小
    buffer.writeInt32LE(0, offset); offset += 4;                // 水平分辨率
    buffer.writeInt32LE(0, offset); offset += 4;                // 垂直分辨率
    buffer.writeUInt32LE(0, offset); offset += 4;               // 颜色数
    buffer.writeUInt32LE(0, offset); offset += 4;               // 重要颜色数

    // 像素数据（BGR 格式）+ 按行对齐
    for (let y = 0; y < height; y++) {
        const rowStart = y * width * channels;
        let rowOffset = 0;
        for (let x = 0; x < width; x++) {
            const srcIdx = rowStart + x * channels;
            // BMP 为 BGR 顺序
            buffer[offset + rowOffset + 2] = data[srcIdx];      // R
            buffer[offset + rowOffset + 1] = data[srcIdx + 1];  // G
            buffer[offset + rowOffset] = data[srcIdx + 2];      // B
            if (channels === 4) {
                buffer[offset + rowOffset + 3] = data[srcIdx + 3]; // A
            }
            rowOffset += channels;
        }
        // 行对齐填充
        offset += rowSize;
    }

    return buffer;
}

// 格式对应的 Sharp 格式名称
const FORMAT_MAP = {
    '.jpg': 'jpeg',
    '.jpeg': 'jpeg',
    '.png': 'png',
    '.webp': 'webp',
    '.bmp': 'bmp',
    '.gif': 'gif',
    '.svg': 'svg',
    '.tiff': 'tiff',
    '.tif': 'tiff',
    '.ico': 'ico',
    '.avif': 'avif'
};

// 支持输出的格式列表
const OUTPUT_FORMATS = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tiff', '.tif', '.ico', '.avif'];

// 有损压缩格式（支持质量参数调节）
const LOSSY_FORMATS = ['.jpg', '.jpeg', '.webp', '.avif'];

// 是否需要 Sharp 额外处理的输出格式（非 Sharp 原生支持的格式）
const SHARP_UNSUPPORTED_OUTPUT = ['.ico'];

/**
 * 获取图片信息
 */
async function getImageInfo(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const stat = fs.statSync(filePath);
    const name = path.basename(filePath);

    // SVG 特殊处理
    if (ext === '.svg') {
        return {
            path: filePath,
            name,
            ext,
            format: 'svg',
            size: stat.size,
            width: 0,
            height: 0,
            isVector: true
        };
    }

    // HEIC 不支持
    if (ext === '.heic' || ext === '.heif') {
        return {
            path: filePath,
            name,
            ext,
            format: ext.slice(1),
            size: stat.size,
            width: 0,
            height: 0,
            error: 'HEIC/HEIF 格式不支持读取，建议先转换为其他格式'
        };
    }

    try {
        const metadata = await sharp(filePath).metadata();
        return {
            path: filePath,
            name,
            ext,
            format: metadata.format || ext.slice(1),
            size: stat.size,
            width: metadata.width || 0,
            height: metadata.height || 0,
            hasAlpha: metadata.hasAlpha || false
        };
    } catch (err) {
        throw new Error(`无法读取图片: ${name} - ${err.message}`);
    }
}

/**
 * 构建输出文件路径
 */
function buildOutputPath(inputPath, targetFormat, outputDir) {
    const parsed = path.parse(inputPath);
    const outputFileName = parsed.name + targetFormat;
    const dir = outputDir || parsed.dir;

    // 同名文件处理：加后缀
    let outputPath = path.join(dir, outputFileName);
    let counter = 1;
    while (fs.existsSync(outputPath)) {
        outputPath = path.join(dir, `${parsed.name}_${counter}${targetFormat}`);
        counter++;
    }

    return outputPath;
}

/**
 * 转换核心
 */
async function convertImage(inputPath, targetFormat, options = {}) {
    const { quality = 80, resize = null, keepAspectRatio = true, outputDir = null } = options;

    const ext = path.extname(inputPath).toLowerCase();
    const targetExt = targetFormat.startsWith('.') ? targetFormat.toLowerCase() : `.${targetFormat.toLowerCase()}`;

    // 验证目标格式
    if (!OUTPUT_FORMATS.includes(targetExt)) {
        throw new Error(`不支持输出格式: ${targetExt}`);
    }

    // 检查 HEIC 输入
    if (ext === '.heic' || ext === '.heif') {
        throw new Error('HEIC/HEIF 格式不支持作为输入源，请先转换为支持格式');
    }

    // 构建输出路径
    const outputPath = buildOutputPath(inputPath, targetExt, outputDir);

    // 获取原图信息
    const info = await getImageInfo(inputPath);

    // 对于 SVG 输入，需要指定尺寸
    let pipeline = sharp(inputPath);
    if (ext === '.svg') {
        pipeline = sharp(inputPath, { density: 300 });
    }

    // 获取元数据（用于 resize 时的默认尺寸）
    const metadata = await pipeline.metadata();

    // 尺寸缩放
    if (resize && (resize.width || resize.height)) {
        const resizeOptions = {};
        if (resize.width) resizeOptions.width = Math.round(resize.width);
        if (resize.height) resizeOptions.height = Math.round(resize.height);
        if (keepAspectRatio) {
            resizeOptions.fit = 'inside';
            resizeOptions.withoutEnlargement = true;
        } else {
            resizeOptions.fit = 'fill';
        }
        pipeline = pipeline.resize(resizeOptions);
    }

    // 根据目标格式进行转换
    if (targetExt === '.ico') {
        // ICO 特殊处理：先转 PNG buffer，再用 png-to-ico
        const pngBuffer = await pipeline
            .resize({ width: 256, height: 256, fit: 'inside', withoutEnlargement: true })
            .png()
            .toBuffer();

        const icoBuffer = await bufferToIco(pngBuffer);
        await fsp.writeFile(outputPath, icoBuffer);
    } else if (targetExt === '.bmp') {
        // Sharp 0.33+ 移除了 BMP 输出，手动编码 BMP
        const bmpBuffer = await writeBmp(pipeline);
        await fsp.writeFile(outputPath, bmpBuffer);
    } else {
        // Sharp 原生支持的格式
        switch (targetExt) {
            case '.jpg':
            case '.jpeg':
                pipeline = pipeline.jpeg({ quality: quality, mozjpeg: true });
                break;
            case '.png':
                pipeline = pipeline.png({ compressionLevel: 9 });
                break;
            case '.webp':
                pipeline = pipeline.webp({ quality: quality });
                break;
            case '.gif':
                // Sharp 输出 GIF 功能有限，尽可能处理
                pipeline = pipeline.gif();
                break;
            case '.tiff':
            case '.tif':
                pipeline = pipeline.tiff({ quality: quality });
                break;
            case '.avif':
                pipeline = pipeline.avif({ quality: quality });
                break;
            default:
                throw new Error(`不支持输出格式: ${targetExt}`);
        }

        await pipeline.toFile(outputPath);
    }

    // 获取输出文件信息
    let outStat, outMetadata;
    try {
        outStat = await fsp.stat(outputPath);
        outMetadata = await sharp(outputPath).metadata().catch(() => ({}));
    } catch {
        outStat = { size: 0 };
        outMetadata = {};
    }

    return {
        outputPath,
        outputName: path.basename(outputPath),
        outputSize: outStat.size,
        outputWidth: outMetadata.width,
        outputHeight: outMetadata.height,
        originalSize: info.size,
        originalWidth: info.width,
        originalHeight: info.height
    };
}

module.exports = { convertImage, getImageInfo, OUTPUT_FORMATS, LOSSY_FORMATS, FORMAT_MAP };
