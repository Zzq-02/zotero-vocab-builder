import type { ExportFormat } from "./exporters";

export type UILanguage = "zh-CN" | "en-US";

export const DEFAULT_UI_LANGUAGE: UILanguage = "zh-CN";
export const FEEDBACK_EMAIL = "2278464424@qq.com";

const UI_TEXT: Record<UILanguage, Record<string, string>> = {
  "zh-CN": {
    "language.toggle": "中文 / English",
    "language.status": "当前语言：中文",
    "pref.title": "生词表助手",
    "pref.help": "{name} 构建版本 {version} {time}",
    "about.title": "插件介绍",
    "about.body1":
      "Vocabulary Builder 是一个面向 Zotero 阅读场景的生词助手：阅读文献时选中英文单词并按 {shortcut}，即可将生词加入专属生词笔记，并自动补充翻译、释义、词性和音标。",
    "about.body2":
      "支持离线暂存、联网后重试翻译、自定义翻译 API、从笔记同步生词，以及导出到 CSV、TSV、JSON、Anki、Quizlet 和 Mochi。",
    "shortcut.title": "快捷键",
    "shortcut.addWord": "添加生词：",
    "shortcut.placeholder": "点击此处后按下组合键",
    "shortcut.reset": "重置为 Alt+A",
    "shortcut.hint":
      "点击输入框后按下新的组合键即可录制；支持 Ctrl、Alt、Shift、Meta 加字母、数字或 F1-F12。为避免干扰正常输入，快捷键必须包含 Ctrl、Alt 或 Meta 中的至少一个修饰键。按 Esc 可取消。",
    "shortcut.saved": "快捷键已更新：{shortcut}",
    "shortcut.invalid": "无效的快捷键：{shortcut}",
    "vocab.title": "生词",
    "vocab.open": "打开生词表",
    "vocab.quickPlaceholder": "输入单词...",
    "vocab.quickAdd": "+ 添加",
    "vocab.sync": "从生词笔记导入",
    "vocab.retryFailed": "重试待翻译",
    "highlight.title": "颜色设置",
    "highlight.jumpColor": "跳转高亮颜色：",
    "highlight.jumpPlaceholder": "留空使用 Zotero 默认颜色（如 #ffeb3b）",
    "highlight.hint": "点击生词笔记中的来源链接跳回 PDF 后，阅读器查找高亮的颜色。留空使用 Zotero 默认色。",
    "vocab.batchPlaceholder": "批量添加：每行一个单词，或使用逗号、分号分隔",
    "vocab.batchAdd": "批量添加",
    "api.title": "翻译 API",
    "api.provider": "服务商：",
    "api.option.youdao": "有道（内置）",
    "api.option.dictionary": "免费词典（内置）",
    "api.option.custom": "自定义 JSON API",
    "api.help.html":
      "使用 <code>{word}</code> 代表编码后的单词，<code>{wordRaw}</code> 代表原始单词。",
    "api.requestUrl": "请求地址：",
    "api.headers": "请求头（JSON）：",
    "api.transPath": "翻译路径：",
    "api.defPath": "释义路径：",
    "api.posPath": "词性路径：",
    "api.phonePath": "音标路径：",
    "api.examplePath": "例句路径（可选）：",
    "cache.title": "翻译缓存",
    "cache.enabled": "启用翻译缓存（离线词库）",
    "cache.path": "缓存路径：",
    "cache.pathPlaceholder": "留空使用默认位置",
    "cache.hint":
      "翻译结果会缓存到本地，离线时也能查看已查过的释义。默认位于 Zotero 配置目录 plugins/vocab-builder/translation-cache.json；可填写绝对路径或仅填写文件名。",
    "export.title": "导出",
    "export.format": "格式：",
    "export.scope": "范围：",
    "export.option.csv": "通用 CSV",
    "export.option.tsv": "通用 TSV",
    "export.option.json": "JSON 备份",
    "export.option.anki": "Anki 导入",
    "export.option.quizlet": "Quizlet 导入",
    "export.option.mochi": "Mochi 导入",
    "export.scope.all": "全部生词",
    "export.scope.completed": "仅已完成",
    "export.button": "导出生词",
    "export.hint.csv": "通用 CSV，适合表格工具和通用导入。",
    "export.hint.tsv": "通用 TSV，适合表格工具和纯文本导入。",
    "export.hint.json": "完整 JSON 备份，包含所有已保存字段。",
    "export.hint.anki":
      "Anki 导入用制表符分隔文件，列为 front、back、notes、tags。",
    "export.hint.quizlet": "Quizlet 导入用词条/释义两列制表符分隔文件。",
    "export.hint.mochi": "Mochi CSV，包含 Front、Back、Notes、Tags 列。",
    "feedback.title": "反馈邮箱",
    "feedback.description":
      "如果遇到问题或希望新增功能，请复制下方邮箱与作者联系。",
    "feedback.emailLabel": "邮箱：",
    "feedback.copyEmail": "复制邮箱",
    "donate.title": "支持 / 打赏",
    "donate.description":
      "如果这个插件帮你节省了整理生词的时间，欢迎扫码赞赏支持作者继续维护。",
    "donate.qrTitle": "微信赞赏码",
    "donate.qrAlt": "微信赞赏码",
    "donate.qrBody": "打开微信扫一扫即可赞赏。",
    "donate.summary":
      "感谢支持 Zotero Vocabulary Builder。如果这个插件帮助你提升了文献阅读效率，欢迎扫码赞赏支持作者继续维护。",
    "manual.title": "使用手册",
    "manual.item1.html":
      "阅读 PDF 或笔记时选中英文单词，按 <code>{shortcut}</code> 添加到生词表。",
    "manual.item2.html": "点击“打开生词表”查看、编辑和确认已同步的生词笔记。",
    "manual.item3.html": "离线时会先保存为待处理；联网后插件会自动重试翻译。",
    "manual.item4.html":
      "如需自定义翻译服务，选择“自定义 JSON API”，填写 URL、请求头和字段路径。",
    "manual.item5.html":
      "在“导出”区域选择格式和范围，可导出到常用表格或背单词软件。",
    "manual.footer":
      "建议首次安装后先添加 1 个测试单词，再打开生词表确认数量和翻译状态是否正常。",
    "notify.addedTranslated": "已添加并完成翻译：{word}",
    "notify.translationFailed": "翻译失败：{word}",
    "notify.offlineRetry": "已添加，联网后会自动翻译：{word}",
    "notify.error": "错误：{message}",
    "notify.noExport": "没有可导出的生词。",
    "notify.exported": "已导出为 {extension}。",
    "notify.noVocabulary": "还没有生词，请先添加单词。",
    "notify.imported": "已从笔记导入 {count} 个生词。",
    "notify.noNewWords": "笔记中没有新的生词。",
    "notify.added": "已添加：{word}",
    "notify.duplicateInvalid": "重复或无效单词。",
    "notify.duplicate": "重复：{word}",
    "notify.retrying": "正在重试 {count} 个待处理生词",
    "notify.retried": "已重试 {total} 个，成功 {ok} 个",
    "notify.retriedAll": "重试成功：{ok}/{total} 个生词已翻译",
    "notify.retryNone": "没有待翻译的生词",
    "notify.batchAdded": "已添加 {added} 个，跳过 {skipped} 个（重复或无效）",
    "notify.feedbackEmailCopied": "反馈邮箱已复制。",
    "menu.vocab": "生词表 ({count})",
    "menu.quickAdd": "+ 快速添加单词",
    "menu.enterWord": "输入单词：",
    "bubble.add": "＋ 加入生词表",
    "bubble.enabled": "选中单词时显示气泡按钮",
    "note.heading": "生词表",
    "note.empty": "暂无生词。",
    "note.summary": "总计：{total} 个生词 | 更新：{date}",
    "count.words": "{total} 个生词（已完成 {completed} 个）",
    "dialog.exportTitle": "导出生词",
  },
  "en-US": {
    "language.toggle": "中文 / English",
    "language.status": "Current language: English",
    "pref.title": "Vocabulary Builder",
    "pref.help": "{name} Build {version} {time}",
    "about.title": "About",
    "about.body1":
      "Vocabulary Builder helps you collect vocabulary while reading in Zotero. Select an English word and press {shortcut} to save it into a dedicated vocabulary note with translation, definition, part of speech, and phonetic details.",
    "about.body2":
      "It supports offline queueing, automatic retry, custom translation APIs, note sync, and exports for CSV, TSV, JSON, Anki, Quizlet, and Mochi.",
    "shortcut.title": "Shortcuts",
    "shortcut.addWord": "Add word:",
    "shortcut.placeholder": "Click here and press a combination",
    "shortcut.reset": "Reset to Alt+A",
    "shortcut.hint":
      "Click the input and press a key combination to record it. Ctrl, Alt, Shift, Meta plus a letter, digit or F1-F12 are supported. The shortcut must include Ctrl, Alt or Meta to avoid interfering with typing. Press Esc to cancel.",
    "shortcut.saved": "Shortcut updated: {shortcut}",
    "shortcut.invalid": "Invalid shortcut: {shortcut}",
    "vocab.title": "Vocabulary",
    "vocab.open": "Open Vocabulary",
    "vocab.quickPlaceholder": "Enter word...",
    "vocab.quickAdd": "+ Add",
    "vocab.sync": "Import From Vocabulary Note",
    "vocab.retryFailed": "Retry Pending Translations",
    "highlight.title": "Color Settings",
    "highlight.jumpColor": "Jump highlight color:",
    "highlight.jumpPlaceholder": "Leave empty for Zotero default (e.g. #ffeb3b)",
    "highlight.hint":
      "Color of the find-highlight shown after jumping back to a PDF from a source link in the vocabulary note. Leave empty for the Zotero default.",
    "vocab.batchPlaceholder":
      "Batch add: one word per line, or separated by commas or semicolons",
    "vocab.batchAdd": "Batch Add",
    "api.title": "Translation API",
    "api.provider": "Provider:",
    "api.option.youdao": "YouDao (built in)",
    "api.option.dictionary": "Free Dictionary (built in)",
    "api.option.custom": "Custom JSON API",
    "api.help.html":
      "Use <code>{word}</code> for the encoded word and <code>{wordRaw}</code> for the original word.",
    "api.requestUrl": "Request URL:",
    "api.headers": "Headers (JSON):",
    "api.transPath": "Translation path:",
    "api.defPath": "Definition path:",
    "api.posPath": "Part-of-speech path:",
    "api.phonePath": "Phonetic path:",
    "api.examplePath": "Example path (optional):",
    "cache.title": "Translation Cache",
    "cache.enabled": "Enable translation cache (offline dictionary)",
    "cache.path": "Cache path:",
    "cache.pathPlaceholder": "Leave empty for default location",
    "cache.hint":
      "Translation results are cached locally so previously looked-up words are available offline. Default location: plugins/vocab-builder/translation-cache.json inside the Zotero profile directory. You may enter an absolute path or a file name.",
    "export.title": "Export",
    "export.format": "Format:",
    "export.scope": "Scope:",
    "export.option.csv": "Universal CSV",
    "export.option.tsv": "Universal TSV",
    "export.option.json": "JSON Backup",
    "export.option.anki": "Anki Import",
    "export.option.quizlet": "Quizlet Import",
    "export.option.mochi": "Mochi Import",
    "export.scope.all": "All words",
    "export.scope.completed": "Completed only",
    "export.button": "Export Vocabulary",
    "export.hint.csv":
      "Universal CSV for spreadsheets and general import tools.",
    "export.hint.tsv":
      "Universal TSV for spreadsheet tools and plain text import.",
    "export.hint.json": "Full JSON backup with all stored fields.",
    "export.hint.anki":
      "Tab-separated file for Anki import. Columns: front, back, notes, tags.",
    "export.hint.quizlet":
      "Tab-separated term/definition export for Quizlet-style import flows.",
    "export.hint.mochi":
      "CSV with Front, Back, Notes, and Tags columns for Mochi.",
    "feedback.title": "Feedback Email",
    "feedback.description":
      "Copy the email address below if you want to report a bug or request a feature.",
    "feedback.emailLabel": "Email:",
    "feedback.copyEmail": "Copy Email",
    "donate.title": "Support / Donate",
    "donate.description":
      "If this plugin saves you time, scan the WeChat reward code below to support future maintenance.",
    "donate.qrTitle": "WeChat Reward Code",
    "donate.qrAlt": "WeChat Reward Code",
    "donate.qrBody": "Open WeChat and scan this code to donate.",
    "donate.summary":
      "Thank you for supporting Zotero Vocabulary Builder. If this plugin helps your reading workflow, scan the reward code to support future maintenance.",
    "manual.title": "User Manual",
    "manual.item1.html":
      "Select an English word in a PDF or note and press <code>{shortcut}</code> to add it.",
    "manual.item2.html":
      "Use “Open Vocabulary” to review, edit, and confirm the synced vocabulary note.",
    "manual.item3.html":
      "Offline words are saved as pending and retried after you reconnect.",
    "manual.item4.html":
      "For a custom translation service, select “Custom JSON API” and fill in the URL, headers, and response paths.",
    "manual.item5.html":
      "Choose an export format and scope to send data to spreadsheets or vocabulary apps.",
    "manual.footer":
      "After first installation, add one test word and open the vocabulary note to confirm the count and translation status.",
    "notify.addedTranslated": "Added and translated: {word}",
    "notify.translationFailed": "Translation failed: {word}",
    "notify.offlineRetry":
      "Added. Translation will retry when back online: {word}",
    "notify.error": "Error: {message}",
    "notify.noExport": "No vocabulary to export.",
    "notify.exported": "Exported as {extension}.",
    "notify.noVocabulary": "No vocabulary yet. Add a word first.",
    "notify.imported": "Imported {count} words from note.",
    "notify.noNewWords": "No new words found in note.",
    "notify.added": "Added: {word}",
    "notify.duplicateInvalid": "Duplicate or invalid word.",
    "notify.duplicate": "Duplicate: {word}",
    "notify.retrying": "Retrying {count} pending words",
    "notify.retried": "Retried {total}, succeeded {ok}",
    "notify.retriedAll": "Retry finished: {ok}/{total} words translated",
    "notify.retryNone": "No pending words to retry",
    "notify.batchAdded":
      "Added {added}, skipped {skipped} (duplicate or invalid)",
    "notify.feedbackEmailCopied": "Feedback email copied.",
    "menu.vocab": "Vocabulary ({count})",
    "menu.quickAdd": "+ Quick Add Word",
    "menu.enterWord": "Enter word:",
    "bubble.add": "+ Add to vocabulary",
    "bubble.enabled": "Show a bubble button when selecting a word",
    "note.heading": "Vocabulary List",
    "note.empty": "No words yet.",
    "note.summary": "Total: {total} words | Updated: {date}",
    "count.words": "{total} words ({completed} completed)",
    "dialog.exportTitle": "Export Vocabulary",
  },
};

