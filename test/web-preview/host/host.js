// mock 宿主页逻辑：目录浏览器（/api/tree、/api/file）+ 编辑器 iframe 桥接，
// open/save 消息协议与 VS Code 扩展宿主保持一致（见 src/provider/markdownEditorProvider.ts）。

var STORAGE_KEY = 'vssm-web-preview:content';
var THEME_KEY = 'vssm-web-preview:theme';
var CURRENT_KEY = 'vssm-web-preview:current';
var IMAGE_SETTINGS_KEY = 'vssm-web-preview:imageSettings';
var frame = document.getElementById('frame');
var logEl = document.getElementById('log');
var curEl = document.getElementById('cur');
var treeEl = document.getElementById('tree');
var fileInput = document.getElementById('file');
var theme = localStorage.getItem(THEME_KEY) || 'dark';
var curPath = null;   // 当前打开的 .tmp 相对路径；null = 示例文档

var log = function (text) { logEl.textContent = text; };
var currentContent = function () { return localStorage.getItem(STORAGE_KEY) || ''; };
var loadFrame = function () { frame.src = '/markdown/index.html?theme=' + encodeURIComponent(theme) + '&t=' + Date.now(); };

/* ---------- 图像设置（镜像 src/service/imageInsertRule.ts 的宿主侧状态） ---------- */
var imageSettings = function () {
  try {
    return Object.assign({}, WebImageRules.DEFAULTS, JSON.parse(localStorage.getItem(IMAGE_SETTINGS_KEY) || '{}'));
  } catch (e) {
    return Object.assign({}, WebImageRules.DEFAULTS);
  }
};
var applyImageSettingsPatch = function (patch) {
  var next = Object.assign(imageSettings(), patch || {});
  localStorage.setItem(IMAGE_SETTINGS_KEY, JSON.stringify(next));
  return next;
};

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
var send = function (type, content) { frame.contentWindow.postMessage({ type: type, content: content }, '*'); };

/* ---------- 粘贴探针（?debugPaste=1 启用）：在 iframe 内捕获 keydown/paste，结果显示在顶栏 ---------- */
if (/[?&]debugPaste=1/.test(location.search)) {
  var installPasteProbe = function () {
    var win = frame.contentWindow;
    var doc = frame.contentDocument;
    if (!win || !doc || !doc.body || win.__pasteProbeInstalled) return;
    win.__pasteProbeInstalled = true;
    doc.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
        log('探针: keydown ctrl+v（按键到达页面）');
      }
    }, true);
    doc.addEventListener('paste', function (e) {
      var cd = e.clipboardData;
      log('探针: paste types=' + (cd ? JSON.stringify([].slice.call(cd.types)) : 'null') +
        ' files=' + (cd ? cd.files.length : '?') +
        (cd && cd.files[0] ? ' name=' + cd.files[0].name : '') +
        ' plain=' + (cd ? JSON.stringify((cd.getData('text/plain') || '').slice(0, 30)) : '?'));
    }, true);
    log('粘贴探针已启用，请在编辑器内按 Ctrl+V');
  };
  // iframe 每次导航都会换新文档，轮询幂等重装（同文档靠标记去重）
  setInterval(installPasteProbe, 800);
  installPasteProbe();
}

var binaryToBase64 = function (binary) {
  // readAsBinaryString 产生的是 Latin1 字符串，可直接交给 btoa
  return btoa(binary);
};

// 按当前图像设置把图片(base64)落盘并回发插入引用；mirrors saveImageAndBuildMarkdown
var saveImageAndInsert = function (payload) {
  var docPath = curPath || 'preview.md';
  var settings = imageSettings();
  var plan = WebImageRules.resolvePlan({
    docPath: docPath,
    content: currentContent(),
    sourceName: payload.name,
    ext: payload.ext,
    settings: settings,
  });
  if (plan.kind === 'none') {
    log('图像规则为「无特殊操作」，跳过落盘');
    return;
  }
  var imagePath = (plan.targetDir ? plan.targetDir.replace(/\/+$/, '') + '/' : '') + plan.fileName;
  var ref = WebImageRules.buildReference(docPath, imagePath, settings, plan);
  var name = plan.fileName.replace(/\.[A-Za-z0-9]+$/, '');
  fetch('/api/file?p=' + encodeURIComponent(imagePath) + '&enc=base64', { method: 'POST', body: payload.base64 })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data.ok) { log(data.error || '图片写入失败'); return; }
      send('insertImageMarkdown', '![' + name + '](' + ref + ')');
      log('图片已落盘: ' + imagePath + ' → 引用 ' + ref);
      loadTree();
    });
};

