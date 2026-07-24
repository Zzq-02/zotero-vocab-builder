import { DEFAULT_UI_LANGUAGE, type UILanguage, t } from "./ui-language";

export type VocabStatus = "pending" | "completed" | "failed";

export interface VocabEntry {
  id: string;
  word: string;
  def: string;
  pos: string;
  phone: string;
  trans: string;
  ctx: string;
  src: string;
  created: string;
  status: VocabStatus;
  tries: number;
}

export interface NoteEntry {
  word: string;
  rawHTML?: string;
  entry?: VocabEntry;
}

type NoteFieldKey =
  | "translation"
  | "definition"
  | "pos"
  | "phonetic"
  | "context";

export const NOTE_TAG = "vocab-builder";
export const NOTE_SEARCH_MARKER = "Vocabulary List";

const STATUS_SYMBOLS: Record<VocabStatus, string> = {
  pending: "\u2026",
  completed: "\u2705",
  failed: "\u274c",
};

const STABLE_NOTE_CREATED_AT = "1970-01-01T00:00:00.000Z";

const NOTE_FIELD_LABELS: Record<UILanguage, Record<NoteFieldKey, string>> = {
  "en-US": {
    translation: "translation",
    definition: "definition",
    pos: "pos",
    phonetic: "phonetic",
    context: "context",
  },
  "zh-CN": {
    translation: "\u7ffb\u8bd1",
    definition: "\u91ca\u4e49",
    pos: "\u8bcd\u6027",
    phonetic: "\u97f3\u6807",
    context: "\u8bed\u5883",
  },
};

const NOTE_FIELD_ALIASES: Record<NoteFieldKey, string[]> = {
  translation: ["translation", "\u7ffb\u8bd1"],
  definition: ["definition", "\u91ca\u4e49"],
  pos: ["pos", "part of speech", "\u8bcd\u6027"],
  phonetic: ["phonetic", "phone", "\u97f3\u6807"],
  context: [
    "context",
    "example",
    "\u8bed\u5883",
    "\u4f8b\u53e5",
    "\u4e0a\u4e0b\u6587",
  ],
};

