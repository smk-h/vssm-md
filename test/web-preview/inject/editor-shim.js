// 注入到编辑器页的垫片，让 resource/markdown 现有页面在纯浏览器里跑起来。
document.documentElement.dataset.previewTheme =
  new URLSearchParams(location.search).get('theme') || 'dark';

// 垫出 acquireVsCodeApi：lib/vscode.js 里 handler.emit 由此 postMessage 到 mock 宿主页
//（注意大小写必须是 acquireVsCodeApi，与 VS Code webview 真实 API 完全同名）
window.acquireVsCodeApi = function () {
  return {
    postMessage: function (message) { parent.postMessage(message, '*'); },
    getState: function () { return null; },
    setState: function () {},
  };
};
