# 格式工厂小工具

## 领域词汇

| 术语 | 定义 |
|------|------|
| 源格式 (SourceFormat) | 输入文件的原始格式，由文件扩展名自动识别 |
| 目标格式 (TargetFormat) | 用户选择的输出格式，转换后的文件将保存为该格式 |
| 质量 (Quality) | 输出文件的压缩质量参数，仅对有损格式生效，范围 0-100；视频内部映射到对应编码器的 CRF 或 qscale 参数 |
| 尺寸缩放 (Resize) | 调整输出视频/图片的宽高尺寸，支持按像素设定 |
| 保持宽高比 (AspectRatio) | 缩放时锁定原始宽高比，防止画面变形 |
| 单张模式 (SingleMode) | 一次选择一个文件进行转换，可精细调整参数 |
| 批量模式 (BatchMode) | 一次选择多个文件，统一转换到目标格式 |
| 输出目录 (OutputDir) | 转换后文件的保存位置，默认保存在源文件所在目录 |
| 编解码器 (Codec) | 视频/音频的编码格式，如 H.264 (libx264)、VP8 (libvpx) 等；对用户不可见，由格式自动匹配 |
| CRF (Constant Rate Factor) | 视频编码质量参数，值越低质量越高（libx264: 0-51, libvpx: 0-63），内部从质量 0-100 映射 |
| 帧率 (FPS) | 视频每秒显示的帧数，GIF 输出自动降帧到 15fps |

## 支持的格式映射

### 图片格式

| 格式 | 支持输入 | 支持输出 | 备注 |
|------|---------|---------|------|
| JPEG (.jpg/.jpeg) | 是 | 是 | 支持质量参数调节 |
| PNG (.png) | 是 | 是 | 无损格式 |
| WebP (.webp) | 是 | 是 | 支持质量参数调节 |
| BMP (.bmp) | 是 | 是 | 无压缩 |
| GIF (.gif) | 是 | 是 | 仅保留第一帧 |
| SVG (.svg) | 是 | 否 | 输入时栅格化，不可输出矢量 |
| ICO (.ico) | 是 | 是 | 固定尺寸输出 |
| TIFF (.tiff/.tif) | 是 | 是 | 高质量 |
| AVIF (.avif) | 是 | 是 | 支持质量参数调节 |
| HEIC (.heic) | 有限 | 否 | 输入依赖系统解码 |

### 视频格式

| 格式 | 支持输入 | 支持输出 | 备注 |
|------|:-------:|:-------:|------|
| MP4 (.mp4) | 是 | 是 | libx264 编码，兼容性最好 |
| AVI (.avi) | 是 | 是 | mpeg4 编码，无压缩选项 |
| MKV (.mkv) | 是 | 是 | libx264 编码，封装格式 |
| MOV (.mov) | 是 | 是 | libx264 编码，QuickTime |
| WMV (.wmv) | 是 | 是 | wmv2 编码，Windows Media |
| FLV (.flv) | 是 | 是 | flv 编码，Flash Video |
| WebM (.webm) | 是 | 是 | libvpx(VP8) 编码，开源 |
| GIF (.gif) | 否 | 是 | 视频转 GIF，两遍 palette 优化 + 15fps + 宽度≤600px |

### 音频格式

| 格式 | 支持输入 | 支持输出 | 备注 |
|------|---------|---------|------|
| MP3 (.mp3) | 是 | 是 | 支持码率调节 (32-320kbps) |
| WAV (.wav) | 是 | 是 | 无压缩，无损 |
| FLAC (.flac) | 是 | 是 | 无损压缩 |
| AAC (.aac) | 是 | 是 | 支持码率调节 (32-320kbps) |
| OGG (.ogg) | 是 | 是 | 支持码率调节 (32-320kbps) |
| M4A (.m4a) | 是 | 是 | 支持码率调节 (32-320kbps) |
| Opus (.opus) | 是 | 是 | 支持码率调节 (6-510kbps) |
| WMA (.wma) | 是 | 是 | 支持码率调节 (32-320kbps) |

## 已确定的设计决策

- **技术方案**: Electron 桌面应用，Sharp 做图片处理引擎，FFmpeg (fluent-ffmpeg) 做音频和视频处理引擎
- **图片格式**: JPG/PNG/WebP/BMP/GIF/SVG/ICO/TIFF/AVIF/HEIC（10种输入，9种输出）
- **音频格式**: MP3/WAV/FLAC/AAC/OGG/M4A/Opus/WMA（8种输入输出全支持）
- **视频格式**: MP4/AVI/MKV/MOV/WMV/FLV/WebM 输入输出 + 视频转 GIF（仅输出）
- **转换模式**: 单张模式 + 批量模式（图片/视频/音频共用相同模式切换）
- **图片附加功能**: 输出质量调节 + 尺寸缩放 + 保持宽高比选项
- **音频附加功能**: 码率调节（仅对有损格式生效，WAV/FLAC 无损格式自动禁用）
- **视频附加功能**: 质量调节（映射到 CRF/qscale）+ 分辨率缩放 + 保持宽高比选项
- **GIF 输出**: 自动两遍 palette 优化 + 降帧到 15fps + 宽度限制 ≤600px，无用户参数
- 格式映射：图片 10种输入9种输出 + 音频8种 + 视频7种 + 视频转GIF
- **各模块引擎**: 图片 sharp + 音频 fluent-ffmpeg + 视频 fluent-ffmpeg（@ffmpeg-installer/ffmpeg）
- **新增模块引擎**: LibreOffice 命令行（soffice），用户自行安装，不捆绑
  - 文件转PDF：Word/Excel/PPT/图片/TXT → PDF
  - PDF转文件：PDF → Word/Excel/PPT/图片/TXT
  - Word转换：Word → PDF / PPT / HTML
- **运行环境**: Windows 10及以上，Node.js v24.14.0
- **项目位置**: `d:\31689\Documents\code\ai coding\format-factory\`
- **打包方式**: electron-builder 打包为 Windows 安装程序

## UI 设计决策

- **布局结构**: 带侧边导航栏的完整布局（路线A），参考 UI.md 设计语言
- **页面层次**: 首页（入口概览）→ 点击卡片进入对应类型的转换页
- **侧边栏导航项**: 首页、图片转换、视频转换、音频转换、文件转PDF、PDF转文件、Word转换
- **首页入口卡片**: 6 张卡片 2×3 网格排列（图片/视频/音频/文件转PDF/PDF转文件/Word转换）
- **实施范围**: 图片、视频、音频、文件转PDF、PDF转文件、Word转换 功能完整可用
- **页面路由**: SPA 切换，各类型设置面板互斥显示

## 三个文档模块详情

| 模块 | 输入格式 | 目标格式选项 | 参数 |
|------|---------|-------------|------|
| 文件转PDF | .docx,.xlsx,.pptx,.jpg,.png,... ,.txt | 固定 .pdf | 无（直接转换） |
| PDF转文件 | .pdf | Word(.docx)/Excel(.xlsx)/PPT(.pptx)/图片(.png)/TXT(.txt) | 仅目标格式 |
| Word转换 | .docx | PDF(.pdf)/PPT(.pptx)/HTML(.html) | 仅目标格式 |

**引擎**: LibreOffice 命令行（soffice --headless --convert-to），用户自行安装
**文件路径检测**: `C:\Program Files\LibreOffice\program\soffice.exe` / `C:\Program Files (x86)\...` / PATH 回退
**功能复用**: 文件转PDF 中的 Word→PDF 与 Word转换 的 Word→PDF 共享同一后端函数
