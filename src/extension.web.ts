/**
 * Web extension host entry (`package.json#browser`), markdown editor only.
 */
import * as vscode from 'vscode';
import { Global } from './common/global';
import { FileUtil } from './common/fileUtil';
import { setExtensionHostContext } from './common/extensionHost';
import { MarkdownEditorProvider } from './provider/markdownEditorProvider';
import { MarkdownService } from './service/markdownService';
import { TelemetryService } from './service/telemetryService';

export async function activate(context: vscode.ExtensionContext) {
	setExtensionHostContext();
	await Global.init(context);
	TelemetryService.init(context);
	FileUtil.init(context);

	const viewOption = { webviewOptions: { retainContextWhenHidden: true } };
	const markdownService = new MarkdownService(context);
	const markdownEditorProvider = new MarkdownEditorProvider(context, { isWeb: true });

	context.subscriptions.push(
		vscode.commands.registerCommand('vssm-md.markdown.switch', (uri) => { markdownService.switchEditor(uri); }),
		vscode.window.registerCustomEditorProvider('cweijan.markdownViewer', markdownEditorProvider, viewOption),
		vscode.window.registerCustomEditorProvider('cweijan.markdownPreview', markdownEditorProvider, viewOption),
	);
}

export function deactivate() { }
