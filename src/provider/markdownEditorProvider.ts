import { adjustImgPath, getWorkspacePath } from '@/common/fileUtil';
import { dirname, isAbsolute, join, normalize, parse, relative, resolve } from 'path';
import { tmpdir } from 'os';
import { rmSync, writeFileSync } from 'fs';
import * as vscode from 'vscode';
import {
    buildImageFileName,
    buildImageMarkdown,
    buildImageReferencePath,
    escapeReferenceUrl,
    getImageRuleConfig,
    resolveImageInsertPlan,
    ImageRuleConfig,
} from '@/service/imageInsertRule';
import { extensionResource, getExtensionResourceRoots, readExtensionText } from '@/common/extensionResource';
import { ensureParentDirectory } from '@/common/workspaceFs';
import { Handler } from '../common/handler';
import { Util } from '../common/util';
import { Holder } from '../service/markdown/holder';
import { MarkdownService } from '../service/markdownService';
import { Global, i18n } from '@/common/global';
import { TelemetryService } from '@/service/telemetryService';
import { openWikiLink } from '@/service/markdown/wikilink';
import { streamCustomAI } from '@/service/ai/customAIClient';
import { buildAIOutputLanguageInstruction } from '@/service/ai/aiOutputLanguage';
import {
    broadcastToMarkdownWebviews,
    cancelWebviewSwitchFallback,
    consumePendingBlockScroll,
    consumePendingSourceLine,
    registerMarkdownWebview,
    revealTextEditorLine,
    unregisterMarkdownWebview,
} from '@/service/markdown/blockScroll';
import { ViewerSettingsService } from '@/service/viewerSettingsService';
import { fileTypeFromPath } from '@/common/fileSuffix';
import { parseWebviewResourceUri } from '@/common/webviewUri';
import { MarkdownDocumentSync } from '@/service/markdown/documentSync';
import { openLinkedFile } from '@/service/markdown/linkedFile';

function getRuntimePlatform(): string {
    if (typeof process !== 'undefined' && process.platform) {
        return process.platform;
    }
    return 'web';
}

export interface MarkdownEditorProviderOptions {
    isWeb?: boolean;
}

const MARKDOWN_SYNC_CONFIG_KEYS = [
    'preventMacOptionKey',
    'editMode',
    'editorTheme',
    'codeMirrorTheme',
    'mermaidTheme',
] as const;

const IMAGE_CONFIG_KEYS: (keyof ImageRuleConfig)[] = [
    'insertAction',
    'customPath',
    'applyToLocal',
    'applyToWeb',
    'allowYamlUpload',
    'preferRelativePath',
    'prefixDotSlash',
    'escapeUrl',
    'uploadServer',
];

type MarkdownSyncConfigKey = typeof MARKDOWN_SYNC_CONFIG_KEYS[number];

/**
 * support view and edit office files.
 */
export class MarkdownEditorProvider implements vscode.CustomTextEditorProvider {

    private static legacyGlobalStatePurged = false;

    private countStatus: vscode.StatusBarItem | undefined;
    private aiAbortController: AbortController | null = null;
    private aiCancellationSource: vscode.CancellationTokenSource | null = null;

    private getMarkdownTelemetryProps(configuration = vscode.workspace.getConfiguration("vssm-md")) {
        return {
            editorTheme: String(configuration.get<string>("editorTheme", "Auto")),
            codeTheme: String(configuration.get<string>("codeMirrorTheme", "Auto")),
        };
    }

    constructor(
        private context: vscode.ExtensionContext, private options: MarkdownEditorProviderOptions = {}
    ) {
        // 状态栏行列/字数条目不再注册：统计已由工具栏的 Typora 风格计数器承担，保留实现备查
        // this.countStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.purgeLegacyGlobalState();
        MarkdownEditorProvider.registerConfigSync(this.context);
    }

