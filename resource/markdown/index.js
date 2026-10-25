import { getToolbar, bindShortcut, createContextMenu, setAIAvailable, } from "./util.js";
import { observeWorkspaceAbsoluteImages, createMarkdownValueReader, restoreWorkspaceBaseUrls, } from "./imagePath.js";
import { mapVscodeLanguageToVditorLang } from "./lang.js";
import { bindLinkErrors } from "./linkError.js";

// 从来源 URL 提取真实文件名，替换剪贴板位图的通用名（image.png）；
// URL 无可用名字（无扩展名/解析失败）时返回 null，由调用方退回原文件名
const renameFileFromUrl = (file, url) => {
  try {
    const raw = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
    if (!raw || !/\.[A-Za-z0-9]{1,8}$/.test(raw)) return null;
    const safe = raw.replace(/[\\/:*?"<>|]/g, '');
    if (!safe || safe.startsWith('.')) return null;
    return new File([file], safe, { type: file.type });
  } catch (e) {
    return null;
  }
};

handler.on("open", async (md) => {
  const { content, rootPath, workspaceBaseUrl, documentCacheId, pendingFragment, shouldRestoreFocus, config, fileName } = md;
  window.__officeMarkdownFileName = fileName || 'Note';
  const {
    language, isWeb, isDev, markdown,
    editMode, editorTheme, codeMirrorTheme, mermaidTheme,
    imageRules, imageSettings
  } = config;
  if (isWeb) {
    document.body.classList.add('is-web')
  }
  let editor;
  const getMarkdownValue = createMarkdownValueReader(() => editor, workspaceBaseUrl);
  const vditorLang = mapVscodeLanguageToVditorLang(language);
  editor = new Vditor('vditor', {
    value: content,
    cdn: rootPath,
    preventMacOptionKey: config.preventMacOptionKey !== false,
    height: '100%',
    outline: {
      position: 'left',
    },
    cache: {
      enable: false,
      id: documentCacheId,
      focusHost: 'vscode',
    },
    counter: {
      enable: true,
      wordsPerMinute: 382,
      labels: vditorLang.startsWith('zh')
        ? { title: '字数统计', words: '词', chars: '字符', lines: '行', minutes: '分钟' }
        : undefined,
    },
    mode: editMode,
    editorTheme,
    codeMirrorTheme,
    mermaidTheme,
    imageRules,
    imageSettings,
    lang: vditorLang,
    tab: '\t',
    toolbar: await getToolbar(rootPath, () => {
      handler.emit('doSave', getMarkdownValue());
      editor?.markSaved();
    }),
    onAboutOpen: () => handler.emit('openAbout'),
    onSponsorLogoClick: () => handler.emit('openSponsor'),
    onSponsorSiteClick: () => handler.emit('openExternal', 'https://database-client.com/'),
    onLinkClick(payload, event) {
      const isCompose = event.metaKey || event.ctrlKey;
      if (payload.action !== "dblclick" && !(payload.action === "click" && isCompose)) {
        return;
      }
      if (payload.type === "footnote-ref") {
        editor.scrollToBlock(`footnote:${payload.href}`);
        return;
      }
      if (payload.href?.startsWith("#")) {
        editor.scrollToBlock(payload.href);
        return;
      }
      let uri = payload.href;
      if (payload.type === "wikilink" || payload.type === "wikilink-embed") {
        const hashIndex = uri.indexOf("#");
        const page = hashIndex < 0 ? uri : uri.slice(0, hashIndex);
        const fragment = hashIndex < 0 ? "" : uri.slice(hashIndex + 1);
        if (!page && fragment) {
          editor.scrollToBlock(fragment);
          return;
        }
        uri = `wiki:${payload.href}`;
      }
      handler.emit("openLink", uri);
    },
    debugger: isDev,
    wysiwygInputPerf: isDev && false,
    changeEditorTheme(theme) {
      handler.emit('editorTheme', theme)
    },
    changeCodeTheme(theme) {
      handler.emit('codeMirrorTheme', theme)
    },
    changeMermaidTheme(theme) {
      handler.emit('mermaidTheme', theme)
    },
    changeEditMode(mode) {
      handler.emit('editMode', mode)
    },
    changeImageSettings(patch) {
      handler.emit('imageSettings', patch)
    },
    // 粘贴单一图片 URL / 网页图片时触发；返回 true 表示已接管本次粘贴
    onPasteWebImage(url, files) {
      const settings = editor?.vditor?.options?.imageSettings || {}
      const rules = editor?.vditor?.options?.imageRules || {}
      const action = settings.insertAction || 'legacy'
      const rulesActive = rules.applyToWeb !== false && action !== 'none' && action !== 'legacy'
      if (!rulesActive) {
        // 规则未启用：走原渲染（远程图直接显示 / URL 保持链接文本）
        return false
      }
      if (files && files.length && editor?.vditor?.options?.upload?.handler) {
        // 剪贴板已携带图片位图，直接按本地图片规则落盘，无需再走网络下载；
        // 文件名优先取来源 URL 里的真实名字，替换剪贴板位图的通用名（image.png）
        const named = renameFileFromUrl(files[0], url)
        editor.vditor.options.upload.handler(named ? [named] : [...files])
        return true
      }
      handler.emit('imgUrl', url)
      return true
    },
    onSettingsChange(settings) {
      handler.emit('syncViewerSettings', settings)
    },
    onEditSettings() {
      handler.emit('editViewerSettings', editor.exportViewerSettings())
    },
    input(content) {
      handler.emit("save", restoreWorkspaceBaseUrls(content, workspaceBaseUrl))
    },
    upload: {
      url: '/image',
      accept: 'image/*',
      handler(files) {
        const file = files[0];
        const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
        // 不对本地图片应用规则时，剪贴板位图数据无处可引用，内联为 data URI
        if (editor?.vditor?.options?.imageRules?.applyToLocal === false) {
          const dataReader = new FileReader();
          dataReader.readAsDataURL(file);
          dataReader.onloadend = () => {
            editor?.insertMarkdown(`![${file.name}](${dataReader.result})`);
          };
          return;
        }
        let reader = new FileReader();
        reader.readAsBinaryString(file);
        reader.onloadend = () => {
          handler.emit("img", { data: reader.result, ext, name: file.name })
        };
      }
    },
    onTelemetry(event, properties) {
      handler.emit('telemetry', { event, properties });
    },
    ai: {
      onPolish(markdown, apply, options) {
        handler.emit('aiPolish', { markdown, options })
      },
      onCancelPolish() {
        handler.emit('aiPolishCancel')
      }
    },
    preview: {
      math: {
        macros: markdown?.math?.macros ?? {},
      },
    },
    after() {
      bindLinkErrors(handler, editor);
      const { viewerSettings } = md;
      observeWorkspaceAbsoluteImages(document.getElementById('vditor'), workspaceBaseUrl);
      if (viewerSettings?.enabled) {
        editor.setViewerSettingsSyncEnabled(true);
        if (viewerSettings.settings) {
          editor.applyViewerSettings(viewerSettings.settings);
        }
      }
      handler.on('viewerSettingsSync', ({ enabled }) => {
        editor.setViewerSettingsSyncEnabled(!!enabled);
      });
      handler.on('viewerSettings', (settings) => {
        editor.applyViewerSettings(settings);
      });
      handler.on('markdownConfig', (update) => {
        if (Object.prototype.hasOwnProperty.call(update, 'preventMacOptionKey')) {
          editor.vditor.options.preventMacOptionKey = update.preventMacOptionKey !== false;
        }
        if (update.editorTheme !== undefined) {
          editor.setEditorTheme(update.editorTheme);
        }
        if (update.codeMirrorTheme !== undefined) {
          Vditor.setCodeTheme(update.codeMirrorTheme, editor.vditor?.element);
        }
        if (update.mermaidTheme !== undefined) {
          editor.setMermaidTheme(update.mermaidTheme);
        }
        if (update.editMode !== undefined) {
          editor.switchEditMode(update.editMode);
        }
        if (update.imageRules !== undefined) {
          editor.vditor.options.imageRules = { ...(editor.vditor.options.imageRules || {}), ...update.imageRules };
        }
        if (update.imageSettings !== undefined) {
          editor.vditor.options.imageSettings = { ...(editor.vditor.options.imageSettings || {}), ...update.imageSettings };
        }
      });
      handler.on("update", content => {
        if (document.querySelector("[data-type='yaml-front-matter'].vditor-code-block--cm .cm-editor.cm-focused")) {
          return;
        }
        if (getMarkdownValue() === content) {
          return;
        }
        editor.setValue(content);
        editor.markSaved();
      })
      handler.on("insertImageMarkdown", (markdown) => {
        editor.insertMarkdown(markdown);
      })
      handler.on("gotoBlock", (fragment) => {
        if (fragment) {
          editor.scrollToBlock(fragment);
        }
      })
      handler.emit('queryAIAvailable')
      handler.on("aiAvailable", (available) => {
        setAIAvailable(available, editor)
        if (available) {
          handler.emit('queryVSCodeModels')
        }
      })
      handler.on("vscodeModels", (models) => {
        editor.setVSCodeModels(models)
      })
      handler.on('aiPolishChunk', (chunk) => {
        editor.streamAIChunk(chunk)
      })
      handler.on('aiPolishEnd', () => {
        editor.endAIStream()
      })
      editor.restoreDocumentSession(true, !!shouldRestoreFocus)
      if (pendingFragment) {
        editor.scrollToBlock(pendingFragment);
      }
    }
  })
  bindShortcut(handler, editor, workspaceBaseUrl);
  createContextMenu(editor)
}).emit("init")
