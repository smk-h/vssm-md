# Markdown Editor

English | [简体中文](README-CN.md) | [繁體中文](README-TW.md)

## Introduction

This extension replaces the default Markdown editor in VS Code with a full WYSIWYG editor (based on [vditor](https://github.com/Vanessa219/vditor)).

Features:

- Editing modes: WYSIWYG and instant rendering (IR)
- Code blocks with syntax highlighting ([CodeMirror 6](https://codemirror.net/)) and language auto-completion
- Diagrams ([Mermaid](https://mermaid.js.org/)), math typesetting ([KaTeX](https://katex.org/)), Obsidian-style callouts, footnotes, task lists and more
- Themes: editor theme, CodeMirror theme and Mermaid theme, each followable to VS Code color theme (`Auto`)
- Enhanced paste: paste images directly into the document (saved to a configurable path with `workspaceDir`, `fileName`, `now`, `date`, `uuid`, `ext` variables)
- Export: right-click in the editor to export Markdown to PDF, DOCX, or HTML. PDF export requires Chromium; set the browser path with `vssm-md.chromiumPath`
- AI polish: right-click to polish the selected text with VS Code language models or a custom OpenAI/Anthropic/Gemini/Ollama compatible endpoint
- Multi-webview block scroll sync and outline navigation
- Wiki link (`[[page]]`) and relative link navigation, including jump-to-definition search
- Works on desktop and in the browser (vscode.dev)

To use the built-in VS Code Markdown editor instead, add this to your `settings.json`:

```json
{
    "workbench.editorAssociations": {
        "*.md": "default",
        "*.markdown": "default"
    }
}
```

You can also switch between the two editors with the `Switch markdown editor` command (`Ctrl+Alt+E` / `⌘ ^ E`).

## Shortcuts

Based on [shortcut.md](shortcut.md), plus:

- New line: `Ctrl+Enter` / `⌘ Enter`
- Hard line break: `Shift+Enter` / `⇧ Enter`
- Edit hyperlink: `Alt+Enter` / `^ Enter`
- Set CodeMirror language: `Alt+Enter` / `^ Enter`
- Edit in VS Code: `Ctrl Alt E` / `⌘ ^ E`
- Paste as plain text: `Ctrl+Shift+V` / `⌘ ⇧ V`

## Development Guide

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [VS Code](https://code.visualstudio.com/) 1.64+

### Getting started

```bash
git clone https://github.com/smk-h/vssm-md.git
cd vssm-md
npm install
```

### Development

**Desktop extension** (full feature set):

```bash
npm run dev
```

Press `F5` in VS Code, or choose **Extension** from Run and Debug.

**Web extension** (Markdown editor in the browser):

```bash
npm run dev:web
```

Choose **Extension (Web)** from Run and Debug.

The Markdown editor webview is built from the embedded vditor source in `vditor/` into `resource/markdown/`; editing vditor sources rebuilds it automatically in dev mode. The Markdown engine is [Lute](https://github.com/88250/lute) v1.7.3, vendored at `vditor/src/js/lute/lute.min.js` and compiled from the Go sources via GopherJS; it is a build artifact that cannot be edited directly, so changing engine behavior (parsing/rendering rules) requires patching the Go sources and recompiling.

### Build & package

```bash
npm run build    # production build
npm run package  # create .vsix
```

## Usage data

This extension collects **anonymous usage data** to understand how the editor is used, so we can improve it. Data is sent to [Azure Application Insights](https://learn.microsoft.com/azure/azure-monitor/app/app-insights-overview) via the official [`@vscode/extension-telemetry`](https://www.npmjs.com/package/@vscode/extension-telemetry) module.

### What we collect

| Event         | When                 | Properties                                                              |
| ------------- | -------------------- | ----------------------------------------------------------------------- |
| `view.open` | The editor is opened | `viewType` (`markdown`), `fileType` (extension only, e.g. `md`) |

We **do not** collect file paths, file names, URLs, repository names, document contents, or other personally identifiable information.

### How to opt out

Telemetry is sent only when **both** of the following allow it:

1. VS Code global telemetry is enabled (`telemetry.telemetryLevel` is not `off`, or `telemetry.enableTelemetry` is `true` on older versions).
2. Extension telemetry is enabled: set `vssm-md.enableTelemetry` to `false` in Settings.

You can also disable all VS Code telemetry in **Settings → Application → Telemetry**.

### Maintainer setup

If you build and publish this extension yourself, see [docs/telemetry.md](docs/telemetry.md) for Azure Application Insights setup and sample queries.

## Origin

This project is forked from [cweijan/vscode-office](https://github.com/cweijan/vscode-office) and trimmed down to focus on its Markdown editor. The fork point is upstream commit [`2755c6f`](https://github.com/cweijan/vscode-office/commit/2755c6f) (Merge branch 'dev', 2026-10-15, version 4.2.2). All commits before it in this repository are inherited upstream history. This fork is maintained for personal learning use only.

## Credits

- Markdown editor: [Vanessa219/vditor](https://github.com/Vanessa219/vditor)
- Markdown engine: [88250/lute](https://github.com/88250/lute) v1.7.3 (GopherJS build)

---
*本文档由 markdowncli 技能辅助生成*
