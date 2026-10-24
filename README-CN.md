# Markdown Editor

[English](README.md) | 简体中文 | [繁體中文](README-TW.md)

## 介绍

本扩展用完整的所见即所得编辑器（基于 [vditor](https://github.com/Vanessa219/vditor)）替换 VS Code 默认的 Markdown 编辑器。

功能：

- 编辑模式：所见即所得（WYSIWYG）与即时渲染（IR）
- 代码块语法高亮（[CodeMirror 6](https://codemirror.net/)），支持语言自动补全
- 图表（[Mermaid](https://mermaid.js.org/)）、数学公式（[KaTeX](https://katex.org/)）、Obsidian 风格 Callout、脚注、任务列表等
- 主题：编辑器主题、CodeMirror 主题、Mermaid 主题，均可设为 `Auto` 跟随 VS Code 配色
- 增强粘贴：直接粘贴图片到文档（保存路径可配置，支持 `workspaceDir`、`fileName`、`now`、`date`、`uuid`、`ext` 变量）
- 导出：编辑器中右键可将 Markdown 导出为 PDF、DOCX 或 HTML。PDF 导出依赖 Chromium，可通过 `vssm-md.chromiumPath` 配置浏览器路径
- AI 润色：右键使用 VS Code 语言模型或自定义 OpenAI/Anthropic/Gemini/Ollama 兼容端点润色选中内容
- 多窗口分块滚动同步与大纲导航
- Wiki 链接（`[[页面]]`）与相对链接跳转，支持定义处搜索
- 桌面端与浏览器（vscode.dev）均可用

如需使用 VS Code 原生 Markdown 编辑器，请在 `settings.json` 中添加以下配置：

```json
{
    "workbench.editorAssociations": {
        "*.md": "default",
        "*.markdown": "default"
    }
}
```

也可以通过 `Switch markdown editor` 命令（`Ctrl+Alt+E` / `⌘ ^ E`）在两种编辑器间切换。

## 快捷键

基于 [shortcut.md](shortcut.md)，以及：

- 新行: `Ctrl+Enter` / `⌘ Enter`
- 硬换行: `Shift+Enter` / `⇧ Enter`
- 编辑超链接: `Alt+Enter` / `^ Enter`
- 设置 CodeMirror 语言: `Alt+Enter` / `^ Enter`
- 在 VS Code 中编辑: `Ctrl Alt E` / `⌘ ^ E`
- 粘贴为纯文本: `Ctrl+Shift+V` / `⌘ ⇧ V`

## 开发指南

### 环境要求

- [Node.js](https://nodejs.org/) 18+
- [VS Code](https://code.visualstudio.com/) 1.64+

### 快速开始

```bash
git clone https://github.com/smk-h/vssm-md.git
cd vssm-md
npm install
```

### 开发调试

**桌面端扩展**（完整功能）：

```bash
npm run dev
```

在 VS Code 中按 `F5`，或在「运行和调试」中选择 **Extension**。

**Web 端扩展**（浏览器中的 Markdown 编辑器）：

```bash
npm run dev:web
```

在「运行和调试」中选择 **Extension (Web)**。

Markdown 编辑器 webview 由 `vditor/` 内嵌源码构建到 `resource/markdown/`；开发模式下修改 vditor 源码会自动重新构建。

### 构建与打包

```bash
npm run build    # 生产构建
npm run package  # 生成 .vsix
```

## 使用数据（Usage Data）

本扩展会收集**匿名使用数据**，用于了解编辑器的使用情况，以便改进扩展。数据通过官方模块 [`@vscode/extension-telemetry`](https://www.npmjs.com/package/@vscode/extension-telemetry) 发送至 [Azure Application Insights](https://learn.microsoft.com/zh-cn/azure/azure-monitor/app/app-insights-overview)。

### 收集内容

| 事件 | 触发时机 | 属性 |
|------|---------|------|
| `view.open` | 打开编辑器 | `viewType`（`markdown`）、`fileType`（仅扩展名，如 `md`） |

**不会**收集文件路径、文件名、URL、仓库名、文档内容或其他可识别个人身份的信息。

### 如何关闭

仅在以下**两项均允许**时才会上报：

1. VS Code 全局遥测已开启（`telemetry.telemetryLevel` 不为 `off`，或旧版中 `telemetry.enableTelemetry` 为 `true`）。
2. 扩展遥测已开启：在设置中将 `vssm-md.enableTelemetry` 设为 `false` 可单独关闭本扩展的上报。

也可在 **设置 → 应用程序 → 遥测** 中关闭 VS Code 的全部遥测。

### 维护者配置

若自行构建并发布本扩展，请参阅 [docs/telemetry.md](docs/telemetry.md) 配置 Azure Application Insights 及示例查询。

## Credits

- Markdown 编辑器: [Vanessa219/vditor](https://github.com/Vanessa219/vditor)
