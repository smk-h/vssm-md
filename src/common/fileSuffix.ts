import { extname } from 'path';

export function getFileSuffix(fsPath: string): string {
	const lower = fsPath.toLowerCase();
	if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
		return '.tar.gz';
	}
	return extname(lower);
}

export function fileTypeFromPath(fsPath: string): string {
	const suffix = getFileSuffix(fsPath);
	return suffix.startsWith('.') ? suffix.slice(1) : suffix;
}
