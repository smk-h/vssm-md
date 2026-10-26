import { buildCleanEditorClone, getCodeMirrorView, isInsideCodeMirror } from "../codeBlock/codeMirrorManager";
import { scrollBlockIntoView } from "./scrollToBlock";
import { getSelectionRangeInEditor, setSelectionFocus } from "./selection";

/**
 * 预览块 <-> Markdown 源码行 双向映射。
 *
 * 参照 Typora 的做法：切换源码/预览时以"锚点块"为单位换算位置——
 * 光标所在块（或可视区第一个块）对应源码起始行，反向同理。
 * Typora 的源码模式本身就是 CodeMirror（块与行一一对应），
 * 这里 vditor 的 DOM 块通过逐块序列化后与全文对齐来获得同样的行号。
 */

const getModeEditorElement = (vditor: IVditor): HTMLElement | null => {
    if (vditor.currentMode === "wysiwyg") {
        return vditor.wysiwyg.element;
    }
    if (vditor.currentMode === "ir") {
        return vditor.ir.element;
    }
    return null;
};

/** 顶层块列表：编辑器根的直接子元素，排除首尾边界占位段 */
const collectTopLevelBlocks = (root: HTMLElement): HTMLElement[] => {
    const blocks: HTMLElement[] = [];
    for (const child of Array.from(root.children)) {
        if (!(child instanceof HTMLElement) || child.classList.contains("vditor-editor-boundary")) {
            continue;
        }
        blocks.push(child);
    }
    return blocks;
};

const countNewlines = (text: string): number => {
    let count = 0;
    for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) {
        count++;
    }
    return count;
};

type SourceLineIndex = {
    blocks: HTMLElement[];
    /** 每个顶层块对应的源码起始行（1 基） */
    startLines: number[];
    /** 序列化的全文（与 getMarkdown 同管线，行号即源码行号） */
    fullText: string;
};

const createSourceLineIndex = (vditor: IVditor): SourceLineIndex | null => {
    const editor = getModeEditorElement(vditor);
    if (!editor) {
        return null;
    }
    const blocks = collectTopLevelBlocks(editor);
    if (blocks.length === 0) {
        return null;
    }
    const clone = buildCleanEditorClone(vditor);
    if (!clone) {
        return null;
    }
    const clones = collectTopLevelBlocks(clone);
    if (clones.length !== blocks.length) {
        return null;
    }

    const wrapper = document.createElement("div");
    const serializeRange = (start: number, endExclusive: number): string => {
        while (wrapper.firstChild) {
            wrapper.removeChild(wrapper.firstChild);
        }
        for (let i = start; i < endExclusive; i++) {
            wrapper.appendChild(clones[i]);
        }
        return vditor.currentMode === "ir"
            ? vditor.lute.VditorIRDOM2Md(wrapper.innerHTML)
            : vditor.lute.VditorDOM2Md(wrapper.innerHTML);
    };

    const fullText = serializeRange(0, blocks.length);

    // 逐块序列化并在全文中顺序对齐，得到每块的源码起始行；
    // 个别块对不上（如图片 URL 被宿主重写）时沿用上一块的行号做近似
    let searchFrom = 0;
    let lastStartLine = 1;
    const startLines: number[] = [];
    for (let i = 0; i < blocks.length; i++) {
        const blockMd = serializeRange(i, i + 1).replace(/\s+$/, "");
        let startLine = lastStartLine;
        if (blockMd) {
            const idx = fullText.indexOf(blockMd, searchFrom);
            if (idx >= 0) {
                startLine = 1 + countNewlines(fullText.slice(0, idx));
                searchFrom = idx + blockMd.length;
            }
        }
        startLines.push(startLine);
        lastStartLine = startLine;
    }

    return { blocks, startLines, fullText };
};

/** 在顶层块列表中定位元素所属的块下标 */
const findTopLevelIndex = (blocks: HTMLElement[], node: Node | null): number => {
    let element = node?.nodeType === 1 ? (node as HTMLElement) : node?.parentElement ?? null;
    while (element) {
        const idx = blocks.indexOf(element);
        if (idx >= 0) {
            return idx;
        }
        element = element.parentElement;
    }
    return -1;
};

