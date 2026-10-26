import * as vscode from 'vscode';
import { Handler } from '@/common/handler';

const pendingBlockScroll = new Map<string, string>();
const pendingSourceLines = new Map<string, number>();
const webviewHandlers = new Map<string, Handler>();

/** 按文件路径缓存 webview，忽略 query / fragment */
export function markdownUriKey(uri: vscode.Uri): string {
    return uri.with({ query: '', fragment: '' }).toString();
}

export function registerMarkdownWebview(uri: vscode.Uri, handler: Handler): void {
    webviewHandlers.set(markdownUriKey(uri), handler);
}

export function unregisterMarkdownWebview(uri: vscode.Uri): void {
    webviewHandlers.delete(markdownUriKey(uri));
}

export function getMarkdownWebviewHandler(uri: vscode.Uri): Handler | undefined {
    return webviewHandlers.get(markdownUriKey(uri));
}

export function setPendingBlockScroll(uri: vscode.Uri, fragment: string): void {
    pendingBlockScroll.set(markdownUriKey(uri), fragment);
}

export function consumePendingBlockScroll(uri: vscode.Uri): string | undefined {
    const key = markdownUriKey(uri);
    const fragment = pendingBlockScroll.get(key);
    if (fragment) {
        pendingBlockScroll.delete(key);
    }
    return fragment;
}

export function notifyBlockScroll(uri: vscode.Uri, fragment: string): void {
    const handler = getMarkdownWebviewHandler(uri);
    if (!handler) {
        setPendingBlockScroll(uri, fragment);
        return;
    }
    setTimeout(() => {
        handler.emit('gotoBlock', fragment);
    }, 150);
}

export function setPendingSourceLine(uri: vscode.Uri, line: number): void {
    pendingSourceLines.set(markdownUriKey(uri), line);
}

export function consumePendingSourceLine(uri: vscode.Uri): number | undefined {
    const key = markdownUriKey(uri);
    const line = pendingSourceLines.get(key);
    if (line !== undefined) {
        pendingSourceLines.delete(key);
    }
    return line;
}

/** 源码 -> 预览：把源码行交给 webview 滚动到对应块；webview 可能重载，故同时暂存行号供 init 消费 */
export function notifySourceLineScroll(uri: vscode.Uri, line: number): void {
    setPendingSourceLine(uri, line);
    const handler = getMarkdownWebviewHandler(uri);
    if (!handler) {
        return;
    }
    const key = markdownUriKey(uri);
    setTimeout(() => {
        handler.emit('gotoSourceLine', line);
        // webview 存活时消息即生效；若期间重载则由 init 消费 pending。
        // 兜底清掉残留，避免陈旧行号在之后的打开中误跳
        setTimeout(() => pendingSourceLines.delete(key), 1000);
    }, 150);
}

/** 预览 -> 源码：等待该文档的文本编辑器出现后，滚动并将光标放到指定行（1 基） */
export function revealTextEditorLine(uri: vscode.Uri, line: number, attempts = 20): void {
    const editor = vscode.window.visibleTextEditors.find(item => item.document.uri.toString() === uri.toString());
    if (editor) {
        const targetLine = Math.min(Math.max(0, line - 1), editor.document.lineCount - 1);
        const position = new vscode.Position(targetLine, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
        return;
    }
    if (attempts <= 0) {
        return;
    }
    setTimeout(() => revealTextEditorLine(uri, line, attempts - 1), 100);
}

let switchToSourceFallbackTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * 预览 -> 源码（标题栏图标入口）：让 webview 先计算锚点行并回发 editInVSCode，
 * 由统一链路完成落盘、打开与定位。返回 false 表示 webview 不可用，调用方需自行打开。
 */
export function requestWebviewSwitchToSource(uri: vscode.Uri): boolean {
    const handler = getMarkdownWebviewHandler(uri);
    if (!handler) {
        return false;
    }
    if (switchToSourceFallbackTimer) {
        clearTimeout(switchToSourceFallbackTimer);
    }
    // webview 可能被挂起无响应，兜底直接打开源码（不带位置）
    switchToSourceFallbackTimer = setTimeout(() => {
        switchToSourceFallbackTimer = undefined;
        vscode.commands.executeCommand('vscode.openWith', uri, 'default');
    }, 700);
    handler.emit('switchToSource');
    return true;
}

/** webview 已回发 editInVSCode，取消兜底打开 */
export function cancelWebviewSwitchFallback(): void {
    if (switchToSourceFallbackTimer) {
        clearTimeout(switchToSourceFallbackTimer);
        switchToSourceFallbackTimer = undefined;
    }
}

export function broadcastToMarkdownWebviews(event: string, content?: unknown): void {
    for (const handler of webviewHandlers.values()) {
        handler.emit(event, content);
    }
}
