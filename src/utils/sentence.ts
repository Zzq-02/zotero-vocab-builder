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
    const startContainer = range.startContainer;
    if (startContainer.nodeType !== Node.TEXT_NODE) return selectedText;

    // 向上找块级容器（限制深度与文本长度，避免抓到整页）
    let block = startContainer.parentElement as Element | null;
    if (!block) return selectedText;
    for (let i = 0; i < 6 && block.parentElement; i++) {
      const tag = block.tagName.toLowerCase();
      const textLength = (block.textContent || "").length;
      if (
        [
          "p",
          "div",
          "li",
          "h1",
          "h2",
          "h3",
          "h4",
          "h5",
          "h6",
          "section",
          "article",
          "blockquote",
          "figcaption",
          "td",
          "th",
        ].includes(tag) &&
        textLength <= 600
      ) {
        break;
      }
      block = block.parentElement;
    }

    const fullText = block.textContent || "";
    const absOffset = textOffsetInElement(
      block,
      startContainer,
      range.startOffset,
    );
    if (absOffset < 0) return selectedText;

    return extractSentenceAt(fullText, absOffset) || selectedText;
  } catch (e) {
    return "";
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