export function normalizeUILanguage(
  value: string | null | undefined,
): UILanguage {
  return value === "en-US" ? "en-US" : DEFAULT_UI_LANGUAGE;
}

export function t(
  language: UILanguage,
  key: string,
  vars: Record<string, string | number> = {},
): string {
  const template =
    UI_TEXT[language][key] ?? UI_TEXT[DEFAULT_UI_LANGUAGE][key] ?? key;

  return template.replace(/\{(\w+)\}/g, (_match, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : "",
  );
}

export function getExportHint(
  language: UILanguage,
  format: ExportFormat,
): string {
  return t(language, `export.hint.${format}`);
}

export function getWordCountLabel(
  language: UILanguage,
  total: number,
  completed: number,
): string {
  return t(language, "count.words", { total, completed });
}

export function applyDocumentLanguage(
  doc: Document,
  language: UILanguage,
  vars: Record<string, string | number> = {},
) {
  for (const element of Array.from<Element>(
    doc.querySelectorAll("[data-vb-i18n]"),
  )) {
    const key = element.getAttribute("data-vb-i18n");
    if (!key) continue;
    element.textContent = t(language, key, vars);
  }

  for (const element of Array.from<Element>(
    doc.querySelectorAll("[data-vb-i18n-html]"),
  )) {
    const key = element.getAttribute("data-vb-i18n-html");
    if (!key) continue;
    (element as HTMLElement).innerHTML = t(language, key, vars);
  }

  applyAttributeTranslations(doc, language, vars, "placeholder");
  applyAttributeTranslations(doc, language, vars, "alt");
}

function applyAttributeTranslations(
  doc: Document,
  language: UILanguage,
  vars: Record<string, string | number>,
  attrName: "placeholder" | "alt",
) {
  const selector = `[data-vb-i18n-${attrName}]`;
  const attrKey = `data-vb-i18n-${attrName}`;

  for (const element of Array.from<Element>(doc.querySelectorAll(selector))) {
    const key = element.getAttribute(attrKey);
    if (!key) continue;
    element.setAttribute(attrName, t(language, key, vars));
  }
}
