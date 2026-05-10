const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const POWERSHELL = 'powershell.exe';
const SCRIPT_DIR = path.join(os.tmpdir(), 'format-factory-office');

// 内嵌 PowerShell 脚本（统一入口，根据 mode 执行不同 COM 操作）
const PS_SCRIPT = `
param([string]$mode, [string]$inputPath, [string]$outputPath)
try {
    switch ($mode) {
        "word2pdf" {
            $app = New-Object -ComObject Word.Application
            $app.Visible = $false
            $doc = $app.Documents.Open($inputPath, $true, $false)
            $doc.SaveAs([ref]$outputPath, [ref]17)
            $doc.Close()
            $app.Quit()
        }
        "word2html" {
            $app = New-Object -ComObject Word.Application
            $app.Visible = $false
            $doc = $app.Documents.Open($inputPath, $true, $false)
            $doc.SaveAs([ref]$outputPath, [ref]8)
            $doc.Close()
            $app.Quit()
        }
        "excel2pdf" {
            $app = New-Object -ComObject Excel.Application
            $app.Visible = $false
            $wb = $app.Workbooks.Open($inputPath, $true, $false)
            foreach ($ws in $wb.Worksheets) {
                $ws.PageSetup.Zoom = $false
                $ws.PageSetup.FitToPagesWide = 1
                $ws.PageSetup.FitToPagesTall = 1
                $ws.PageSetup.PrintArea = ""
            }
            $wb.ExportAsFixedFormat(0, $outputPath)
            $wb.Close($false)
            $app.Quit()
        }
        "ppt2pdf" {
            $app = New-Object -ComObject PowerPoint.Application
            $app.Visible = $false
            $pres = $app.Presentations.Open($inputPath, $true, $false, $false)
            $pres.SaveAs($outputPath, 32)
            $pres.Close()
            $app.Quit()
        }
        "check" {
            $result = @{}
            try { $w = New-Object -ComObject Word.Application; $result.Word = $w.Version; $w.Quit() } catch { $result.Word = $null }
            try { $e = New-Object -ComObject Excel.Application; $result.Excel = $true; $e.Quit() } catch { $result.Excel = $false }
            try { $p = New-Object -ComObject PowerPoint.Application; $result.PPT = $true; $p.Quit() } catch { $result.PPT = $false }
            Write-Output ($result | ConvertTo-Json -Compress)
            return
        }
    }
    Write-Output "OK"
} catch {
    Write-Output ("ERROR:" + $_.Exception.Message)
    exit 1
}
`;

// 支持的输入格式 → Office 应用映射
const OFFICE_APP_MAP = {
    word2pdf:  ['.docx', '.doc', '.txt', '.rtf'],
    word2html: ['.docx', '.doc'],
    excel2pdf: ['.xlsx', '.xls', '.csv'],
    ppt2pdf:   ['.pptx', '.ppt']
};

// 获取对应的转换模式
function getConversionMode(inputExt, targetExt) {
    if (targetExt === '.pdf') {
        if (['.docx', '.doc', '.txt', '.rtf'].includes(inputExt)) return 'word2pdf';
        if (['.xlsx', '.xls', '.csv'].includes(inputExt)) return 'excel2pdf';
        if (['.pptx', '.ppt'].includes(inputExt)) return 'ppt2pdf';
    }
    if (targetExt === '.html' && ['.docx', '.doc'].includes(inputExt)) return 'word2html';
    return null;
}

// 获取脚本文件路径（写入一次，重复使用）
let scriptPath = null;
function getScriptPath() {
    if (scriptPath && fs.existsSync(scriptPath)) return scriptPath;
    try {
        if (!fs.existsSync(SCRIPT_DIR)) fs.mkdirSync(SCRIPT_DIR, { recursive: true });
        scriptPath = path.join(SCRIPT_DIR, 'office_convert.ps1');
        fs.writeFileSync(scriptPath, PS_SCRIPT, 'utf-8');
        return scriptPath;
    } catch {
        return null;
    }
}

// 执行 PowerShell 脚本
function execPs(scriptFile, args) {
    return new Promise((resolve, reject) => {
        const allArgs = [
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-File', scriptFile,
            ...args
        ];
        execFile(POWERSHELL, allArgs, { timeout: 120000 }, (err, stdout, stderr) => {
            if (err) {
                const msg = stderr ? stderr.toString().trim() : err.message;
                reject(new Error(`PowerShell 执行失败: ${msg}`));
                return;
            }
            const out = stdout.toString().trim();
            if (out.startsWith('ERROR:')) {
                reject(new Error(out.substring(6)));
                return;
            }
            resolve(out);
        });
    });
}

/**
 * 检查 Office COM 是否可用
 */
async function checkOfficeCom() {
    const sp = getScriptPath();
    if (!sp) return { available: false, word: null, excel: false, ppt: false };
    try {
        const result = await execPs(sp, ['check', '', '']);
        const data = JSON.parse(result);
        return {
            available: !!data.Word || !!data.Excel || !!data.PPT,
            word: data.Word || null,
            excel: !!data.Excel,
            ppt: !!data.PPT
        };
    } catch {
        return { available: false, word: null, excel: false, ppt: false };
    }
}

/**
 * 用 Office COM 转换文件
 * @param {string} inputPath - 输入文件路径
 * @param {string} targetExt - 目标格式扩展名（如 .pdf）
 * @param {string} outputDir - 输出目录
 * @returns {Promise<{outputPath, outputName, outputSize, originalSize}>}
 */
async function convertFile(inputPath, targetExt, outputDir) {
    const parsed = path.parse(inputPath);
    const outDir = outputDir || parsed.dir;
    const outputName = parsed.name + targetExt;
    const outputPath = path.join(outDir, outputName);

    // 检查输入文件
    if (!fs.existsSync(inputPath)) {
        throw new Error('输入文件不存在');
    }

    const mode = getConversionMode(parsed.ext.toLowerCase(), targetExt);
    if (!mode) {
        throw new Error(`Office COM 不支持 ${parsed.ext} → ${targetExt} 转换`);
    }

    // 确保输出目录存在
    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }

    const sp = getScriptPath();
    if (!sp) {
        throw new Error('无法创建 PowerShell 脚本');
    }

    await execPs(sp, [mode, inputPath, outputPath]);

    if (!fs.existsSync(outputPath)) {
        throw new Error('转换后未找到输出文件');
    }

    const stat = fs.statSync(outputPath);
    return {
        outputPath,
        outputName,
        outputSize: stat.size,
        originalSize: fs.statSync(inputPath).size
    };
}

/**
 * 判断 Office COM 是否能处理该转换
 */
function canHandle(inputExt, targetExt) {
    return getConversionMode(inputExt.toLowerCase(), targetExt.toLowerCase()) !== null;
}

/**
 * 支持的输入扩展名列表
 */
function getSupportedInputExts() {
    const all = new Set();
    for (const exts of Object.values(OFFICE_APP_MAP)) {
        exts.forEach(e => all.add(e));
    }
    return [...all];
}

// 清理临时脚本
function cleanup() {
    try {
        if (scriptPath && fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
        if (fs.existsSync(SCRIPT_DIR)) fs.rmdirSync(SCRIPT_DIR);
    } catch {}
}

module.exports = {
    checkOfficeCom,
    convertFile,
    canHandle,
    getSupportedInputExts,
    cleanup
};
