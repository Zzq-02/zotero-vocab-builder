/**
 * 例句自动摘录：从选中单词所在的 DOM 文本中提取完整句子。
 */

const SENTENCE_END_RE = /[.!?。！？…]/;
/** 中文终止符本身即边界（后无需空白） */
const CN_END_RE = /[。！？…]/;

/** 常见缩写：其后的句点不视为句子边界 */
const ABBREVIATIONS = new Set([
  "dr",
  "mr",
  "mrs",
  "ms",
  "st",
  "vs",
  "etc",
  "fig",
  "eq",
  "no",
  "vol",
  "pp",
  "ed",
  "eds",
  "al",
  "cf",
  "ca",
  "dept",
  "univ",
  "inc",
  "ltd",
  "co",
  // 带内嵌点的缩写（去点后比较，如 e.g. -> eg）；仅当 token 含点时才视为缩写
  "eg",
  "ie",
  "us",
  "uk",
  "pm",
  "am",
]);

const DOTTED_ABBREVIATIONS = new Set(["eg", "ie", "us", "uk", "pm", "am"]);

function isAbbreviationBefore(text: string, dotIndex: number): boolean {
  let i = dotIndex - 1;
  // 向前扫描字母与内嵌点（如 e.g. / U.S. / p.m.），整体作为一个 token
  while (i >= 0 && /[a-zA-Z.]/.test(text[i])) i--;
  const token = text.slice(i + 1, dotIndex);
  const word = token.replace(/\./g, "").toLowerCase();
  if (DOTTED_ABBREVIATIONS.has(word)) {
    // us. / am. 这类无内嵌点的普通单词不视为缩写
    return token.includes(".");
  }
  return ABBREVIATIONS.has(word);
}

/**
 * 从文本中提取包含 index 的完整句子（纯函数，便于测试）。
 * 处理缩写（如 Mr. / e.g.）：终止符后必须跟空白或结尾才视为句子边界。
 */
export function extractSentenceAt(text: string, index: number): string {
  if (!text) return "";
  if (index < 0 || index >= text.length) return text.trim();

  const start = findSentenceStart(text, index);
  const end = findSentenceEnd(text, index);
  return text.slice(start, end).trim().replace(/\s+/g, " ");
}

function findSentenceStart(text: string, index: number): number {
  let i = index;
  while (i > 0) {
    const ch = text[i - 1];
    if (CN_END_RE.test(ch)) {
      let j = i;
      while (j < text.length && /\s/.test(text[j])) j++;
      return j;
    }
    if (SENTENCE_END_RE.test(ch)) {
      if (ch === "." && isAbbreviationBefore(text, i - 1)) {
        // 缩写（如 Dr. / e.g.），不是句子边界
        i--;
        continue;
      }
      if (i < text.length && /\s/.test(text[i])) {
        let j = i;
        while (j < text.length && /\s/.test(text[j])) j++;
        return j;
      }
      // 终止符后紧跟字符（网址等），视为句子内部，继续向前
    }
    i--;
  }
  return 0;
}

function findSentenceEnd(text: string, index: number): number {
  let i = index;
  while (i < text.length) {
    const ch = text[i];
    if (CN_END_RE.test(ch)) {
      return i + 1;
    }
    if (SENTENCE_END_RE.test(ch)) {
      if (ch === "." && isAbbreviationBefore(text, i)) {
        i++;
        continue;
      }
      if (i + 1 >= text.length || /\s/.test(text[i + 1])) {
        return i + 1;
      }
    }
    i++;
  }
  return text.length;
}

/** 从窗口选区提取包含选中文本的完整句子；失败或选区即完整句子时返回选中文本 */
export function selectionToSentence(win: Window): string {
  try {
    const selection = win.getSelection();
    if (!selection || selection.rangeCount === 0) return "";
    const selectedText = selection.toString().trim();
    if (!selectedText) return "";

    // 选区本身是完整句子（含句末标点）或太长时，直接使用选区文本
    if (
      /[.!?。！？…]["')\]]?\s*$/.test(selectedText) ||
      selectedText.length > 160
    ) {
      return selectedText.replace(/\s+/g, " ").trim();
    }

    const range = selection.getRangeAt(0);
    let startContainer = range.startContainer;
    let startOffset = range.startOffset;

    // 选区起点可能是元素节点（如从 span 边界开始），取其内部第一个文本节点
    if (startContainer.nodeType !== Node.TEXT_NODE) {
      const doc = startContainer.ownerDocument;
      if (!doc) return selectedText;
      const walker = doc.createTreeWalker(startContainer, NodeFilter.SHOW_TEXT);
      const firstText = walker.nextNode();
      if (!firstText) return selectedText;
      startContainer = firstText;
      startOffset = 0;
    }

    // 提取包含锚点的局部上下文（锚点附近兄弟节点序列），
    // 避免 PDF.js 整页文本按 DOM 拼接时出现单词顺序错乱
    const local = collectLocalContext(startContainer, startOffset);
    if (local && local.text.length > selectedText.length) {
      const sentence = extractSentenceAt(local.text, local.offset);
      if (sentence) return sentence;
    }

    return selectedText;
  } catch (e) {
    return "";
  }
}

/**
 * 收集包含锚点文本节点的局部文本与锚点偏移：
 * 1) 锚点所在叶子元素文本足够长时直接使用（普通 HTML，如 <p>）；
 * 2) 否则在其父级收集锚点元素前后最多 MAX_SIBLINGS 个兄弟元素
 *    （PDF.js 每词一个 span 的文本层），按 DOM 顺序拼接。
 */
function collectLocalContext(
  node: Node,
  startOffset: number,
): { text: string; offset: number } | null {
  try {
    const leaf =
      node.nodeType === Node.TEXT_NODE
        ? node.parentElement
        : (node as Element);
    if (leaf) {
      const leafText = leaf.textContent || "";
      if (leafText.trim().length >= 20) {
        const offset = textOffsetInElement(leaf, node, startOffset);
        if (offset >= 0) return { text: leafText, offset };
      }
    }

    const container = leaf?.parentElement;
    if (!container) return null;

    // 文本节点直接位于容器内（无包裹元素）时，用容器全文
    if (node.nodeType === Node.TEXT_NODE && !leaf) {
      const text = container.textContent || "";
      if (text.trim().length >= 20) {
        const offset = textOffsetInElement(container, node, startOffset);
        if (offset >= 0) return { text, offset };
      }
    }

    if (!leaf) return null;
    const children = Array.from(container.children);
    const leafIndex = children.indexOf(leaf);
    if (leafIndex < 0) return null;

    const MAX_SIBLINGS = 60;
    const start = Math.max(0, leafIndex - MAX_SIBLINGS);
    const end = Math.min(children.length, leafIndex + MAX_SIBLINGS + 1);
    const parts: string[] = [];
    let offset = 0;
    for (let i = start; i < end; i++) {
      const text = children[i].textContent || "";
      parts.push(text);
      if (i < leafIndex) offset += text.length + 1;
    }
    return { text: parts.join(" "), offset: offset + startOffset };
  } catch (e) {
    return null;
  }
}

function textOffsetInElement(
  root: Element,
  node: Node,
  offset: number,
): number {
  const doc = root.ownerDocument;
  if (!doc) return -1;

  let total = 0;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const current = walker.currentNode;
    if (current === node) return total + offset;
    total += (current.textContent || "").length;
  }
  return -1;
}
