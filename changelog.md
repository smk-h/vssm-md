# Change log

# 1.0.0 2026-10-24

First independent release of `vssm-md`, forked from [cweijan/vscode-office](https://github.com/cweijan/vscode-office) 4.2.2 (upstream commit [`2755c6f`](https://github.com/cweijan/vscode-office/commit/2755c6f)) and kept for personal learning use.

Breaking:

- Remove all non-Markdown features: Excel/CSV viewer, PDF viewer, image viewer, archive explorer and other editors; this extension now only replaces the Markdown editor.
- Rename the settings namespace and command prefixes to `vssm-md`; settings inherited from vscode-office need to be migrated manually.

Project:

- Rename the extension to `vssm-md` (publisher `ms-vs-extensions`) with a new icon.
- Slim npm dependencies and build configuration, rewrite the documentation (English / 简体中文 / 繁體中文).

Markdown Editor:

- No functional changes against upstream 4.2.2.