export function cleanWord(text: string): string {
  if (!text) return "";
  return text
    .trim()
    .replace(/[^a-zA-Z'\- ]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function createVocabEntry(
  word: string,
  overrides: Partial<VocabEntry> = {},
): VocabEntry {
  const cleaned = cleanWord(word);
  const created = overrides.created || new Date().toISOString();
  return {
    id:
      overrides.id ||
      `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    word: cleaned,
    def: overrides.def || "",
    pos: overrides.pos || "",
    phone: overrides.phone || "",
    trans: overrides.trans || "",
    ctx: overrides.ctx || "",
    src: overrides.src || "",
    created,
    status: normalizeStatus(overrides.status),
    tries: typeof overrides.tries === "number" ? overrides.tries : 0,
  };
}

export function parseNoteHTML(html: string): NoteEntry[] {
  if (!html) return [];

  const entries: NoteEntry[] = [];
  const seen = new Set<string>();
  const matches = html.match(/<li\b[^>]*>[\s\S]*?<\/li>/gi) || [];

  for (const rawHTML of matches) {
    const structured =
      parseVisibleStructuredEntry(rawHTML) || parseStructuredEntry(rawHTML);
    const fallbackWord =
      readMarkedWord(rawHTML) || readFirstVisibleWord(rawHTML);
    const word = structured?.word || fallbackWord;

    if (!word || seen.has(word)) continue;

    seen.add(word);
    entries.push(
      structured ? { word, rawHTML, entry: structured } : { word, rawHTML },
    );
  }

  return entries;
}

export function extractMutableEntries(entries: NoteEntry[]): VocabEntry[] {
  const mutable = entries
    .map((item) => item.entry)
    .filter((item): item is VocabEntry => Boolean(item))
    .filter((item) => item.status !== "completed");

  const seen = new Set<string>();
  return mutable.filter((item) => {
    if (seen.has(item.word)) return false;
    seen.add(item.word);
    return true;
  });
}

export function buildEntriesFromNoteEntries(entries: NoteEntry[]): VocabEntry[] {
  const rebuilt: VocabEntry[] = [];
  const seen = new Set<string>();

  for (const item of entries) {
    const nextEntry = item.entry
      ? { ...item.entry }
      : createStableNoteEntry(item.word, { status: "completed" });

    if (!nextEntry.word || seen.has(nextEntry.word)) continue;
    seen.add(nextEntry.word);
    rebuilt.push(nextEntry);
  }

  return rebuilt;
}

export function mergeNoteEntries(
  noteEntries: NoteEntry[],
  sessionEntries: VocabEntry[],
): NoteEntry[] {
  const dedupedSessionEntries = dedupeSessionEntries(sessionEntries);
  const noteWords = new Set(noteEntries.map((item) => item.word));
  const sessionByWord = new Map(
    dedupedSessionEntries.map((item) => [item.word, item] as const),
  );

  const merged: NoteEntry[] = [];

  for (const item of dedupedSessionEntries) {
    if (!noteWords.has(item.word)) {
      merged.push({ word: item.word, entry: item });
    }
  }

  for (const item of noteEntries) {
    const override = sessionByWord.get(item.word);
    if (override) {
      merged.push({ word: override.word, entry: override });
      sessionByWord.delete(item.word);
      continue;
    }
    merged.push(item);
  }

  return merged;
}

export function renderNoteHTML(
  entries: NoteEntry[],
  updatedAt = new Date(),
  language: UILanguage = DEFAULT_UI_LANGUAGE,
): string {
  const items = entries
    .map((item) => {
      if (item.entry) return renderStructuredEntry(item.entry, language);
      return item.rawHTML || "";
    })
    .join("");

  const body =
    items || `<li><i>${escapeHtml(t(language, "note.empty"))}</i></li>`;
  const dateLabel = updatedAt.toLocaleDateString();

  return [
    `<div class="zotero-note znv1" data-vocab-builder="1">`,
    `<h1>${escapeHtml(t(language, "note.heading"))}</h1>`,
    `<p><i>${escapeHtml(
      t(language, "note.summary", { total: entries.length, date: dateLabel }),
    )}</i></p>`,
    `<hr><ul>`,
    body,
    `</ul></div>`,
  ].join("");
}

function dedupeSessionEntries(entries: VocabEntry[]): VocabEntry[] {
  const deduped: VocabEntry[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (!entry?.word || seen.has(entry.word)) continue;
    seen.add(entry.word);
    deduped.push(entry);
  }

  return deduped;
}

function createStableNoteEntry(
  word: string,
  overrides: Partial<VocabEntry> = {},
): VocabEntry {
  const cleaned = cleanWord(word);
  return createVocabEntry(cleaned, {
    id: overrides.id || buildStableEntryID(cleaned),
    created: overrides.created || STABLE_NOTE_CREATED_AT,
    ...overrides,
  });
}

function buildStableEntryID(word: string): string {
  return `note:${cleanWord(word).replace(/\s+/g, "-")}`;
}

function renderStructuredEntry(
  entry: VocabEntry,
  language: UILanguage,
): string {
  const attrs = [
    `class="vb-entry"`,
    `data-vb-id="${escapeHtml(entry.id)}"`,
    `data-vb-created="${escapeHtml(entry.created)}"`,
    `data-vb-tries="${String(entry.tries || 0)}"`,
    `data-vb-status="${escapeHtml(entry.status)}"`,
  ];
  if (entry.src) {
    attrs.push(`data-vb-src="${escapeHtml(entry.src)}"`);
  }

  const icon =
    entry.status === "completed"
      ? STATUS_SYMBOLS.completed
      : entry.status === "failed"
        ? STATUS_SYMBOLS.failed
        : STATUS_SYMBOLS.pending;
  const word = renderLinkedWord(entry.word, entry.src);
  const fields = [
    renderVisibleField("translation", entry.trans, language),
    renderVisibleField("definition", entry.def, language),
    renderVisibleField("pos", entry.pos, language),
    renderVisibleField(
      "phonetic",
      entry.phone ? `/${entry.phone}/` : "",
      language,
    ),
  ].join("");
  const ctx = entry.ctx
    ? `<br>${renderVisibleField("context", entry.ctx, language, false)}`
    : "";

  return [
    `<li ${attrs.join(" ")}>`,
    `${icon} ${word}${fields}${ctx}</li>`,
  ].join("");
}

function renderLinkedWord(word: string, href: string): string {
  const content = `<strong>${escapeHtml(word)}</strong>`;
  if (!href) return content;
  return `<a href="${escapeHtml(href)}">${content}</a>`;
}

function renderVisibleField(
  key: NoteFieldKey,
  value: string,
  language: UILanguage,
  leadingSpace = true,
): string {
  if (!value) return "";
  const label =
    NOTE_FIELD_LABELS[language]?.[key] || NOTE_FIELD_LABELS["en-US"][key];
  const spacer = leadingSpace ? " " : "";
  return `${spacer}${label}: ${escapeHtml(value)}`;
}

function parseStructuredEntry(rawHTML: string): VocabEntry | null {
  const attrWord = cleanWord(readAttr(rawHTML, "data-vb-word"));
  if (!attrWord || !visibleWordStillPresent(rawHTML, attrWord)) return null;

  return createStableNoteEntry(attrWord, {
    id: readAttr(rawHTML, "data-vb-id") || buildStableEntryID(attrWord),
    status: normalizeStatus(readAttr(rawHTML, "data-vb-status")),
    tries: Number.parseInt(readAttr(rawHTML, "data-vb-tries") || "0", 10) || 0,
    created:
      readAttr(rawHTML, "data-vb-created") || STABLE_NOTE_CREATED_AT,
    trans: readAttr(rawHTML, "data-vb-trans"),
    def: readAttr(rawHTML, "data-vb-def"),
    pos: readAttr(rawHTML, "data-vb-pos"),
    phone: readAttr(rawHTML, "data-vb-phone"),
    ctx: readAttr(rawHTML, "data-vb-ctx"),
    src: readAttr(rawHTML, "data-vb-src"),
  });
}

function parseVisibleStructuredEntry(rawHTML: string): VocabEntry | null {
  const text = readVisibleText(rawHTML);
  if (!looksLikeRenderedEntry(text)) return null;

  const word = readMarkedWord(rawHTML) || readFirstVisibleWord(rawHTML);
  if (!word) return null;

  return createStableNoteEntry(word, {
    id: readAttr(rawHTML, "data-vb-id") || buildStableEntryID(word),
    status: readVisibleStatus(
      text,
      normalizeStatus(readAttr(rawHTML, "data-vb-status")),
    ),
    tries: Number.parseInt(readAttr(rawHTML, "data-vb-tries") || "0", 10) || 0,
    created:
      readAttr(rawHTML, "data-vb-created") || STABLE_NOTE_CREATED_AT,
    trans: readVisibleFieldValue(text, NOTE_FIELD_ALIASES.translation),
    def: readVisibleFieldValue(text, NOTE_FIELD_ALIASES.definition),
    pos: readVisibleFieldValue(text, NOTE_FIELD_ALIASES.pos),
    phone: normalizePhone(
      readVisibleFieldValue(text, NOTE_FIELD_ALIASES.phonetic),
    ),
    ctx: readVisibleFieldValue(text, NOTE_FIELD_ALIASES.context),
    src: readAttr(rawHTML, "data-vb-src"),
  });
}

function readMarkedWord(rawHTML: string): string {
  const normalizedHTML = normalizeEncodedMarkup(rawHTML);
  const match = normalizedHTML.match(/<(?:b|strong)>([\s\S]*?)<\/(?:b|strong)>/i);
  return cleanWord(decodeHtml(match?.[1] || ""));
}

function readFirstVisibleWord(rawHTML: string): string {
  const text = stripStatusSymbols(readVisibleText(rawHTML));
  const labelMatch = text.match(
    new RegExp(`(?:${visibleFieldLabels().map(escapeRegExp).join("|")})\\s*[:\uFF1A]`, "i"),
  );
  const candidateText = labelMatch ? text.slice(0, labelMatch.index) : text;
  const word = cleanWord(
    candidateText.match(/[a-zA-Z][a-zA-Z'\-]*(?: [a-zA-Z][a-zA-Z'\-]*)?/)?.[0] ||
      "",
  );
  return looksLikeMarkupWord(word) ? "" : word;
}

function visibleWordStillPresent(rawHTML: string, word: string): boolean {
  const markedWord = readMarkedWord(rawHTML);
  if (markedWord) return markedWord === word;

  return readFirstVisibleWord(rawHTML) === word;
}

function readVisibleText(rawHTML: string): string {
  const normalizedHTML = normalizeEncodedMarkup(rawHTML);
  return decodeHtml(
    normalizedHTML
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function looksLikeRenderedEntry(text: string): boolean {
  return (
    hasStatusSymbol(text) ||
    visibleFieldLabels().some((label) =>
      new RegExp(`${escapeRegExp(label)}\\s*[:\uFF1A]`, "i").test(text),
    )
  );
}

function readVisibleStatus(text: string, fallback: VocabStatus): VocabStatus {
  if (text.includes(STATUS_SYMBOLS.failed)) return "failed";
  if (text.includes(STATUS_SYMBOLS.completed)) return "completed";
  if (text.includes(STATUS_SYMBOLS.pending)) return "pending";
  return fallback;
}

function readVisibleFieldValue(text: string, labels: string[]): string {
  const allLabels = visibleFieldLabels().map(escapeRegExp).join("|");

  for (const label of labels) {
    const pattern = new RegExp(
      `${escapeRegExp(label)}\\s*[:\uFF1A]\\s*([\\s\\S]*?)(?=\\s+(?:${allLabels})\\s*[:\uFF1A]|$)`,
      "i",
    );
    const value = text.match(pattern)?.[1]?.trim() || "";
    if (value) return value;
  }

  return "";
}

function visibleFieldLabels(): string[] {
  return Array.from(
    new Set(Object.values(NOTE_FIELD_ALIASES).flatMap((labels) => labels)),
  );
}

function normalizePhone(value: string): string {
  return value.replace(/^\/+|\/+$/g, "").trim();
}

function stripStatusSymbols(text: string): string {
  return [STATUS_SYMBOLS.completed, STATUS_SYMBOLS.failed, STATUS_SYMBOLS.pending]
    .reduce((next, symbol) => next.split(symbol).join(" "), text)
    .trim();
}

function hasStatusSymbol(text: string): boolean {
  return [
    STATUS_SYMBOLS.completed,
    STATUS_SYMBOLS.failed,
    STATUS_SYMBOLS.pending,
  ].some((symbol) => text.includes(symbol));
}

function normalizeEncodedMarkup(rawHTML: string): string {
  let normalized = rawHTML;
  for (let i = 0; i < 3; i++) {
    const decoded = decodeHtml(normalized);
    if (decoded === normalized) break;
    normalized = decoded;
  }
  return normalized;
}

function looksLikeMarkupWord(word: string): boolean {
  if (!word) return false;

  const markupTokens = new Set([
    "span",
    "style",
    "color",
    "rgb",
    "strong",
    "class",
    "font",
    "div",
    "li",
    "br",
  ]);
  return word.split(/\s+/).some((token) => {
    if (!token) return false;
    if (markupTokens.has(token)) return true;
    return token.startsWith("style") || token.startsWith("color");
  });
}

function readAttr(rawHTML: string, attrName: string): string {
  const pattern = new RegExp(`${attrName}="([^"]*)"`, "i");
  return decodeHtml(rawHTML.match(pattern)?.[1] || "");
}

function normalizeStatus(status: unknown): VocabStatus {
  return status === "completed" || status === "failed" ? status : "pending";
}

function escapeHtml(value: string): string {
  if (!value) return "";
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeHtml(value: string): string {
  if (!value) return "";
  return value
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}