var handleImagePaste = function (payload) {
  if (!payload || !payload.data) return;
  saveImageAndInsert({ base64: binaryToBase64(payload.data), ext: payload.ext, name: payload.name });
};

// 删除图片引用对应的落盘文件（镜像 VS Code 侧 deleteLocalImageFile 的行为）：
// 仅本地路径；删除后向上清理空目录（DELETE 空目录会成功，非空目录服务端会拒绝）
var deleteImageFile = function (src) {
  if (!src || /^[a-z][a-z0-9+.-]*:/i.test(src) || src.indexOf('//') === 0 || src.charAt(0) === '#') return;
  var docPath = curPath || 'preview.md';
  var dir = docPath.indexOf('/') >= 0 ? docPath.slice(0, docPath.lastIndexOf('/')) : '';
  var buildTarget = function (raw) {
    var rel = String(raw).replace(/\\/g, '/').replace(/^\.\//, '');
    return rel.charAt(0) === '/' ? rel.slice(1) : (dir ? dir + '/' + rel : rel);
  };
  var tryTargets = [buildTarget(src)];
  try { var decoded = decodeURIComponent(src); if (decoded !== src) tryTargets.push(buildTarget(decoded)); } catch (e) { /* ignore */ }

  var cleanupDirs = function (target) {
    var parts = target.split('/');
    parts.pop();
    var tryRemove = function () {
      if (parts.length === 0) return;
      var dirPath = parts.join('/');
      if (!dirPath) return;
      fetch('/api/file?p=' + encodeURIComponent(dirPath), { method: 'DELETE' })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.ok) { parts.pop(); tryRemove(); }
        });
    };
    tryRemove();
  };
  var attempt = function (index) {
    if (index >= tryTargets.length) return;
    var target = tryTargets[index];
    fetch('/api/file?p=' + encodeURIComponent(target), { method: 'DELETE' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.ok) {
          log('图片已删除: ' + target);
          loadTree();
          cleanupDirs(target);
        } else {
          attempt(index + 1);
        }
      });
  };
  attempt(0);
};

var handleImageUrl = function (url) {
  log('网络图片待落盘: ' + url);
  fetch('/api/download?url=' + encodeURIComponent(url))
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.error || !data.base64) {
        log(data.error || '下载失败，回退为原样插入 URL');
        send('insertImageMarkdown', url);
        return;
      }
      saveImageAndInsert({ base64: data.base64, ext: data.ext, name: data.name });
    })
    .catch(function (error) {
      log('下载失败: ' + error.message);
      send('insertImageMarkdown', url);
    });
};

var pickImage = function () {
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = function () {
    var file = input.files && input.files[0];
    if (!file) return;
    if (imageSettings().applyToLocal === false) {
      // 不对本地图片应用规则：内联 data URI，不落盘
      var inlineReader = new FileReader();
      inlineReader.onload = function () {
        send('insertImageMarkdown', '![' + file.name + '](' + inlineReader.result + ')');
        log('已内联图片(不落盘): ' + file.name);
      };
      inlineReader.readAsDataURL(file);
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var ext = (file.name.split('.').pop() || 'png').toLowerCase();
      saveImageAndInsert({ base64: binaryToBase64(reader.result), ext: ext, name: file.name });
    };
    reader.readAsBinaryString(file);
  };
  input.click();
};

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
          imageRules: {
            applyToLocal: imageSettings().applyToLocal !== false,
            applyToWeb: imageSettings().applyToWeb !== false,
          },
          imageSettings: imageSettings(),
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
    case 'img':
      handleImagePaste(data.content);
      break;
    case 'imgUrl':
      handleImageUrl(data.content);
      break;
    case 'imageSettings':
      applyImageSettingsPatch(data.content);
      log('图像设置已更新: ' + JSON.stringify(data.content));
      break;
    case 'deleteImageFile':
      deleteImageFile(data.content);
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