    static registerConfigSync(context: vscode.ExtensionContext): void {
        if (MarkdownEditorProvider.configSyncRegistered) {
            return;
        }
        MarkdownEditorProvider.configSyncRegistered = true;
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration((event) => {
                const config = vscode.workspace.getConfiguration('vssm-md');
                const patch: Partial<Record<MarkdownSyncConfigKey, unknown>> = {};
                let changed = false;
                for (const key of MARKDOWN_SYNC_CONFIG_KEYS) {
                    if (event.affectsConfiguration(`vssm-md.${key}`)) {
                        patch[key] = config.get(key);
                        changed = true;
                    }
                }
                if (changed) {
                    broadcastToMarkdownWebviews('markdownConfig', patch);
                }
                if (IMAGE_CONFIG_KEYS.some((key) => event.affectsConfiguration(`vssm-md.image.${key}`))) {
                    broadcastToMarkdownWebviews('markdownConfig', {
                        imageRules: MarkdownEditorProvider.buildImageRules(),
                    });
                }
            }),
        );
    }

    private static configSyncRegistered = false;

    private purgeLegacyGlobalState() {
        if (MarkdownEditorProvider.legacyGlobalStatePurged) {
            return;
        }
        MarkdownEditorProvider.legacyGlobalStatePurged = true;
        const state = this.context.globalState;
        for (const key of state.keys()) {
            if (key.startsWith('scrollTop_')) {
                void state.update(key, undefined);
            }
        }
    }

    private getFolders(): vscode.Uri[] {
        if (vscode.env.uiKind === vscode.UIKind.Web) {
            return [];
        }
        const data = [];
        for (let i = 65; i <= 90; i++) {
            data.push(vscode.Uri.file(`${String.fromCharCode(i)}:/`))
        }
        return data;
    }

    private getWorkspaceUriByFileUtil(uri: vscode.Uri): vscode.Uri | undefined {
        const workspacePath = getWorkspacePath(uri);
        if (!workspacePath) {
            return undefined;
        }
        return vscode.Uri.file(workspacePath);
    }

    resolveCustomTextEditor(document: vscode.TextDocument, webviewPanel: vscode.WebviewPanel, token: vscode.CancellationToken): void | Thenable<void> {
        // console.log('schema', document.uri.scheme, document.uri.path, document.uri.query);
        const uri = document.uri;
        const webview = webviewPanel.webview;
        const folderPath = vscode.Uri.joinPath(uri, '..')
        webview.options = {
            enableScripts: true,
            localResourceRoots: [
                ...getExtensionResourceRoots(this.context),
                folderPath,
                ...(vscode.workspace.workspaceFolders?.map(folder => folder.uri) ?? []),
                vscode.Uri.file("/"),
                ...this.getFolders(),
            ],
        }
        const handler = Handler.bind(webviewPanel, uri);
        TelemetryService.get()?.trackViewOpen(
            'markdown',
            fileTypeFromPath(uri.fsPath),
            this.getMarkdownTelemetryProps(),
        );
        void this.handleMarkdown(document, handler, folderPath);
        handler.on('developerTool', () => vscode.commands.executeCommand('workbench.action.toggleDevTools'))
    }

    private async handleMarkdown(document: vscode.TextDocument, handler: Handler, folderPath: vscode.Uri) {

        const uri = document.uri;
        const webview = handler.panel.webview;

        let content = document.getText();
        const contextUri = extensionResource(this.context, 'resource', 'markdown');
        const rootPath = webview.asWebviewUri(contextUri).toString();

        Holder.activeDocument = document;
        handler.panel.onDidChangeViewState(e => {
            Holder.activeDocument = e.webviewPanel.visible ? document : Holder.activeDocument
            if (e.webviewPanel.visible) {
                this.updateCount(content)
                this.countStatus?.show()
            } else {
                this.countStatus?.hide()
            }
        });

        const documentSync = new MarkdownDocumentSync(nextContent => this.updateTextDocument(document, nextContent));
        let documentSyncTimer: ReturnType<typeof setTimeout> | undefined;
        let pendingDocumentSync: string | undefined;
        const flushDocumentSync = async () => {
            if (documentSyncTimer) {
                clearTimeout(documentSyncTimer);
                documentSyncTimer = undefined;
            }
            if (pendingDocumentSync === undefined) {
                return;
            }
            const nextContent = pendingDocumentSync;
            pendingDocumentSync = undefined;
            await documentSync.update(nextContent);
        };
        const scheduleDocumentSync = (newContent: string) => {
            pendingDocumentSync = newContent;
            content = newContent;
            this.updateCount(content);
            if (documentSyncTimer) {
                clearTimeout(documentSyncTimer);
            }
            // Debounce to avoid triggering VS Code built-in mermaid-markdown-features
            // re-parsing on every keystroke (ANTLR token recognition errors in console).
            documentSyncTimer = setTimeout(() => void flushDocumentSync(), 400);
        };
        const config = vscode.workspace.getConfiguration("vssm-md");
        registerMarkdownWebview(uri, handler);
        handler.panel.onDidDispose(() => {
            void flushDocumentSync();
            unregisterMarkdownWebview(uri);
        });
        handler.on("init", async () => {
            const viewerSettings = await ViewerSettingsService.loadForWebview();
            const workspaceUri = this.getWorkspaceUriByFileUtil(uri);
            handler.emit("open", {
                content, rootPath,
                workspaceBaseUrl: workspaceUri ? webview.asWebviewUri(workspaceUri).toString().replace(/\?.+$/, '') : '',
                documentCacheId: `${uri.scheme}:${uri.toString()}`,
                pendingFragment: consumePendingBlockScroll(uri),
                pendingSourceLine: consumePendingSourceLine(uri),
                shouldRestoreFocus: config.get<boolean>("restoreViewState", false),
                config: this.getMarkdownWebviewConfig(config),
                viewerSettings,
            })
            this.updateCount(content)
            this.countStatus?.show()
        }).on("externalUpdate", e => {
            const updatedText = e.document.getText()?.replace(/\r/g, '');
            // A delayed writeback can arrive after the webview has already sent newer edits.
            // Echoing it back would replace the editor DOM and reset the cursor.
            if (documentSync.isWriteback(updatedText) || content == updatedText) return;
            content = updatedText;
            this.updateCount(content)
            handler.emit("update", updatedText)
        }).on("command", (command) => {
            vscode.commands.executeCommand(command)
        }).on("openLink", async (linkUri: string) => {
            if (linkUri.startsWith('wiki:')) {
                const error = await openWikiLink(uri, linkUri);
                if (error) handler.emit('openLinkError', error);
                return;
            }
            const localUri = parseWebviewResourceUri(linkUri, uri);
            if (localUri) {
                const error = await openLinkedFile(localUri);
                if (error) handler.emit('openLinkError', error);
            } else {
                vscode.env.openExternal(vscode.Uri.parse(linkUri));
            }
        }).on("codeMirrorTheme", (theme: string) => {
            const validThemes = [
                "Auto", "default",
                "Github", "Solarized Light", "Material Light", "Quiet Light", "One Light",
                "Dracula", "Monokai", "One Dark", "Solarized Dark", "Material Dark",
            ];
            if (validThemes.includes(theme)) {
                Global.updateConfig("codeMirrorTheme", theme === "default" ? "Auto" : theme);
            }
        }).on("editorTheme", (theme: string) => {
            const validThemes = [
                "Auto", "Light", "Solarized", "Warm Light", "Dim Light",
                "One Dark", "Github Dark", "Nord", "Monokai", "Dracula",
            ];
            if (validThemes.includes(theme)) {
                Global.updateConfig("editorTheme", theme);
            }
        }).on("mermaidTheme", (theme: string) => {
            const validThemes = [
                "Auto", "Light", "Forest", "Ocean", "Sunset",
                "Dark", "Dracula", "Monokai", "Nord",
            ];
            if (validThemes.includes(theme)) {
                Global.updateConfig("mermaidTheme", theme);
            }
        }).on("editMode", (mode: string) => {
            if (mode === "wysiwyg" || mode === "ir") {
                Global.updateConfig("editMode", mode);
            }
        }).on("img", async (payload) => {
            const imgData: string = typeof payload === 'string' ? payload : payload.data;
            const ext: string = typeof payload === 'string' ? 'png' : (payload.ext || 'png');
            const sourceName: string | undefined = typeof payload === 'string' ? undefined : payload.name;
            const imageMarkdown = await this.saveImageAndBuildMarkdown(uri, imgData, ext, {
                sourceName,
                documentContent: content,
            });
            if (imageMarkdown) {
                handler.emit('insertImageMarkdown', imageMarkdown);
            }
        }).on("imgUrl", async (url: string) => {
            if (!/^https?:\/\//i.test(url || '')) {
                return;
            }
            const imageMarkdown = await this.saveWebImageAndBuildMarkdown(uri, url, content);
            if (imageMarkdown) {
                handler.emit('insertImageMarkdown', imageMarkdown);
            } else {
                // 下载失败时回退为原样插入 URL，避免粘贴内容凭空丢失
                handler.emit('insertImageMarkdown', url);
            }
        }).on("insertImage", async () => {
            const files = await vscode.window.showOpenDialog({
                canSelectMany: false,
                filters: { Images: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'] },
                title: i18n('ext.markdown.selectImage'),
            });
            if (!files || files.length === 0) return;
            const sourceUri = files[0];
            const ext = parse(sourceUri.fsPath).ext.replace('.', '').toLowerCase() || 'png';
            if (!getImageRuleConfig().applyToLocal) {
                // 不对本地图片应用规则：不复制，直接引用原位置
                const ref = buildImageReferencePath(uri, sourceUri.fsPath);
                handler.emit('insertImageMarkdown', `![${parse(sourceUri.fsPath).name}](${ref})`);
                return;
            }
            const fileBytes = await vscode.workspace.fs.readFile(sourceUri);
            const imageMarkdown = await this.saveImageAndBuildMarkdown(uri, fileBytes, ext, {
                sourceName: parse(sourceUri.fsPath).base,
                documentContent: content,
            });
            if (imageMarkdown) {
                handler.emit('insertImageMarkdown', imageMarkdown);
            }
        }).on("imageSettings", async (patch: Record<string, unknown>) => {
            if (!patch || typeof patch !== 'object') return;
            for (const key of IMAGE_CONFIG_KEYS) {
                if (patch[key] !== undefined) {
                    await Global.updateConfig(`image.${key}`, patch[key]);
                }
            }
            handler.emit('markdownConfig', { imageRules: MarkdownEditorProvider.buildImageRules() });
        }).on("deleteImageFile", (src: string) => {
            void this.deleteLocalImageFile(uri, src);
        }).on("editInVSCode", async (payload: boolean | { full?: boolean; line?: number | null }) => {
            cancelWebviewSwitchFallback();
            const full = typeof payload === "object" && payload !== null ? payload.full !== false : !!payload;
            const line = typeof payload === "object" && payload !== null ? payload.line : undefined;
            // 先把 webview 的最新内容落盘，避免源码编辑器打开旧文本
            await flushDocumentSync();
            const side = full ? vscode.ViewColumn.Active : vscode.ViewColumn.Beside;
            await vscode.commands.executeCommand('vscode.openWith', uri, "default", side);
            if (typeof line === "number" && line >= 1) {
                revealTextEditorLine(uri, line);
            }
        }).on("showInFolder", () => {
            if (vscode.env.uiKind !== vscode.UIKind.Web) {
                vscode.commands.executeCommand('revealFileInOS', uri);
            }
        }).on("save", (newContent) => {
            scheduleDocumentSync(newContent);
        }).on("doSave", async (saveContent) => {
            pendingDocumentSync = saveContent;
            content = saveContent;
            await flushDocumentSync();
            this.updateCount(content);
            vscode.commands.executeCommand('workbench.action.files.save');
        }).on("export", (option) => {
            vscode.commands.executeCommand('workbench.action.files.save');
            new MarkdownService(this.context).exportMarkdown(uri, option)
        }).on('developerTool', () => {
            vscode.commands.executeCommand('workbench.action.toggleDevTools')
        }).on('openAbout', () => {
        }).on('openSponsor', () => {
            vscode.commands.executeCommand(
                'workbench.extensions.action.showExtensionsWithIds',
                ['cweijan.vscode-database-client2'],
            );
        }).on('openExternal', (url: string) => {
            if (url) {
                vscode.env.openExternal(vscode.Uri.parse(url));
            }
        }).on('queryAIAvailable', () => {
            void this.notifyAIAvailable(handler);
        }).on('queryVSCodeModels', async () => {
            const lm = (vscode as any).lm;
            if (typeof lm?.selectChatModels !== 'function') {
                handler.emit('vscodeModels', []);
                return;
            }
            try {
                const models: any[] = await lm.selectChatModels();
                handler.emit('vscodeModels', (models ?? []).map((m: any) => ({
                    id: m.id,
                    name: m.name,
                    family: m.family,
                    vendor: m.vendor,
                })));
            } catch {
                handler.emit('vscodeModels', []);
            }
        }).on('aiPolish', async (payload: { markdown: string; options?: any }) => {
            await this.handleAIPolish(handler, payload.markdown, payload.options);
        }).on('aiPolishCancel', () => {
            this.cancelAIPolish();
        }).on('telemetry', (payload: { event: string; properties?: Record<string, string | number | boolean> }) => {
            const properties = {
                ...this.getMarkdownTelemetryProps(),
                ...Object.fromEntries(
                    Object.entries(payload.properties ?? {}).map(([key, value]) => [key, String(value)]),
                ),
            };
            TelemetryService.get()?.trackEvent(payload.event, properties);
        }).on('syncViewerSettings', async (settings) => {
            if (await ViewerSettingsService.exists()) {
                await ViewerSettingsService.writeFromVditor(settings);
            }
        }).on('editViewerSettings', async (settings) => {
            await ViewerSettingsService.createAndOpen(settings);
        })

        const basePath = Global.getConfig('workspacePathAsImageBasePath') ?
            vscode.Uri.file(getWorkspacePath(folderPath)) : folderPath;
        const baseUrl = webview.asWebviewUri(basePath).toString().replace(/\?.+$/, '').replace('https://git', 'https://file');
        const indexHtml = await readExtensionText(this.context, 'resource', 'markdown', 'index.html');
        webview.html = Util.buildPath(
            indexHtml.replace("{{baseUrl}}", baseUrl), webview, contextUri
        );
    }

    private cancelAIPolish() {
        this.aiCancellationSource?.cancel();
        this.aiAbortController?.abort();
    }

    private async notifyAIAvailable(handler: Handler) {
        const lm = (vscode as any).lm;
        const available = typeof lm?.selectChatModels === 'function';
        handler.emit('aiAvailable', available);
    }

    private buildPolishPrompt(markdown: string, options?: any): string {
        const parts: string[] = [];
        parts.push('You are a writing assistant.');
        if (options?.prompt) {
            parts.push(options.prompt);
        } else {
            parts.push('Polish the following Markdown text: improve clarity, fix grammar, and enhance readability.');
        }
        if (options?.goal) {
            parts.push(`Focus on: ${options.goal}`);
        }
        parts.push(buildAIOutputLanguageInstruction(options?.outputLanguage, options?.uiLanguage));
        parts.push('Return ONLY the polished Markdown with no extra commentary.\n\n' + markdown);
        return parts.join('\n');
    }

    private async handleAIPolish(handler: Handler, markdown: string, options?: any) {
        const engine = options?.engine ?? 'vscode';

        this.cancelAIPolish();
        this.aiCancellationSource = new vscode.CancellationTokenSource();
        this.aiAbortController = new AbortController();

        if (engine === 'custom') {
            await this.handleCustomAIPolish(handler, markdown, options);
            return;
        }

        const lm = (vscode as any).lm;
        if (typeof lm?.selectChatModels !== 'function') {
            vscode.window.showWarningMessage(i18n('ext.markdown.aiRequiresVscode'));
            handler.emit('aiPolishResult', markdown);
            return;
        }
        try {
            let model: any;
            if (options?.vscodeModelId) {
                const all: any[] = await lm.selectChatModels();
                model = all?.find((m: any) => m.id === options.vscodeModelId);
            }
            if (!model) {
                let models: any[] = await lm.selectChatModels({ family: 'gpt-4o' });
                if (!models || models.length === 0) {
                    models = await lm.selectChatModels();
                }
                if (!models || models.length === 0) {
                    vscode.window.showWarningMessage(i18n('ext.markdown.noAiModel'));
                    handler.emit('aiPolishEnd');
                    return;
                }
                model = models[0];
            }
            const LanguageModelChatMessage = (vscode as any).LanguageModelChatMessage;
            const messages = [LanguageModelChatMessage.User(this.buildPolishPrompt(markdown, options))];
            const token = this.aiCancellationSource.token;
            const response = await model.sendRequest(messages, {}, token);
            for await (const chunk of response.text) {
                if (token.isCancellationRequested) break;
                handler.emit('aiPolishChunk', chunk);
            }
            if (!token.isCancellationRequested) {
                handler.emit('aiPolishEnd');
            }
        } catch (err: any) {
            if (this.aiCancellationSource?.token.isCancellationRequested) return;
            vscode.window.showErrorMessage(i18n('ext.markdown.aiPolishFailed', String(err?.message ?? err)));
            handler.emit('aiPolishEnd');
        }
    }

    private async handleCustomAIPolish(handler: Handler, markdown: string, options: any) {
        const url = options?.customUrl?.trim();
        if (!url) {
            vscode.window.showWarningMessage(i18n('ext.markdown.customAiUrlRequired'));
            handler.emit('aiPolishResult', markdown);
            return;
        }
        try {
            await streamCustomAI({
                url,
                apiKey: options?.customKey?.trim(),
                model: options?.customModel?.trim(),
                format: options?.customApiFormat,
                prompt: this.buildPolishPrompt(markdown, options),
                signal: this.aiAbortController?.signal,
                onChunk: (chunk: string) => {
                    handler.emit('aiPolishChunk', chunk);
                },
            });
            handler.emit('aiPolishEnd');
        } catch (err: any) {
            if (err?.name === 'AbortError') return;
            vscode.window.showErrorMessage(i18n('ext.markdown.customAiPolishFailed', String(err?.message ?? err)));
            handler.emit('aiPolishEnd');
        }
    }

    private static buildImageRules() {
        const cfg = getImageRuleConfig();
        return { applyToLocal: cfg.applyToLocal, applyToWeb: cfg.applyToWeb, insertAction: cfg.insertAction };
    }

    private getMarkdownWebviewConfig(configuration: vscode.WorkspaceConfiguration) {
        const markdownConfiguration = vscode.workspace.getConfiguration("markdown");
        const imageConfig = getImageRuleConfig();
        return {
            editMode: configuration.get<string>("editMode", "wysiwyg"),
            editorTheme: configuration.get<string>("editorTheme", "Auto"),
            codeMirrorTheme: configuration.get<string>("codeMirrorTheme", "Auto"),
            mermaidTheme: configuration.get<string>("mermaidTheme", "Auto"),
            preventMacOptionKey: configuration.get<boolean>("preventMacOptionKey", true),
            imageRules: {
                applyToLocal: imageConfig.applyToLocal,
                applyToWeb: imageConfig.applyToWeb,
            },
            imageSettings: imageConfig,
            markdown: {
                math: {
                    macros: markdownConfiguration.get<Record<string, string>>("math.macros", {}),
                },
            },
            language: vscode.env.language,
            isWeb: this.options.isWeb,
            isDev: this.context.extensionMode === vscode.ExtensionMode.Development,
        };
    }

    private async saveImageAndBuildMarkdown(
        documentUri: vscode.Uri,
        imageData: string | Uint8Array,
        ext: string,
        options?: { sourceName?: string; documentContent?: string },
    ): Promise<string | undefined> {
        const bytes = typeof imageData === 'string'
            ? Uint8Array.from(Buffer.from(imageData, 'binary'))
            : imageData;
        const plan = resolveImageInsertPlan({
            documentUri,
            documentContent: options?.documentContent,
            sourceName: options?.sourceName,
            ext,
        });

        if (plan.kind === 'none') {
            return undefined;
        }
        if (plan.kind === 'legacy') {
            return this.saveImageLegacy(documentUri, bytes, ext);
        }
        if (plan.kind === 'upload') {
            const uploaded = await this.uploadImageToServer(plan.server, bytes, plan.fileName);
            if (uploaded) {
                const name = parse(plan.fileName).name;
                return `![${name}](${escapeReferenceUrl(uploaded)})`;
            }
            vscode.window.showWarningMessage(i18n('ext.markdown.imageUploadFailed'));
            // 上传失败回退到按文档命名目录落盘，保证图片不丢
            const fallbackDir = join(dirname(documentUri.fsPath), `${parse(documentUri.fsPath).name}.assets`);
            return this.saveImageCopy(documentUri, bytes, ext, fallbackDir, buildImageFileName(options?.sourceName, ext));
        }
        return this.saveImageCopy(documentUri, bytes, ext, plan.targetDir, plan.fileName);
    }

    private async saveImageCopy(
        documentUri: vscode.Uri,
        bytes: Uint8Array,
        ext: string,
        targetDir: string,
        fileName: string,
    ): Promise<string> {
        const imagePath = join(targetDir, fileName).replace(/\\/g, '/');
        const imageUri = vscode.Uri.file(imagePath);
        await ensureParentDirectory(imageUri);
        await vscode.workspace.fs.writeFile(imageUri, bytes);
        const ref = await MarkdownService.imgExtGuide(imagePath, buildImageReferencePath(documentUri, imagePath));
        return buildImageMarkdown(imagePath, ref);
    }

    private async saveImageLegacy(
        documentUri: vscode.Uri,
        bytes: Uint8Array,
        ext: string,
    ): Promise<string> {
        const { relPath, fullPath } = adjustImgPath(documentUri, ext);
        const imagePath = isAbsolute(fullPath) ? fullPath : `${resolve(documentUri.fsPath, "..")}/${relPath}`.replace(/\\/g, "/");
        const imageUri = vscode.Uri.file(imagePath);
        await ensureParentDirectory(imageUri);
        await vscode.workspace.fs.writeFile(imageUri, bytes);
        const fileName = parse(relPath).name;
        const adjustRelPath = await MarkdownService.imgExtGuide(imagePath, relPath);
        return `![${fileName}](${adjustRelPath})`;
    }

    /** 删除图片引用对应的落盘文件：仅本地路径、限工作区边界内，桌面端进回收站 */
    private async deleteLocalImageFile(documentUri: vscode.Uri, src: string): Promise<void> {
        if (!src || /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//') || src.startsWith('#')) {
            return; // 远程/内联/协议地址无对应落盘文件
        }
        const candidates = [src];
        try {
            const decoded = decodeURIComponent(src);
            if (decoded !== src) {
                candidates.push(decoded);
            }
        } catch {
            // 保留原始形式
        }
        for (const candidate of candidates) {
            const imageUri = this.resolveLocalImageUri(documentUri, candidate);
            if (!imageUri) {
                continue;
            }
            try {
                await vscode.workspace.fs.stat(imageUri);
            } catch {
                continue;
            }
            try {
                await vscode.workspace.fs.delete(imageUri, { useTrash: !this.options.isWeb });
            } catch (err: any) {
                vscode.window.showWarningMessage(i18n('ext.markdown.imageDeleteFailed', String(err?.message ?? err)));
                return;
            }
            await this.removeEmptyImageDirs(imageUri, documentUri);
            return;
        }
    }

    /** 把文档内的图片引用解析为工作区边界内的绝对路径；无法安全解析时返回 undefined */
    private resolveLocalImageUri(documentUri: vscode.Uri, src: string): vscode.Uri | undefined {
        const docDir = dirname(documentUri.fsPath);
        const reference = src.replace(/\\/g, '/');
        const workspacePath = getWorkspacePath(documentUri);
        let absolute: string;
        if (isAbsolute(reference)) {
            absolute = reference;
        } else if (reference.startsWith('/')) {
            // ${workspaceDir} 模板的引用形式：相对工作区根
            if (!workspacePath) {
                return undefined;
            }
            absolute = `${workspacePath}/${reference.replace(/^\/+/, '')}`;
        } else {
            absolute = `${docDir}/${reference}`;
        }
        const normalized = normalize(absolute);
        const boundary = normalize(workspacePath ?? docDir);
        const rel = relative(boundary, normalized);
        if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
            return undefined;
        }
        return vscode.Uri.file(normalized);
    }

    /** 图片删除后向上清理空目录（止步于文档目录或工作区根） */
    private async removeEmptyImageDirs(imageUri: vscode.Uri, documentUri: vscode.Uri): Promise<void> {
        const docDir = normalize(dirname(documentUri.fsPath));
        const workspacePath = getWorkspacePath(documentUri);
        const boundary = normalize(workspacePath ?? docDir);
        let dir = normalize(dirname(imageUri.fsPath));
        while (true) {
            const rel = relative(boundary, dir);
            if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
                break;
            }
            let entries: [string, vscode.FileType][];
            try {
                entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dir));
            } catch {
                break;
            }
            if (entries.length > 0) {
                break;
            }
            try {
                await vscode.workspace.fs.delete(vscode.Uri.file(dir));
            } catch {
                break;
            }
            dir = dirname(dir);
        }
    }

    /** 网络图片按规则落盘；下载失败返回 undefined（调用方回退为原样插入 URL） */    private async saveWebImageAndBuildMarkdown(
        documentUri: vscode.Uri,
        url: string,
        documentContent: string,
    ): Promise<string | undefined> {
        if (!getImageRuleConfig().applyToWeb) {
            return undefined;
        }
        const fetched = await this.downloadWebImage(url);
        if (!fetched) {
            return undefined;
        }
        return this.saveImageAndBuildMarkdown(documentUri, fetched.bytes, fetched.ext, {
            sourceName: fetched.name,
            documentContent,
        });
    }

    private async downloadWebImage(url: string): Promise<{ bytes: Uint8Array; ext: string; name?: string } | undefined> {
        if (typeof fetch !== 'function') {
            return undefined;
        }
        try {
            const response = await fetch(url, {
                signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined,
            });
            if (!response.ok) {
                return undefined;
            }
            const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
            const buffer = Buffer.from(await response.arrayBuffer());
            if (contentType && !contentType.startsWith('image/')) {
                return undefined;
            }
            if (buffer.length === 0 || buffer.length > 20 * 1024 * 1024) {
                return undefined;
            }
            const typeExt: Record<string, string> = {
                'image/jpeg': 'jpg',
                'image/png': 'png',
                'image/gif': 'gif',
                'image/webp': 'webp',
                'image/svg+xml': 'svg',
                'image/bmp': 'bmp',
                'image/x-icon': 'ico',
            };
            const ext = typeExt[contentType] || 'png';
            let name: string | undefined;
            try {
                name = decodeURIComponent(new URL(url).pathname.split('/').pop() || '') || undefined;
            } catch {
                name = undefined;
            }
            return { bytes: new Uint8Array(buffer), ext, name };
        } catch {
            return undefined;
        }
    }

    private async uploadImageToServer(server: string, bytes: Uint8Array, fileName: string): Promise<string | undefined> {
        if (this.options.isWeb || typeof fetch !== 'function') {
            return undefined;
        }
        const tmpPath = join(tmpdir(), fileName).replace(/\\/g, '/');
        try {
            writeFileSync(tmpPath, bytes);
            const response = await fetch(server, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ list: [tmpPath] }),
                signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined,
            });
            const result = await response.json() as { success?: boolean; result?: string[] };
            if (result?.success && Array.isArray(result.result) && result.result[0]) {
                return result.result[0];
            }
            return undefined;
        } catch {
            return undefined;
        } finally {
            try {
                rmSync(tmpPath, { force: true });
            } catch {
                // ignore
            }
        }
    }

    private updateCount(content: string) {
        if (!this.countStatus) {
            return;
        }
        this.countStatus.text = i18n('ext.markdown.statusBar', String(content.split(/\r\n|\r|\n/).length), String(content.length))
    }

    private updateTextDocument(document: vscode.TextDocument, content: string) {
        const normalized = content.replace(/\r/g, '');
        if (document.getText().replace(/\r/g, '') === normalized) {
            return Promise.resolve(true);
        }
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), normalized);
        return vscode.workspace.applyEdit(edit);
    }

}
