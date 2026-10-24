# Markdown Editor

[English](README.md) | [简体中文](README-CN.md) | 繁體中文

## 介紹

本擴充功能以完整的所見即所得編輯器（基於 [vditor](https://github.com/Vanessa219/vditor)）取代 VS Code 預設的 Markdown 編輯器。

功能：

- 編輯模式：所見即所得（WYSIWYG）與即時渲染（IR）
- 程式碼區塊語法高亮（[CodeMirror 6](https://codemirror.net/)），支援語言自動補全
- 圖表（[Mermaid](https://mermaid.js.org/)）、數學公式（[KaTeX](https://katex.org/)）、Obsidian 風格 Callout、註腳、工作清單等
- 主題：編輯器主題、CodeMirror 主題、Mermaid 主題，均可設為 `Auto` 跟隨 VS Code 配色
- 增強貼上：直接貼上圖片到文件（儲存路徑可設定，支援 `workspaceDir`、`fileName`、`now`、`date`、`uuid`、`ext` 變數）
- 匯出：在編輯器中按右鍵可將 Markdown 匯出為 PDF、DOCX 或 HTML。PDF 匯出依賴 Chromium，可透過 `vscode-office.chromiumPath` 設定瀏覽器路徑
- AI 潤色：右鍵使用 VS Code 語言模型或自訂 OpenAI/Anthropic/Gemini/Ollama 相容端點潤色選取內容
- 多視窗分區捲動同步與大綱導覽
- Wiki 連結（`[[頁面]]`）與相對連結跳轉，支援定義處搜尋
- 桌面端與瀏覽器（vscode.dev）皆可使用

如需使用 VS Code 原生 Markdown 編輯器，請在 `settings.json` 中新增以下設定：

```json
{
    "workbench.editorAssociations": {
        "*.md": "default",
        "*.markdown": "default"
    }
}
```

也可以透過 `Switch markdown editor` 命令（`Ctrl+Alt+E` / `⌘ ^ E`）在兩種編輯器間切換。

## 快捷鍵

基於 [shortcut.md](shortcut.md)，以及：

- 新行: `Ctrl+Enter` / `⌘ Enter`
- 硬換行: `Shift+Enter` / `⇧ Enter`
- 編輯超連結: `Alt+Enter` / `^ Enter`
- 設定 CodeMirror 語言: `Alt+Enter` / `^ Enter`
- 在 VS Code 中編輯: `Ctrl Alt E` / `⌘ ^ E`
- 貼上為純文字: `Ctrl+Shift+V` / `⌘ ⇧ V`

## 開發指南

### 環境需求

- [Node.js](https://nodejs.org/) 18+
- [VS Code](https://code.visualstudio.com/) 1.64+

### 快速開始

```bash
git clone https://github.com/cweijan/vscode-office.git
cd vscode-office
npm install
```

### 開發偵錯

**桌面端擴充功能**（完整功能）：

```bash
npm run dev
```

在 VS Code 中按 `F5`，或在「執行與偵錯」中選擇 **Extension**。

**Web 端擴充功能**（瀏覽器中的 Markdown 編輯器）：

```bash
npm run dev:web
```

在「執行與偵錯」中選擇 **Extension (Web)**。

Markdown 編輯器 webview 由 `vditor/` 內嵌原始碼建置到 `resource/markdown/`；開發模式下修改 vditor 原始碼會自動重新建置。

### 建置與打包

```bash
npm run build    # 生產建置
npm run package  # 產生 .vsix
```

## 使用資料（Usage Data）

本擴充功能會收集**匿名使用資料**，用於了解編輯器的使用情況，以便改進擴充功能。資料透過官方模組 [`@vscode/extension-telemetry`](https://www.npmjs.com/package/@vscode/extension-telemetry) 傳送至 [Azure Application Insights](https://learn.microsoft.com/zh-cn/azure/azure-monitor/app/app-insights-overview)。

### 收集內容

| 事件 | 觸發時機 | 屬性 |
|------|---------|------|
| `view.open` | 開啟編輯器 | `viewType`（`markdown`）、`fileType`（僅副檔名，如 `md`） |

**不會**收集檔案路徑、檔名、URL、儲存庫名稱、文件內容或其他可識別個人身分的資訊。

### 如何關閉

僅在以下**兩項均允許**時才會上報：

1. VS Code 全域遙測已開啟（`telemetry.telemetryLevel` 不為 `off`，或舊版中 `telemetry.enableTelemetry` 為 `true`）。
2. 擴充功能遙測已開啟：在設定中將 `vscode-office.enableTelemetry` 設為 `false` 可單獨關閉本擴充功能的上報。

也可在 **設定 → 應用程式 → 遙測** 中關閉 VS Code 的全部遙測。

### 維護者設定

若自行建置並發布本擴充功能，請參閱 [docs/telemetry.md](docs/telemetry.md) 設定 Azure Application Insights 及範例查詢。

## Credits

- Markdown 編輯器: [Vanessa219/vditor](https://github.com/Vanessa219/vditor)
