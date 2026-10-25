// mock 宿主页逻辑：目录浏览器（/api/tree、/api/file）+ 编辑器 iframe 桥接，
// open/save 消息协议与 VS Code 扩展宿主保持一致（见 src/provider/markdownEditorProvider.ts）。

var STORAGE_KEY = 'vssm-web-preview:content';
var THEME_KEY = 'vssm-web-preview:theme';
var CURRENT_KEY = 'vssm-web-preview:current';
var frame = document.getElementById('frame');
var logEl = document.getElementById('log');
var curEl = document.getElementById('cur');
var treeEl = document.getElementById('tree');
var fileInput = document.getElementById('file');
var theme = localStorage.getItem(THEME_KEY) || 'dark';
var curPath = null;   // 当前打开的 test/markdown 相对路径；null = 示例文档

var log = function (text) { logEl.textContent = text; };
var currentContent = function () { return localStorage.getItem(STORAGE_KEY) || ''; };
var loadFrame = function () { frame.src = '/markdown/index.html?theme=' + encodeURIComponent(theme) + '&t=' + Date.now(); };

document.getElementById('theme').onclick = function () {
  theme = theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, theme);
  loadFrame();
};
document.getElementById('reset').onclick = function () {
  curPath = null;
  localStorage.removeItem(CURRENT_KEY);
  localStorage.removeItem(STORAGE_KEY);
  curEl.textContent = '';
  loadFrame();
  log('已切换到示例文档');
};
document.getElementById('open').onclick = function () { fileInput.click(); };
fileInput.onchange = function () {
  var file = fileInput.files && fileInput.files[0];
  if (!file) return;
  file.text().then(function (text) {
    curPath = null;
    localStorage.removeItem(CURRENT_KEY);
    localStorage.setItem(STORAGE_KEY, text);
    curEl.textContent = file.name + '（本地，不回写）';
    loadFrame();
    log('已打开本地文件: ' + file.name);
  });
};
document.getElementById('download').onclick = function () {
  var blob = new Blob([currentContent()], { type: 'text/markdown' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (curPath || 'preview').split('/').pop();
  a.click();
  URL.revokeObjectURL(a.href);
};

/* ---------- 目录浏览器 ---------- */
var api = function (url, options) { return fetch(url, options).then(function (r) { return r.json(); }); };

var openFile = function (rel) {
  api('/api/file?p=' + encodeURIComponent(rel)).then(function (data) {
    if (data.error) { log(data.error); return; }
    curPath = rel;
    localStorage.setItem(CURRENT_KEY, rel);
    localStorage.setItem(STORAGE_KEY, data.content);
    curEl.textContent = rel;
    loadFrame();
    log('已打开: ' + rel);
    renderTreeActive();
  });
};

var saveToDisk = function (content) {
  if (!curPath) return;
  fetch('/api/file?p=' + encodeURIComponent(curPath), { method: 'POST', body: content })
    .then(function (r) { return r.json(); })
    .then(function (data) { log(data.ok ? '已写回磁盘: ' + curPath : (data.error || '写回失败')); });
};

var renderTreeActive = function () {
  treeEl.querySelectorAll('.file').forEach(function (el) {
    el.classList.toggle('active', el.dataset.p === curPath);
  });
};

var renderNode = function (node, depth) {
  if (node.type === 'dir') {
    var head = document.createElement('div');
    head.className = 'dir';
    head.style.paddingLeft = (8 + depth * 12) + 'px';
    head.textContent = node.name;
    var box = document.createElement('div');
    box.className = 'dir-children';
    head.onclick = function () { head.classList.toggle('open'); };
    (node.children || []).forEach(function (c) { box.appendChild(renderNode(c, depth + 1)); });
    var frag = document.createDocumentFragment();
    frag.appendChild(head); frag.appendChild(box);
    return frag;
  }
  var row = document.createElement('div');
  row.className = 'file';
  row.dataset.p = node.path;
  var name = document.createElement('span');
  name.className = 'name';
  name.textContent = node.name;
  name.title = node.path;
  var del = document.createElement('button');
  del.className = 'del';
  del.textContent = '✕';
  del.title = '删除';
  del.onclick = function (e) {
    e.stopPropagation();
    if (!confirm('删除 ' + node.path + ' ?')) return;
    api('/api/file?p=' + encodeURIComponent(node.path), { method: 'DELETE' }).then(function (data) {
      log(data.ok ? '已删除: ' + node.path : (data.error || '删除失败'));
      if (node.path === curPath) document.getElementById('reset').click();
      loadTree();
    });
  };
  row.appendChild(name); row.appendChild(del);
  row.onclick = function () { openFile(node.path); };
  return row;
};

var loadTree = function () {
  api('/api/tree').then(function (data) {
    treeEl.textContent = '';
    (data.children || []).forEach(function (c) { treeEl.appendChild(renderNode(c, 0)); });
    renderTreeActive();
  });
};

document.getElementById('newfile').onclick = function () {
  var name = prompt('新文件名（自动补 .md 后缀）:');
  if (!name) return;
  if (!/\.md$/i.test(name)) name += '.md';
  if (name.includes('/') || name.includes('\\')) { log('文件名不能包含路径分隔符'); return; }
  fetch('/api/file?p=' + encodeURIComponent(name), { method: 'POST', body: '# ' + name.replace(/\.md$/i, '') + '\n' })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data.ok) { log(data.error || '创建失败'); return; }
      loadTree();
      openFile(name);
    });
};

