#!/usr/bin/env node
/**
 * @file 浏览器直开 Markdown 编辑器的预览服务器（与 VS Code webview 渲染同源同构）
 * @module test/web-preview/server
 * @usage node test/web-preview/server.mjs [port]   # 默认 3177，然后浏览器打开 http://127.0.0.1:3177
 * @details
 *   VS Code 插件把 resource/markdown/index.html 装进 webview，由扩展宿主通过
 *   postMessage 发送 open 消息（内容 + 配置）驱动编辑器。本脚本用纯 Node http 复刻该环境：
 *
 *   1. 以 resource/ 为根静态伺服（index.html 里的 {{baseUrl}} 改写为 /markdown）；
 *   2. 伺服 index.html 时注入 inject/ 下的垫片：
 *      - inject/editor-shim.js 提供 window.acquireVsCodeApi（注意大小写与真实 API 一致），
 *        让 lib/vscode.js 的 handler.emit 能 postMessage 到父窗口（浏览器里原逻辑拿不到
 *        vscode API，emit 是空操作）；
 *      - inject/preview-theme.css 提供一组默认 --vscode-* 主题变量（?theme=dark|light
 *        切换），替代 webview 自动注入的主题；
 *   3. 根路径 "/" 返回 host/host.html：左侧是 test/markdown 的目录浏览器（/api/tree），
 *      点击文件拉取内容（/api/file）驱动编辑器渲染；右侧 iframe 加载真实编辑器页。
 *      编辑产生的 save/doSave 事件防抖写回磁盘文件（POST /api/file），
 *      其余宿主事件（导出、editInVSCode、插入图片等）以顶栏日志呈现或做轻量模拟。
 *      宿主页静态资源伺服于 /preview/host/*。
 *
 *   好处：改 vditor 源码后只需在 vditor/ 下 npm run build（产物自动拷入
 *   resource/markdown/dist），刷新浏览器即见效果，不再打包安装 VSIX。
 */
import http from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const REPO = resolve(HERE, '..', '..');
const ROOT = resolve(REPO, 'resource');
const TEST_DIR = resolve(REPO, 'test', 'markdown');
const HOST_DIR = join(HERE, 'host');
const INJECT_DIR = join(HERE, 'inject');
const SAMPLE_MD = readFileSync(join(HERE, 'sample.md'), 'utf8');
const PORT = Number(process.argv[2] || process.env.WEB_PREVIEW_PORT || 3177);

const TEXT_EXT = new Set(['.md', '.markdown', '.txt']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
};

/** 编辑器页 <head> 注入：主题变量 + VS Code API 垫片（?theme=light 可切浅色） */
const HEAD_INJECT = `
<style>${readFileSync(join(INJECT_DIR, 'preview-theme.css'), 'utf8')}</style>
<script>${readFileSync(join(INJECT_DIR, 'editor-shim.js'), 'utf8')}</script>`;

/* ---------- 文件 API（限 test/markdown 内） ---------- */
const json = (res, status, payload) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
};

const resolveInside = (relative) => {
  const target = normalize(resolve(TEST_DIR, '.' + sep + relative));
  return target.startsWith(TEST_DIR + sep) || target === TEST_DIR ? target : null;
};

const listDir = (dir, base) => {
  const children = [];
  for (const name of readdirSync(dir).sort((a, b) => a.localeCompare(b, 'zh-CN'))) {
    if (name.startsWith('.')) continue;
    const full = join(dir, name);
    const rel = base ? base + '/' + name : name;
    const stat = statSync(full);
    if (stat.isDirectory()) {
      children.push({ type: 'dir', name, path: rel, children: listDir(full, rel) });
    } else if (TEXT_EXT.has(extname(name).toLowerCase())) {
      children.push({ type: 'file', name, path: rel });
    }
  }
  children.sort((a, b) => (a.type === b.type ? 0 : a.type === 'dir' ? -1 : 1));
  return children;
};

const readBody = (req) => new Promise((resolveBody) => {
  let data = '';
  req.on('data', (chunk) => { data += chunk; });
  req.on('end', () => resolveBody(data));
});

const handleApi = async (req, res, url) => {
  const rel = url.searchParams.get('p') || '';
  if (url.pathname === '/api/tree') {
    if (!existsSync(TEST_DIR)) return json(res, 200, { children: [] });
    return json(res, 200, { type: 'dir', name: 'test/markdown', children: listDir(TEST_DIR, '') });
  }
  if (url.pathname === '/api/file') {
    const target = resolveInside(rel);
    if (!target) return json(res, 400, { error: '非法路径: ' + rel });
    if (req.method === 'GET') {
      if (!existsSync(target) || !statSync(target).isFile()) return json(res, 404, { error: '文件不存在: ' + rel });
      return json(res, 200, { content: readFileSync(target, 'utf8') });
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, body, 'utf8');
      return json(res, 200, { ok: true });
    }
    if (req.method === 'DELETE') {
      if (!existsSync(target)) return json(res, 404, { error: '文件不存在: ' + rel });
      rmSync(target);
      return json(res, 200, { ok: true });
    }
  }
  return json(res, 404, { error: '未知接口' });
};

const serveFile = (res, filePath) => {
  const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  createReadStream(filePath).pipe(res);
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(readFileSync(join(HOST_DIR, 'host.html'), 'utf8'));
      return;
    }
    if (url.pathname === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    if (url.pathname.startsWith('/preview/')) {
      const relative = decodeURIComponent(url.pathname).replace(/^\/preview\//, '');
      const filePath = normalize(join(HERE, relative));
      if (!filePath.startsWith(HERE) || !existsSync(filePath) || !statSync(filePath).isFile()) {
        return json(res, 404, { error: 'Not Found: ' + url.pathname });
      }
      serveFile(res, filePath);
      return;
    }
    let relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const filePath = normalize(join(ROOT, relative));
    if (!filePath.startsWith(ROOT) || !existsSync(filePath) || !statSync(filePath).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found: ' + url.pathname);
      return;
    }
    if (filePath.endsWith(join('markdown', 'index.html'))) {
      const html = readFileSync(filePath, 'utf8')
        .replace('{{baseUrl}}', '/markdown')
        .replace('</head>', HEAD_INJECT + '\n</head>');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(html);
      return;
    }
    serveFile(res, filePath);
  } catch (error) {
    json(res, 500, { error: 'Preview server error: ' + error.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('[web-preview] http://127.0.0.1:' + PORT);
  console.log('[web-preview] 静态根: ' + ROOT);
  console.log('[web-preview] 测试目录: ' + TEST_DIR);
  console.log('[web-preview] 停止: Ctrl+C');
});
