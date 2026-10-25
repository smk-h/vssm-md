const joinSegments = (parts: string[]) => parts.filter(Boolean).join('/').replace(/\/+/g, '/');

export const sep = '/';
export const posix = { sep: '/' as const };

export function basename(path: string, ext?: string) {
    const name = joinSegments(path.split(/[/\\]/)).split('/').pop() ?? '';
    if (ext && name.endsWith(ext)) {
        return name.slice(0, -ext.length);
    }
    return name;
}

export function extname(path: string) {
    const base = basename(path);
    const dot = base.lastIndexOf('.');
    return dot >= 0 ? base.slice(dot) : '';
}

export function dirname(path: string) {
    const parts = joinSegments(path.split(/[/\\]/)).split('/');
    parts.pop();
    return parts.join('/') || '.';
}

export function join(...segments: string[]) {
    return joinSegments(segments.flatMap((segment) => segment.split(/[/\\]/)));
}

export function resolve(...segments: string[]) {
    const resolved = segments.flatMap((segment) => segment.split(/[/\\]/));
    const absolute = segments[0]?.startsWith('/');
    const stack: string[] = [];
    for (const part of resolved) {
        if (!part || part === '.') {
            continue;
        }
        if (part === '..') {
            stack.pop();
            continue;
        }
        stack.push(part);
    }
    const result = stack.join('/');
    return absolute ? `/${result}` : result || '.';
}

export function isAbsolute(path: string) {
    return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path);
}

export function parse(path: string) {
    const base = basename(path);
    const dot = base.lastIndexOf('.');
    const ext = dot >= 0 ? base.slice(dot) : '';
    const name = dot >= 0 ? base.slice(0, dot) : base;
    return {
        root: '',
        dir: dirname(path),
        base,
        ext,
        name,
    };
}

export function relative(from: string, to: string) {
    const fromParts = joinSegments(from.split(/[/\\]/)).split('/').filter(Boolean);
    const toParts = joinSegments(to.split(/[/\\]/)).split('/').filter(Boolean);
    while (fromParts.length && toParts.length && fromParts[0] === toParts[0]) {
        fromParts.shift();
        toParts.shift();
    }
    return [...fromParts.map(() => '..'), ...toParts].join('/') || '.';
}

/** Node 语义的 path.normalize：收敛分隔符并解析 . / .. 段 */
export function normalize(path: string) {
    const trailingSep = /[/\\]$/.test(path);
    const segments = path.split(/[/\\]/);
    const head = segments[0] === '' || /^[A-Za-z]:$/.test(segments[0] ?? '') ? segments.shift()! : '';
    const stack: string[] = [];
    for (const part of segments) {
        if (!part || part === '.') continue;
        if (part === '..') {
            if (stack.length && stack[stack.length - 1] !== '..') {
                stack.pop();
            } else if (!head) {
                stack.push(part);
            }
            continue;
        }
        stack.push(part);
    }
    const joined = stack.join('/');
    let result = head ? `${head}/${joined}` : (joined || '.');
    if (trailingSep && joined) {
        result += '/';
    }
    return result;
}

export default {
    sep,
    posix,
    basename,
    dirname,
    join,
    resolve,
    isAbsolute,
    parse,
    relative,
    extname,
    normalize,
};
