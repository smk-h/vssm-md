import { dirname, isAbsolute, join, normalize, parse, relative, sep } from 'path';
import * as vscode from 'vscode';
import { Global } from '../common/global';
import { getWorkspacePath } from '../common/fileUtil';

/**
 * 图片插入规则引擎，行为对齐 Typora「图像」设置：
 * 按模式把粘贴/插入的图片落盘到指定目录，并按相对路径偏好生成引用。
 * 每文档可用 YAML front matter `typora-copy-images-to` 覆盖全局模式。
 */
export type ImageInsertAction =
    | 'legacy'
    | 'none'
    | 'currentFolder'
    | 'assetsFolder'
    | 'perFileAssets'
    | 'custom'
    | 'upload';

export interface ImageRuleConfig {
    insertAction: ImageInsertAction;
    customPath: string;
    applyToLocal: boolean;
    applyToWeb: boolean;
    allowYamlUpload: boolean;
    preferRelativePath: boolean;
    prefixDotSlash: boolean;
    escapeUrl: boolean;
    uploadServer: string;
}

export const IMAGE_CONFIG_DEFAULTS: ImageRuleConfig = {
    insertAction: 'legacy',
    customPath: './${filename}/img',
    applyToLocal: true,
    applyToWeb: true,
    allowYamlUpload: true,
    preferRelativePath: true,
    prefixDotSlash: true,
    escapeUrl: false,
    uploadServer: 'http://127.0.0.1:36677/upload',
};

export const getImageRuleConfig = (): ImageRuleConfig => ({
    insertAction: Global.getConfig<ImageInsertAction>('image.insertAction', IMAGE_CONFIG_DEFAULTS.insertAction),
    customPath: Global.getConfig<string>('image.customPath', IMAGE_CONFIG_DEFAULTS.customPath),
    applyToLocal: Global.getConfig<boolean>('image.applyToLocal', IMAGE_CONFIG_DEFAULTS.applyToLocal),
    applyToWeb: Global.getConfig<boolean>('image.applyToWeb', IMAGE_CONFIG_DEFAULTS.applyToWeb),
    allowYamlUpload: Global.getConfig<boolean>('image.allowYamlUpload', IMAGE_CONFIG_DEFAULTS.allowYamlUpload),
    preferRelativePath: Global.getConfig<boolean>('image.preferRelativePath', IMAGE_CONFIG_DEFAULTS.preferRelativePath),
    prefixDotSlash: Global.getConfig<boolean>('image.prefixDotSlash', IMAGE_CONFIG_DEFAULTS.prefixDotSlash),
    escapeUrl: Global.getConfig<boolean>('image.escapeUrl', IMAGE_CONFIG_DEFAULTS.escapeUrl),
    uploadServer: Global.getConfig<string>('image.uploadServer', IMAGE_CONFIG_DEFAULTS.uploadServer),
});

export type ImageInsertPlan =
    | { kind: 'legacy' }
    | { kind: 'none' }
    | { kind: 'copy'; targetDir: string; fileName: string }
    | { kind: 'upload'; server: string; fileName: string };

export interface ImagePlanInput {
    documentUri: vscode.Uri;
    /** 文档当前文本，用于解析 typora-copy-images-to 覆盖 */
    documentContent?: string;
    /** 源文件名（文件选择器/拖入文件携带），剪贴板位图数据无此值 */
    sourceName?: string;
    /** 源图片扩展名，缺省 png（后续 imgExtGuide 会按真实类型修正） */
    ext?: string;
}

