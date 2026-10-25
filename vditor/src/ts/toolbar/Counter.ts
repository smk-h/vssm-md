import { countWords } from "../util/countWords";

/** 显示模式：0 词 / 1 字符 / 2 行 / 3 分钟 */
type CounterMode = 0 | 1 | 2 | 3;

const MODE_STORAGE_KEY = "vssm-md:counter-mode";

/** Typora 默认阅读速度：382 词/分钟（其偏好设置"较快"档） */
const DEFAULT_WORDS_PER_MINUTE = 382;

const DEFAULT_PLURAL_LABELS = ["Words", "Characters", "Lines", "Minutes"];
const DEFAULT_SINGULAR_LABELS = ["Word", "Character", "Line", "Minute"];
const DEFAULT_TITLE = "Word Count";

/** 面板行序同 Typora：分钟 / 行 / 词 / 字符 */
const PANEL_MODES: CounterMode[] = [3, 2, 0, 1];

interface ICounterLabels {
    title?: string;
    words: string;
    chars: string;
    lines: string;
    minutes: string;
    wordsSingular?: string;
    charsSingular?: string;
    linesSingular?: string;
    minutesSingular?: string;
}

export class Counter {
    public element: HTMLElement;
    private vditor: IVditor;
    private mode: CounterMode;
    private stats: { words: number; chars: number; lines: number; minutes: number };
    private lastText: string | null;
    private selectionTimer: number;
    private button: HTMLButtonElement;
    private panel: HTMLElement;
    private rows: Map<CounterMode, { value: HTMLElement; label: HTMLElement }>;

    constructor(vditor: IVditor) {
        this.vditor = vditor;
        this.mode = 0;
        this.stats = { words: 0, chars: 0, lines: 0, minutes: 0 };
        this.lastText = null;
        this.element = document.createElement("span");
        this.element.className = "vditor-counter";

        this.button = document.createElement("button");
        this.button.type = "button";
        this.button.className = "vditor-counter__value";
        this.button.setAttribute("aria-haspopup", "true");
        this.button.setAttribute("aria-expanded", "false");
        this.element.appendChild(this.button);

        this.panel = document.createElement("div");
        this.panel.className = "vditor-counter-panel";
        this.panel.style.display = "none";
        const title = document.createElement("div");
        title.className = "vditor-counter-panel__title";
        title.textContent = vditor.options.counter?.labels?.title ?? DEFAULT_TITLE;
        this.panel.appendChild(title);
        this.rows = new Map();
        PANEL_MODES.forEach((mode) => {
            const row = document.createElement("div");
            row.className = "vditor-counter-panel__row";
            const value = document.createElement("span");
            value.className = "vditor-counter-panel__value";
            const label = document.createElement("span");
            label.className = "vditor-counter-panel__label";
            row.appendChild(value);
            row.appendChild(label);
            row.addEventListener("click", () => {
                this.mode = mode;
                this.persistMode();
                this.updateDisplay();
                this.togglePanel(false);
            });
            this.panel.appendChild(row);
            this.rows.set(mode, { value, label });
        });
        this.element.appendChild(this.panel);

        this.restoreMode();
        this.button.addEventListener("click", () => this.togglePanel());
        document.addEventListener("click", (event) => {
            if (!this.element.contains(event.target as Node)) {
                this.togglePanel(false);
            }
        });
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                this.togglePanel(false);
            }
        });
        document.addEventListener("selectionchange", () => {
            window.clearTimeout(this.selectionTimer);
            this.selectionTimer = window.setTimeout(() => {
                if (this.element.isConnected) {
                    this.updateDisplay();
                }
            }, 128);
        });

        this.render(vditor, "");
    }

    public render(vditor: IVditor, mdText?: string) {
        const text = mdText ?? "";
        if (text === this.lastText) {
            return;
        }
        this.lastText = text;
        const words = countWords(text);
        this.stats = {
            words,
            chars: text.length,
            lines: text.split("\n").length,
            minutes: Math.round(words / this.getWordsPerMinute()),
        };
        this.updateDisplay();
    }

    private getWordsPerMinute(): number {
        const configured = this.vditor.options.counter?.wordsPerMinute;
        return configured && configured > 0 ? configured : DEFAULT_WORDS_PER_MINUTE;
    }

    private getLabels(): { plural: string[]; singular: string[] } {
        const custom: ICounterLabels | undefined = this.vditor.options.counter?.labels;
        if (!custom) {
            return { plural: DEFAULT_PLURAL_LABELS, singular: DEFAULT_SINGULAR_LABELS };
        }
        return {
            plural: [custom.words, custom.chars, custom.lines, custom.minutes],
            singular: [
                custom.wordsSingular ?? custom.words,
                custom.charsSingular ?? custom.chars,
                custom.linesSingular ?? custom.lines,
                custom.minutesSingular ?? custom.minutes,
            ],
        };
    }

    /** 选区落在编辑器内时返回选中文本，否则返回空串（同 Typora 的 updateInSelection） */
    private getSelectionText(): string {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
            return "";
        }
        const mode = this.vditor[this.vditor.currentMode];
        const editorElement = mode ? mode.element : this.vditor.element;
        if (!selection.anchorNode || !editorElement.contains(selection.anchorNode)) {
            return "";
        }
        return selection.toString();
    }

    private valueOf(mode: CounterMode, text: string): number {
        if (mode === 0) {
            return countWords(text);
        }
        if (mode === 1) {
            return text.length;
        }
        if (mode === 2) {
            return text.split("\n").length;
        }
        return Math.round(countWords(text) / this.getWordsPerMinute());
    }

    private formatValue(mode: CounterMode, value: number, selectionText: string): string {
        if (selectionText.length > 0) {
            const selectionValue = this.valueOf(mode, selectionText);
            if (selectionValue > 0 && selectionValue < value) {
                return `${selectionValue} / ${value}`;
            }
        }
        // Typora 细节：分钟数四舍五入为 0 时显示 "≤ 1"
        return mode === 3 && value === 0 ? "≤ 1" : `${value}`;
    }

    private updateDisplay() {
        const labels = this.getLabels();
        const values = [this.stats.words, this.stats.chars, this.stats.lines, this.stats.minutes];
        const selectionText = this.getSelectionText();

        const value = values[this.mode];
        const buttonLabel = value === 1 ? labels.singular[this.mode] : labels.plural[this.mode];
        this.button.textContent = `${this.formatValue(this.mode, value, selectionText)} ${buttonLabel}`;

        this.rows.forEach((row, mode) => {
            const rowValue = values[mode];
            row.value.textContent = this.formatValue(mode, rowValue, selectionText);
            row.label.textContent = rowValue === 1 ? labels.singular[mode] : labels.plural[mode];
        });
    }

    private togglePanel(open?: boolean) {
        const next = open ?? this.panel.style.display === "none";
        if (next === (this.panel.style.display !== "none")) {
            return;
        }
        this.panel.style.display = next ? "" : "none";
        this.button.setAttribute("aria-expanded", String(next));
        if (next) {
            this.updateDisplay();
        }
    }

    private persistMode() {
        try {
            localStorage.setItem(MODE_STORAGE_KEY, String(this.mode));
        } catch (e) {
            // webview 环境禁用 storage 时忽略
        }
    }

    private restoreMode() {
        try {
            const stored = parseInt(localStorage.getItem(MODE_STORAGE_KEY) ?? "", 10);
            if (stored >= 0 && stored <= 3) {
                this.mode = stored as CounterMode;
            }
        } catch (e) {
            // 忽略并保持默认模式
        }
    }
}
