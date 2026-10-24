/**
 * @file 本地打包 vssm-md 扩展并安装 / 干净卸载（不经市场，装的是本地 VSIX）。
 * @module scripts/manage-vssm-md
 * @usage
 *   node scripts/manage-vssm-md.mjs install    # 本地打包并安装（npm run package → code --install-extension）
 *   node scripts/manage-vssm-md.mjs uninstall  # 卸载并清残留
 * @details install 流程：npm run package（链式触发 vscode:prepublish 的 vite 生产构建）
 *          → 校验产物 vssm-md-<version>.vsix → code --install-extension --force 安装。
 *          vsce 依赖全局安装（npm i -g @vscode/vsce），缺失时 npm run package 会失败。
 *
 *          卸载分两步，保证"干干净净"：
 *          1. code --uninstall-extension 走官方卸载（顺带更新 extensions.json/.obsolete）
 *          2. 再按扩展 ID 扫描并删除 VS Code 不会主动清的残留：
 *             ~/.vscode/extensions/<id>-<version>（含历史版本目录）
 *             <UserData>/User/globalStorage/<id>（全局数据）
 *             ~/.vscode/extensions/.cache/<id>-*（新版下载缓存，若存在）
 *
 *          以下位置刻意不碰：
 *          - workspaceStorage 下的扩展子目录按扩展 ID 哈希命名，无法按名定位，
 *            VS Code 自身会回收孤儿存储
 *          - CachedExtensionVSIXs 按 UUID 命名，无法归属到具体扩展
 *          - extensions.json / .obsolete 由官方卸载流程维护，手改易脏
 *
 *          卸载只影响磁盘数据；已打开的编辑器窗口需重启才会释放内存态。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @brief 仓库根目录（本文件位于 <root>/scripts/ 下），打包与安装均以此为基准 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** @brief 扩展 ID 与 VSIX 产物名，均取自 package.json，改名后无需同步维护本脚本 */
const { name: extName, publisher, version } = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
);
const EXT_ID = `${publisher}.${extName}`;
const VSIX_PATH = path.join(root, `${extName}-${version}.vsix`);

/**
 * @brief VS Code 用户数据目录（globalStorage 的父目录）
 *        win32: %APPDATA%/Code；darwin: ~/Library/Application Support/Code；其余: ~/.config/Code
 */
const userDataDir =
  process.platform === 'win32'
    ? path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Code')
    : process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', 'Code')
      : path.join(os.homedir(), '.config', 'Code');

/** @brief 扩展安装目录 ~/.vscode/extensions */
const extensionsDir = path.join(os.homedir(), '.vscode', 'extensions');

/**
 * @brief 以 shell 字符串方式执行命令（规避 Windows 下 code.cmd/npm.cmd 的转义问题）
 * @returns {boolean} 是否成功（退出码 0）
 */
function run(command, { cwd } = {}) {
  return spawnSync(command, { shell: true, stdio: 'inherit', cwd }).status === 0;
}

/** @brief 捕获命令 stdout（静默执行，失败返回空串） */
function capture(command, { cwd } = {}) {
  const { status, stdout } = spawnSync(command, {
    shell: true,
    encoding: 'utf8',
    cwd,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return status === 0 ? String(stdout) : '';
}

/** @brief 递归删除并打印日志；返回是否实际删除了内容 */
function rm(target, what) {
  if (!fs.existsSync(target)) return false;
  fs.rmSync(target, { recursive: true, force: true });
  console.log(`  [clean] 已删除${what}：${target}`);
  return true;
}

/** @brief 从 --list-extensions 输出中查目标扩展，返回 "id@version" 或 undefined */
function findInstalled() {
  const list = capture('code --list-extensions --show-versions');
  return list
    .split(/\r?\n/)
    .find((line) => line.trim().toLowerCase().startsWith(`${EXT_ID}@`));
}

/** @brief 按扩展 ID 清扫磁盘残留，返回删除项数 */
function sweepResidue() {
  let removed = 0;
  const idPrefix = new RegExp(`^${EXT_ID.replace(/\./g, '\\.')}-`);

  // 1. 扩展安装目录：官方卸载正常会删，这里兜底清历史版本与中断残留
  if (fs.existsSync(extensionsDir)) {
    for (const entry of fs.readdirSync(extensionsDir)) {
      if (idPrefix.test(entry) && rm(path.join(extensionsDir, entry), '扩展目录')) removed++;
    }
  }

  // 2. 全局数据 globalStorage/<id>
  if (rm(path.join(userDataDir, 'User', 'globalStorage', EXT_ID), '全局数据目录')) removed++;

  // 3. 新版 VS Code 的 VSIX 下载缓存（存在才清）
  const cacheDir = path.join(extensionsDir, '.cache');
  if (fs.existsSync(cacheDir)) {
    for (const entry of fs.readdirSync(cacheDir)) {
      if (idPrefix.test(entry) && rm(path.join(cacheDir, entry), '下载缓存')) removed++;
    }
  }

  return removed;
}

/** @brief 前置校验：code CLI 必须可用（否则连官方卸载/安装都做不了） */
function ensureCodeCli() {
  if (!capture('code --version')) {
    console.error('[vssm-md] 未找到 code CLI：请在 VS Code 命令面板执行 "Shell Command: Install \'code\' command in PATH" 后重试');
    process.exit(1);
  }
}

function install() {
  ensureCodeCli();
  console.log(`[vssm-md] 本地打包（${extName}@${version}）...`);
  if (!run('npm run package', { cwd: root })) {
    console.error('[vssm-md] 打包失败：请检查构建报错；若提示找不到 vsce，先执行 npm i -g @vscode/vsce');
    process.exit(1);
  }
  if (!fs.existsSync(VSIX_PATH)) {
    console.error(`[vssm-md] 打包命令成功但未找到产物：${VSIX_PATH}`);
    process.exit(1);
  }

  console.log(`[vssm-md] 安装本地 VSIX：${path.basename(VSIX_PATH)}`);
  if (!run(`code --install-extension "${VSIX_PATH}" --force`)) {
    console.error('[vssm-md] 安装失败，请查看上方 code CLI 输出');
    process.exit(1);
  }
  const found = findInstalled();
  console.log(found ? `[vssm-md] 安装成功：${found}` : '[vssm-md] 警告：安装命令成功但未在扩展列表中找到');
}

function uninstall() {
  ensureCodeCli();
  console.log(`[vssm-md] 官方卸载 ${EXT_ID} ...`);
  // 扩展本就未安装时官方卸载可能报错，属正常情况，继续清残留即可
  if (!run(`code --uninstall-extension ${EXT_ID}`)) {
    console.log('[vssm-md] 官方卸载返回非零（可能本就未安装），继续清残留');
  }
  const removed = sweepResidue();
  console.log(removed ? `[vssm-md] 卸载完成，共清理 ${removed} 处残留` : '[vssm-md] 卸载完成，无磁盘残留');
}

const action = process.argv[2];
if (action === 'install') {
  install();
} else if (action === 'uninstall') {
  uninstall();
} else {
  console.error('用法：node scripts/manage-vssm-md.mjs <install|uninstall>');
  process.exit(1);
}
