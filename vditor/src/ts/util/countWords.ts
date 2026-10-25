/**
 * 词数统计，算法移植自 Typora（resources/appsrc/window/frame.js 的 WordCount）：
 * 词数 = CJK 字符数 + 西文单词数。
 *
 * - CJK 区间 [\u3040-\uABFF\uD7A4-\uFAFF]：假名、注音、汉字基本区与扩展、兼容表意等，
 *   每个字符单独记 1 词（中文无分词书写）；谚文音节（AC00-D7A3）不在区间内，
 *   随空格分词走西文逻辑
 * - 全部 ASCII 标点、空白与 CJK 标点（\u3000-\u303F）作为分隔符，不计数，
 *   因此 markdown 语法符号（#、*、-、` 等）天然被剥除
 * - 英文撇号缩写（'s、’ll…）粘成占位词，don't 记 1 词
 * - 夹在行首/行尾（或两侧空白）之间的孤立标点串视为标记残留，整体清空
 */
export function countWords(text: string): number {
    if (!text || text.trim().length === 0) {
        return 0;
    }
    let cjkCount = 0;
    const withoutCjk = text.replace(/[\u3040-\uABFF\uD7A4-\uFAFF]/g, () => {
        cjkCount += 1;
        return " ";
    });
    const withAbbrev = withoutCjk.replace(/['’]\w+/g, "b");
    const cleaned = withAbbrev.replace(/(^|\s+)[(\u3000-\u303F)!-/:-@[-`{-~]+(\s+|$)/gm, " ");
    // 首尾各加哨兵 "d"，按分隔符切分后段数减 2 即西文词数（与 Typora 等价）
    const segments = `d ${cleaned} d`.split(/[(\u3000-\u303F)\s!-,\\:-@[-`{-~]+/g);
    return cjkCount + segments.length - 2;
}