/* ---------- 编辑器桥接 ---------- */
var pickImage = function () {
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = function () {
    var file = input.files && input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      send('insertImageMarkdown', '![' + file.name + '](' + reader.result + ')');
      log('已插入图片: ' + file.name);
    };
    reader.readAsDataURL(file);
  };
  input.click();
};

var send = function (type, content) { frame.contentWindow.postMessage({ type: type, content: content }, '*'); };
var saveTimer = null;
var onContentSave = function (content) {
  localStorage.setItem(STORAGE_KEY, content);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(function () { saveToDisk(localStorage.getItem(STORAGE_KEY)); }, 500);
};

window.addEventListener('message', function (event) {
  if (event.source !== frame.contentWindow) return;
  var data = event.data || {};
  switch (data.type) {
    case 'init':
      send('open', {
        content: currentContent(),
        rootPath: '/markdown',
        workspaceBaseUrl: '',
        documentCacheId: 'web-preview:' + (curPath || 'demo'),
        pendingFragment: undefined,
        shouldRestoreFocus: false,
        fileName: (curPath || 'preview.md').split('/').pop(),
        config: {
          editMode: 'wysiwyg',
          editorTheme: 'Auto',
          codeMirrorTheme: 'Auto',
          mermaidTheme: 'Auto',
          preventMacOptionKey: true,
          markdown: { math: { macros: {} } },
          language: navigator.language || 'zh-CN',
          isWeb: false,
          isDev: true,
        },
        viewerSettings: { globalSettings: {}, aiPreferences: {} },
      });
      log(curPath ? '编辑器已启动: ' + curPath : '编辑器已启动（示例文档）');
      break;
    case 'save':
      onContentSave(data.content);
      break;
    case 'doSave':
      localStorage.setItem(STORAGE_KEY, data.content);
      saveToDisk(data.content);
      break;
    case 'queryAIAvailable':
      send('aiAvailable', false);
      break;
    case 'queryVSCodeModels':
      send('vscodeModels', []);
      break;
    case 'insertImage':
      pickImage();
      break;
    case 'telemetry':
    case 'scroll':
      break;
    default:
      log('宿主事件: ' + data.type);
  }
});

/* ---------- 启动 ---------- */
loadTree();
var remembered = localStorage.getItem(CURRENT_KEY);
if (remembered) {
  api('/api/file?p=' + encodeURIComponent(remembered)).then(function (data) {
    if (!data.error) { curPath = remembered; localStorage.setItem(STORAGE_KEY, data.content); curEl.textContent = remembered; }
    loadFrame();
  });
} else {
  loadFrame();
}