const sanitizeName = (name: string) => name.replace(/[\\/:*?"<>|\r\n]+/g, '').trim();

/** 解析 YAML front matter 的 typora-copy-images-to（目录路径或 upload） */
export const parseCopyImagesTo = (content?: string): string | undefined => {
    if (!content) {
        return undefined;
    }
    const frontMatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!frontMatter) {
        return undefined;
    }
    const raw = frontMatter[1].match(/^typora-copy-images-to:\s*(.+?)\s*$/im)?.[1];
    if (!raw) {
        return undefined;
    }
    return raw.replace(/^["']|["']$/g, '').trim() || undefined;
};

const formatDateString = (now: Date) =>
    `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;

const expandTemplate = (template: string, docName: string, ext: string, documentUri: vscode.Uri) =>
    template
        .replace(/\$\{filename\}/g, docName)
        .replace(/\$\{workspaceDir\}/g, getWorkspacePath(documentUri) ?? '')
        .replace(/\$\{fileName\}/g, docName.replace(/\s/g, ''))
        .replace(/\$\{now\}/g, String(Date.now()))
        .replace(/\$\{date\}/g, formatDateString(new Date()))
        .replace(/\$\{uuid\}/g, crypto.randomUUID().replace(/-/g, ''))
        .replace(/\$\{ext\}/g, ext);

/** 生成落盘文件名：保留源文件名，剪贴板位图等无名数据用时间戳兜底 */
export const buildImageFileName = (sourceName: string | undefined, ext: string): string => {
    const base = sourceName ? sanitizeName(sourceName) : '';
    if (base) {
        return /\.[A-Za-z0-9]{1,8}$/.test(base) ? base : `${base}.${ext}`;
    }
    return `image-${Date.now()}.${ext}`;
};

export const resolveImageInsertPlan = (input: ImagePlanInput): ImageInsertPlan => {
    const cfg = getImageRuleConfig();
    const docName = sanitizeName(parse(input.documentUri.fsPath).name) || 'document';
    const ext = (input.ext || 'png').toLowerCase();

    let action = cfg.insertAction;
    let customPath = cfg.customPath;

    const yamlValue = parseCopyImagesTo(input.documentContent);
    if (yamlValue && action !== 'legacy') {
        if (yamlValue.toLowerCase() === 'upload') {
            if (cfg.allowYamlUpload) {
                action = 'upload';
            }
        } else {
            action = 'custom';
            customPath = yamlValue;
        }
    }

    if (action === 'legacy') {
        return { kind: 'legacy' };
    }
    if (action === 'none') {
        return { kind: 'none' };
    }
    if (action === 'upload') {
        return { kind: 'upload', server: cfg.uploadServer, fileName: buildImageFileName(input.sourceName, ext) };
    }

    const docDir = dirname(input.documentUri.fsPath);
    let targetDir: string;
    switch (action) {
        case 'currentFolder':
            targetDir = docDir;
            break;
        case 'assetsFolder':
            targetDir = join(docDir, 'assets');
            break;
        case 'perFileAssets':
            targetDir = join(docDir, `${docName}.assets`);
            break;
        default: {
            const expanded = expandTemplate(customPath, docName, ext, input.documentUri).replace(/[\\/]+$/, '');
            targetDir = isAbsolute(expanded) ? normalize(expanded) : normalize(join(docDir, expanded));
            break;
        }
    }
    return { kind: 'copy', targetDir, fileName: buildImageFileName(input.sourceName, ext) };
};

const escapeImageUrl = (url: string) =>
    encodeURI(url).replace(/#/g, '%23').replace(/\(/g, '%28').replace(/\)/g, '%29');

/**
 * 依据文档目录与偏好设置生成图片引用路径。
 * 目标在文档目录内 → 相对路径（可带 ./ 前缀）；否则绝对路径。escapeUrl 开启时做百分号转义。
 */
export const buildImageReferencePath = (documentUri: vscode.Uri, imagePath: string): string => {
    const cfg = getImageRuleConfig();
    const docDir = dirname(documentUri.fsPath);
    const rel = relative(docDir, imagePath);
    let ref: string;
    if (cfg.preferRelativePath && rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)) {
        const posix = rel.split(sep).join('/');
        ref = cfg.prefixDotSlash ? `./${posix}` : posix;
    } else {
        ref = imagePath.split(sep).join('/');
    }
    return cfg.escapeUrl ? escapeImageUrl(ref) : ref;
};

/** 上传/网络图片等远程 URL 的引用，仅做转义处理 */
export const escapeReferenceUrl = (url: string): string =>
    getImageRuleConfig().escapeUrl ? escapeImageUrl(url) : url;

export const buildImageMarkdown = (imagePath: string, refPath: string) =>
    `![${parse(imagePath).name}](${refPath})`;
