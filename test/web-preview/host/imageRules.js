// 图像插入规则的浏览器侧镜像（与 src/service/imageInsertRule.ts 保持同一套语义）。
// mock 宿主页据此把粘贴/插入的图片按当前设置落盘，用于浏览器回归验证。
var WebImageRules = (function () {
  var DEFAULTS = {
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

  var sanitizeName = function (name) {
    return String(name || '').replace(/[\\/:*?"<>|\r\n]+/g, '').trim();
  };

  var parseCopyImagesTo = function (content) {
    if (!content) return undefined;
    var fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!fm) return undefined;
    var raw = (fm[1].match(/^typora-copy-images-to:\s*(.+?)\s*$/im) || [])[1];
    if (!raw) return undefined;
    raw = raw.replace(/^["']|["']$/g, '').trim();
    return raw || undefined;
  };

  var posixJoin = function (dir, sub) {
    if (!dir) return sub;
    return dir.replace(/\/+$/, '') + '/' + sub;
  };

  var docDirOf = function (docPath) {
    var idx = docPath.lastIndexOf('/');
    return idx >= 0 ? docPath.slice(0, idx) : '';
  };

  var docNameOf = function (docPath) {
    var base = (docPath.split('/').pop() || '').replace(/\.[A-Za-z0-9]+$/, '');
    return sanitizeName(base) || 'document';
  };

  var isAbsoluteish = function (p) { return /^\/|[A-Za-z]:[\\/]/.test(p); };

  var GENERIC_IMAGE_STEM_RE = /^(image|blob|clipboard|screenshot|capture|paste|pasted|snap|截屏|截图|捕获|未命名)([-_. ]?\d+)?$/i;

  var lastImageStamp = 0;
  var uniqueImageStamp = function () {
    var now = Date.now();
    lastImageStamp = now <= lastImageStamp ? lastImageStamp + 1 : now;
    return lastImageStamp;
  };

  var buildImageFileName = function (sourceName, ext) {
    var base = sanitizeName(sourceName);
    if (base) {
      var stem = base.replace(/\.[A-Za-z0-9]{1,8}$/, '');
      // 剪贴板位图的通用名（image.png 等）每次相同，改用时间戳避免同名互相覆盖
      if (!GENERIC_IMAGE_STEM_RE.test(stem)) {
        return /\.[A-Za-z0-9]{1,8}$/.test(base) ? base : base + '.' + ext;
      }
    }
    return 'image-' + uniqueImageStamp() + '.' + ext;
  };

  var formatDateString = function (now) {
    return '' + now.getFullYear() +
      String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0');
  };

  /**
   * 计算落盘计划。
   * input: { docPath, content, sourceName, ext, settings }
   * 返回 {kind:'copy',targetDir,fileName} | {kind:'none'}
   * 浏览器镜像里 legacy 也折算为按旧模板落盘；upload 无 PicGo 可用，同样退化为按文档目录落盘。
   */
  var resolvePlan = function (input) {
    var settings = Object.assign({}, DEFAULTS, input.settings || {});
    var docName = docNameOf(input.docPath);
    var ext = (input.ext || 'png').toLowerCase();
    var docDir = docDirOf(input.docPath);

    var action = settings.insertAction;
    var customPath = settings.customPath;
    var yaml = parseCopyImagesTo(input.content);
    if (yaml && action !== 'legacy') {
      if (yaml.toLowerCase() === 'upload') {
        if (settings.allowYamlUpload) action = 'upload';
      } else {
        action = 'custom';
        customPath = yaml;
      }
    }

    if (action === 'none') return { kind: 'none' };
    if (action === 'legacy') {
      return {
        kind: 'copy',
        targetDir: posixJoin(docDir, 'image/' + docName.replace(/\s/g, '')),
        fileName: Date.now() + '.' + ext,
        // 旧模板引用不带 ./ 前缀，与 VS Code 侧 legacy 行为一致
        noDot: true,
      };
    }
    if (action === 'upload') {
      return {
        kind: 'copy',
        targetDir: posixJoin(docDir, docName + '.assets'),
        fileName: buildImageFileName(input.sourceName, ext),
      };
    }

    var targetDir;
    if (action === 'currentFolder') {
      targetDir = docDir;
    } else if (action === 'assetsFolder') {
      targetDir = posixJoin(docDir, 'assets');
    } else if (action === 'perFileAssets') {
      targetDir = posixJoin(docDir, docName + '.assets');
    } else {
      var uuid = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2))
        .replace(/-/g, '');
      var expanded = String(customPath || '')
        .replace(/\$\{filename\}/g, docName)
        .replace(/\$\{workspaceDir\}/g, '')
        .replace(/\$\{fileName\}/g, docName.replace(/\s/g, ''))
        .replace(/\$\{now\}/g, String(Date.now()))
        .replace(/\$\{date\}/g, formatDateString(new Date()))
        .replace(/\$\{uuid\}/g, uuid)
        .replace(/\$\{ext\}/g, ext)
        .replace(/[\\/]+$/, '')
        // TS 侧经 normalize(join(docDir, expanded)) 会吞掉 ./，这里同样剥掉相对前缀
        .replace(/^(\.\/|\.\.\/)*/, function (prefix) {
          // 保留 ../ 上跳层级，仅去掉 ./ 自身
          return prefix.replace(/\.\//g, '');
        });
      targetDir = isAbsoluteish(expanded) ? expanded.replace(/\\/g, '/') : posixJoin(docDir, expanded);
    }
    return { kind: 'copy', targetDir: targetDir, fileName: buildImageFileName(input.sourceName, ext) };
  };

  var buildReference = function (docPath, imagePath, settings, plan) {
    var s = Object.assign({}, DEFAULTS, settings || {});
    var docDir = docDirOf(docPath);
    var norm = String(imagePath).replace(/\\/g, '/').replace(/^\.\//, '');
    var ref;
    if (s.preferRelativePath && !isAbsoluteish(norm)
      && (!docDir || norm.toLowerCase().indexOf(docDir.toLowerCase() + '/') === 0)) {
      var rel = docDir ? norm.slice(docDir.length + 1) : norm;
      ref = (s.prefixDotSlash && !(plan && plan.noDot)) ? './' + rel : rel;
    } else {
      ref = norm;
    }
    if (s.escapeUrl) {
      ref = encodeURI(ref).replace(/#/g, '%23').replace(/\(/g, '%28').replace(/\)/g, '%29');
    }
    return ref;
  };

  return {
    DEFAULTS: DEFAULTS,
    parseCopyImagesTo: parseCopyImagesTo,
    resolvePlan: resolvePlan,
    buildImageFileName: buildImageFileName,
    buildReference: buildReference,
  };
})();
