import * as vscode from 'vscode';
import { Global } from './common/global';
import { TelemetryService } from './service/telemetryService';
import { MarkdownEditorProvider } from './provider/markdownEditorProvider';
import { MarkdownService } from './service/markdownService';
import { FileUtil } from './common/fileUtil';

export async function activate(context: vscode.ExtensionContext) {
	await Global.init(context);
	TelemetryService.init(context);
	FileUtil.init(context)
	const markdownService = new MarkdownService(context);
	const markdownEditorProvider = new MarkdownEditorProvider(context)
	const viewOption = { webviewOptions: { retainContextWhenHidden: true } };
	context.subscriptions.push(
		vscode.commands.registerCommand('office.markdown.switch', (uri) => { markdownService.switchEditor(uri) }),
		vscode.commands.registerCommand('office.markdown.paste', () => { markdownService.loadClipboardImage() }),
		vscode.window.registerCustomEditorProvider("cweijan.markdownViewer", markdownEditorProvider, viewOption),
		vscode.window.registerCustomEditorProvider("cweijan.markdownPreview", markdownEditorProvider, viewOption),
	);
}

export function deactivate() { }