/**
 * 预览 -> 源码：取当前锚点（代码块光标 > 正文光标 > 可视区首个块）对应的源码行（1 基）。
 * 代码块内光标可精确定位到块内行（起始行 + fence 行 + CM 行号）。
 */
export const getSourceAnchorLine = (vditor: IVditor): number | null => {
    const index = createSourceLineIndex(vditor);
    if (!index) {
        return null;
    }
    const editor = getModeEditorElement(vditor)!;

    const activeElement = document.activeElement;
    if (isInsideCodeMirror(activeElement)) {
        const block = (activeElement as HTMLElement).closest("[data-type='code-block'], [data-type='math-block']");
        const idx = findTopLevelIndex(index.blocks, block);
        if (idx >= 0) {
            let line = index.startLines[idx];
            const view = block ? getCodeMirrorView(block as HTMLElement) : null;
            if (view) {
                // CM6 head 是整数偏移，换算为块内行号（1 基）；再跳过 fence 行得到源码行
                const head = Math.max(0, Math.min(view.state.selection.main.head, view.state.doc.length));
                line += view.state.doc.lineAt(head).number;
            }
            return line;
        }
    }

    const range = getSelectionRangeInEditor(editor);
    if (range) {
        const idx = findTopLevelIndex(index.blocks, range.startContainer);
        if (idx >= 0) {
            return index.startLines[idx];
        }
    }

    const editorRect = editor.getBoundingClientRect();
    for (let i = 0; i < index.blocks.length; i++) {
        const rect = index.blocks[i].getBoundingClientRect();
        if (rect.bottom > editorRect.top + 1) {
            return index.startLines[i];
        }
    }
    return 1;
};

/** 块内第一个适合放光标的文本位置：跳过语法标记 span，找不到时退回首个文本节点 */
const findCaretTextNode = (block: HTMLElement): { node: Text; offset: number } | null => {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let fallback: { node: Text; offset: number } | null = null;
    let node = walker.nextNode() as Text | null;
    while (node) {
        if (node.nodeValue && node.nodeValue.length > 0) {
            const entry = { node, offset: 0 };
            const inMarker = !!node.parentElement?.closest(".vditor-ir__marker, .vditor-wysiwyg__marker");
            if (!inMarker && node.nodeValue.trim().length > 0) {
                return entry;
            }
            if (!fallback) {
                fallback = entry;
            }
        }
        node = walker.nextNode() as Text | null;
    }
    return fallback;
};

/** 把光标放进目标块：代码/公式块已激活 CM 时精确到对应行，其余块放首个文本位 */
const placeCaretInBlock = (vditor: IVditor, block: HTMLElement, line: number, blockStartLine: number) => {
    const blockType = block.getAttribute("data-type");
    if (blockType === "code-block" || blockType === "math-block") {
        const view = getCodeMirrorView(block);
        if (!view) {
            return; // 预览态代码块无 DOM 光标位，仅滚动
        }
        const cmLine = Math.min(Math.max(line - blockStartLine - 1, 0), view.state.doc.lines - 1);
        view.dispatch({ selection: { anchor: view.state.doc.line(cmLine + 1).from } });
        view.focus();
        return;
    }
    const caret = findCaretTextNode(block);
    if (!caret) {
        return;
    }
    const range = document.createRange();
    range.setStart(caret.node, caret.offset);
    range.collapse(true);
    setSelectionFocus(range);
    getModeEditorElement(vditor)?.focus({ preventScroll: true });
};

/** 源码 -> 预览：滚动到源码行（1 基）所在的块；placeCaret 时同时把光标放入该块 */
export const scrollToSourceLine = (vditor: IVditor, line: number, placeCaret = false): boolean => {
    if (!Number.isFinite(line) || line < 1) {
        return false;
    }
    const index = createSourceLineIndex(vditor);
    if (!index) {
        return false;
    }
    // startLines 单调不减，取起始行不大于目标行的最后一个块
    let target = 0;
    for (let i = 0; i < index.blocks.length; i++) {
        if (index.startLines[i] <= line) {
            target = i;
        } else {
            break;
        }
    }
    scrollBlockIntoView(vditor, index.blocks[target]);
    if (placeCaret) {
        placeCaretInBlock(vditor, index.blocks[target], line, index.startLines[target]);
    }
    return true;
};
