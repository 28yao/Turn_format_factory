const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const officeCom = require('./officeComConverter');

// Sharp - 可选导入（用于图片→PDF）
let sharp = null;
try { sharp = require('sharp'); } catch {}

// Office COM 可用性缓存（每次会话只检测一次）
let officeComAvailable = null;

// === 系统安装的 LibreOffice 路径检测 ===

const LIBREOFFICE_SYSTEM_PATHS = [
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe'
];

function findLibreOffice() {
    for (const p of LIBREOFFICE_SYSTEM_PATHS) {
        if (fs.existsSync(p)) return p;
    }
    return 'soffice'; // 回退到 PATH
}

// === 格式定义 ===

const FILE_TO_PDF_INPUT_EXTS = ['.docx', '.xlsx', '.pptx', '.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tiff', '.tif', '.txt'];
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tiff', '.tif', '.ico', '.avif'];

const PDF_TO_FILE_FORMATS = [];

const WORD_CONVERT_FORMATS = [
    { label: 'PDF (.pdf)', ext: '.pdf' },
    { label: 'HTML (.html)', ext: '.html' }
];

// === 工具函数 ===

function isImageExt(ext) {
    return IMAGE_EXTS.includes(ext.toLowerCase());
}

function isFileToPdfExt(ext) {
    return FILE_TO_PDF_INPUT_EXTS.includes(ext.toLowerCase());
}

// === 引擎检测 ===

/**
 * 检测所有可用转换引擎
 */
async function checkAllEngines() {
    const lo = findLibreOffice();
    const loAvailable = fs.existsSync(lo);
    const com = await officeCom.checkOfficeCom();
    const sharpAvailable = !!sharp;

    const engines = [];
    if (com.available) engines.push('office-com');
    if (sharpAvailable) engines.push('sharp');
    if (loAvailable) engines.push('libreoffice');

    return {
        engines,
        primary: com.available ? 'office-com' : (sharpAvailable ? 'sharp' : (loAvailable ? 'libreoffice' : null)),
        officeCom: com,
        libreoffice: { available: loAvailable, path: lo },
        sharp: sharpAvailable
    };
}

// === 各引擎转换函数 ===

/**
 * 使用 Sharp 将图片转为 PDF
 */
async function convertImageWithSharp(inputPath, targetExt, outputDir) {
    if (!sharp) throw new Error('Sharp 库不可用，无法转换图片');

    const parsed = path.parse(inputPath);
    const outDir = outputDir || parsed.dir;
    const outputName = parsed.name + targetExt;
    const outputPath = path.join(outDir, outputName);

    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    await sharp(inputPath).toFile(outputPath);

    const stat = fs.statSync(outputPath);
    return {
        outputPath,
        outputName,
        outputSize: stat.size,
        originalSize: fs.statSync(inputPath).size
    };
}

/**
 * 使用 LibreOffice 转换（系统安装版）
 */
function getConvertFormat(ext) {
    const map = {
        '.pdf': 'pdf', '.docx': 'docx', '.xlsx': 'xlsx',
        '.pptx': 'pptx', '.html': 'html', '.txt': 'txt:Text', '.png': 'png'
    };
    return map[ext.toLowerCase()] || ext.slice(1);
}

async function convertWithLibreOffice(inputPath, targetExt, outputDir) {
    const soffice = findLibreOffice();
    if (!fs.existsSync(soffice)) {
        throw new Error('未检测到 LibreOffice，请安装 (https://www.libreoffice.org/download/)');
    }

    const parsed = path.parse(inputPath);
    const outDir = outputDir || parsed.dir;
    const tmpUserDir = path.join(os.tmpdir(), `libreoffice_${Date.now()}`);
    const convertFormat = getConvertFormat(targetExt);

    return new Promise((resolve, reject) => {
        const args = ['--headless', '--convert-to', convertFormat, '--outdir', outDir, inputPath];

        execFile(soffice, args, { timeout: 180000 }, async (err, stdout, stderr) => {
            try { fs.rmSync(tmpUserDir, { recursive: true, force: true }); } catch {}

            if (err) {
                const msg = stderr ? stderr.toString().trim() : err.message;
                reject(new Error(`转换失败: ${msg || err.message}`));
                return;
            }

            const baseName = parsed.name;
            const expectedOutput = path.join(outDir, baseName + targetExt);

            if (fs.existsSync(expectedOutput)) {
                const stat = fs.statSync(expectedOutput);
                resolve({
                    outputPath: expectedOutput,
                    outputName: path.basename(expectedOutput),
                    outputSize: stat.size,
                    originalSize: fs.statSync(inputPath).size
                });
                return;
            }

            // 多页输出检测
            let allFiles;
            try { allFiles = fs.readdirSync(outDir); } catch { allFiles = []; }
            const multiFiles = allFiles.filter(f =>
                f.startsWith(baseName) && f.endsWith(targetExt) && f !== baseName + targetExt
            ).sort();

            if (multiFiles.length > 0) {
                const firstOutput = path.join(outDir, multiFiles[0]);
                const stat = fs.statSync(firstOutput);
                resolve({
                    outputPath: firstOutput,
                    outputName: multiFiles[0],
                    outputSize: stat.size,
                    originalSize: fs.statSync(inputPath).size,
                    pageCount: multiFiles.length,
                    multiPage: true
                });
                return;
            }

            reject(new Error('未找到输出文件，请检查输入文件是否损坏'));
        });
    });
}

// === 主转换函数（自动选引擎） ===

/**
 * 自动选择最佳引擎进行文档转换
 * 优先级：Office COM → Sharp(图片→PDF) → LibreOffice
 */
async function convertFile(inputPath, targetExt, outputDir) {
    const ext = path.extname(inputPath).toLowerCase();
    const target = targetExt.toLowerCase();

    // 1. 尝试 Office COM（Office 格式文档）- 需检测是否真正可用
    if (officeCom.canHandle(ext, target)) {
        if (officeComAvailable === null) {
            const status = await officeCom.checkOfficeCom();
            officeComAvailable = status.available;
        }
        if (officeComAvailable) {
            try {
                return await officeCom.convertFile(inputPath, target, outputDir);
            } catch (err) {
                throw new Error(`Office 转换失败: ${err.message}`);
            }
        }
    }

    // 2. 图片 → PDF 用 Sharp
    if (target === '.pdf' && isImageExt(ext)) {
        if (sharp) {
            try {
                return await convertImageWithSharp(inputPath, target, outputDir);
            } catch (err) {
                throw new Error(`图片转换失败: ${err.message}`);
            }
        }
    }

    // 3. 兜底：LibreOffice（系统安装）
    return await convertWithLibreOffice(inputPath, target, outputDir);
}

module.exports = {
    convertFile,
    findLibreOffice,
    checkLibreOffice: () => ({ available: fs.existsSync(findLibreOffice()), path: findLibreOffice() }),
    checkAllEngines,
    isFileToPdfExt,
    isImageExt,
    FILE_TO_PDF_INPUT_EXTS,
    PDF_TO_FILE_FORMATS,
    WORD_CONVERT_FORMATS
};
