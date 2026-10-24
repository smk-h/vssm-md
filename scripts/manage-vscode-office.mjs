/**
 * @file 在线安装/卸载市场扩展 cweijan.vscode-office（本扩展的 upstream 原版）。
 * @module scripts/manage-vscode-office
 * @usage
 *   node scripts/manage-vscode-office.mjs install    # 从市场在线安装
 *   node scripts/manage-vscode-office.mjs uninstall  # 卸载并清残留
 * @details 卸载分两步，保证"干干净净"：
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

/** @brief 目标扩展 ID（市场唯一标识） */
const EXT_ID = 'cweijan.vscode-office';

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
    console.error('[office] 未找到 code CLI：请在 VS Code 命令面板执行 "Shell Command: Install \'code\' command in PATH" 后重试');
    process.exit(1);
  }
}

function install() {
  ensureCodeCli();
  console.log(`[office] 从市场安装 ${EXT_ID} ...`);
  if (!run(`code --install-extension ${EXT_ID}`)) {
    console.error('[office] 安装失败，请检查网络或扩展 ID');
    process.exit(1);
  }
  const found = findInstalled();
  console.log(found ? `[office] 安装成功：${found}` : '[office] 警告：安装命令成功但未在扩展列表中找到');
}

function uninstall() {
  ensureCodeCli();
  console.log(`[office] 官方卸载 ${EXT_ID} ...`);
  // 扩展本就未安装时官方卸载可能报错，属正常情况，继续清残留即可
  if (!run(`code --uninstall-extension ${EXT_ID}`)) {
    console.log('[office] 官方卸载返回非零（可能本就未安装），继续清残留');
  }
  const removed = sweepResidue();
  console.log(removed ? `[office] 卸载完成，共清理 ${removed} 处残留` : '[office] 卸载完成，无磁盘残留');
}

const action = process.argv[2];
if (action === 'install') {
  install();
} else if (action === 'uninstall') {
  uninstall();
} else {
  console.error('用法：node scripts/manage-vscode-office.mjs <install|uninstall>');
  process.exit(1);
}
