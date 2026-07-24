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

export const NOTE_TAG = "vocab-builder";
export const NOTE_SEARCH_MARKER = "Vocabulary List";

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
    const structured = parseStructuredEntry(rawHTML);
    const fallbackWord = readMarkedWord(rawHTML);
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
      if (item.entry) return renderStructuredEntry(item.entry);
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

function renderStructuredEntry(entry: VocabEntry): string {
  const icon =
    entry.status === "completed"
      ? `<span class="vb-status vb-status-success" style="color:#23a55a;font-weight:700;">&#10003;</span>`
      : entry.status === "failed"
        ? `<span class="vb-status vb-status-failed" style="color:#d64545;font-weight:700;">&#10007;</span>`
        : `<span class="vb-status vb-status-pending" style="color:#7b8a82;font-weight:700;">&#8230;</span>`;
  const phone = entry.phone
    ? ` <span class="vb-phone">/${escapeHtml(entry.phone)}/</span>`
    : "";
  const pos = entry.pos
    ? ` <i class="vb-pos">(${escapeHtml(entry.pos)})</i>`
    : "";
  const trans = entry.trans
    ? ` <span class="vb-trans" style="color:#c00;">${escapeHtml(entry.trans)}</span>`
    : "";
  const def = entry.def
    ? ` <span class="vb-def">- ${escapeHtml(entry.def)}</span>`
    : "";
  const ctx = entry.ctx
    ? `<br><span class="vb-ctx" style="color:#888;">"${escapeHtml(entry.ctx)}"</span>`
    : "";

  return [
    `<li class="vb-entry"`,
    ` data-vb-id="${escapeHtml(entry.id)}"`,
    ` data-vb-word="${escapeHtml(entry.word)}"`,
    ` data-vb-status="${escapeHtml(entry.status)}"`,
    ` data-vb-tries="${escapeHtml(String(entry.tries))}"`,
    ` data-vb-created="${escapeHtml(entry.created)}"`,
    ` data-vb-trans="${escapeHtml(entry.trans)}"`,
    ` data-vb-def="${escapeHtml(entry.def)}"`,
    ` data-vb-pos="${escapeHtml(entry.pos)}"`,
    ` data-vb-phone="${escapeHtml(entry.phone)}"`,
    ` data-vb-ctx="${escapeHtml(entry.ctx)}"`,
    ` data-vb-src="${escapeHtml(entry.src)}">`,
    `${icon} <b>${escapeHtml(entry.word)}</b>${phone}${pos}${trans}${def}${ctx}</li>`,
  ].join("");
}

function parseStructuredEntry(rawHTML: string): VocabEntry | null {
  const attrWord = cleanWord(readAttr(rawHTML, "data-vb-word"));
  if (!attrWord) return null;

  return createVocabEntry(attrWord, {
    id: readAttr(rawHTML, "data-vb-id"),
    status: normalizeStatus(readAttr(rawHTML, "data-vb-status")),
    tries: Number.parseInt(readAttr(rawHTML, "data-vb-tries") || "0", 10) || 0,
    created: readAttr(rawHTML, "data-vb-created") || new Date().toISOString(),
    trans: readAttr(rawHTML, "data-vb-trans"),
    def: readAttr(rawHTML, "data-vb-def"),
    pos: readAttr(rawHTML, "data-vb-pos"),
    phone: readAttr(rawHTML, "data-vb-phone"),
    ctx: readAttr(rawHTML, "data-vb-ctx"),
    src: readAttr(rawHTML, "data-vb-src"),
  });
}

function readMarkedWord(rawHTML: string): string {
  const match = rawHTML.match(/<(?:b|strong)>([\s\S]*?)<\/(?:b|strong)>/i);
  return cleanWord(decodeHtml(match?.[1] || ""));
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

function decodeHtml(value: string): string {
  if (!value) return "";
  return value
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}
