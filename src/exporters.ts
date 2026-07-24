import type { VocabEntry } from "./note-state";

export type ExportFormat =
  | "csv"
  | "tsv"
  | "json"
  | "anki"
  | "quizlet"
  | "mochi";

export type ExportScope = "all" | "completed";

export interface ExportBundle {
  content: string;
  extension: string;
  filterLabel: string;
  defaultFileName: string;
}

export function buildExportBundle(
  format: ExportFormat,
  scope: ExportScope,
  entries: VocabEntry[],
  exportedAt = new Date(),
): ExportBundle {
  const filteredEntries =
    scope === "completed"
      ? entries.filter((entry) => entry.status === "completed")
      : entries;
  const stamp = formatDateStamp(exportedAt);

  switch (format) {
    case "tsv":
      return {
        content: buildDelimitedExport(filteredEntries, "\t"),
        extension: "tsv",
        filterLabel: "TSV File",
        defaultFileName: `vocabulary-export-${stamp}.tsv`,
      };
    case "json":
      return {
        content: JSON.stringify(filteredEntries, null, 2),
        extension: "json",
        filterLabel: "JSON File",
        defaultFileName: `vocabulary-export-${stamp}.json`,
      };
    case "anki":
      return {
        content: buildAnkiExport(filteredEntries),
        extension: "txt",
        filterLabel: "Anki Import File",
        defaultFileName: `vocabulary-anki-${stamp}.txt`,
      };
    case "quizlet":
      return {
        content: buildQuizletExport(filteredEntries),
        extension: "txt",
        filterLabel: "Quizlet Import File",
        defaultFileName: `vocabulary-quizlet-${stamp}.txt`,
      };
    case "mochi":
      return {
        content: buildMochiExport(filteredEntries),
        extension: "csv",
        filterLabel: "Mochi CSV File",
        defaultFileName: `vocabulary-mochi-${stamp}.csv`,
      };
    case "csv":
    default:
      return {
        content: buildDelimitedExport(filteredEntries, ","),
        extension: "csv",
        filterLabel: "CSV File",
        defaultFileName: `vocabulary-export-${stamp}.csv`,
      };
  }
}

function buildDelimitedExport(entries: VocabEntry[], delimiter: "," | "\t"): string {
  const rows = [
    [
      "word",
      "translation",
      "definition",
      "partOfSpeech",
      "phonetic",
      "context",
      "source",
      "status",
      "created",
      "tries",
    ],
    ...entries.map((entry) => [
      entry.word,
      entry.trans,
      entry.def,
      entry.pos,
      entry.phone,
      entry.ctx,
      entry.src,
      entry.status,
      entry.created,
      String(entry.tries),
    ]),
  ];

  return rows.map((row) => row.map((cell) => quoteCell(cell, delimiter)).join(delimiter)).join("\n");
}

function buildAnkiExport(entries: VocabEntry[]): string {
  const rows = entries.map((entry) => [
    entry.word,
    buildMeaning(entry),
    entry.ctx || entry.def,
    buildTags(entry),
  ]);

  return rows.map((row) => row.map((cell) => quoteCell(cell, "\t")).join("\t")).join("\n");
}

function buildQuizletExport(entries: VocabEntry[]): string {
  const rows = entries.map((entry) => [
    entry.word,
    buildMeaning(entry, {
      includePos: true,
      includePhonetic: true,
      includeContext: true,
    }),
  ]);

  return rows.map((row) => row.map((cell) => quoteCell(cell, "\t")).join("\t")).join("\n");
}

function buildMochiExport(entries: VocabEntry[]): string {
  const rows = [
    ["Front", "Back", "Notes", "Tags"],
    ...entries.map((entry) => [
      entry.word,
      buildMeaning(entry, { includePos: true, includePhonetic: true }),
      entry.ctx || entry.def || entry.src,
      buildTags(entry),
    ]),
  ];

  return rows.map((row) => row.map((cell) => quoteCell(cell, ",")).join(",")).join("\n");
}

function buildMeaning(
  entry: VocabEntry,
  options: {
    includePos?: boolean;
    includePhonetic?: boolean;
    includeContext?: boolean;
  } = {},
): string {
  const parts: string[] = [];

  if (entry.trans) parts.push(entry.trans);
  if (entry.def && entry.def !== entry.trans) parts.push(entry.def);
  if (options.includePos && entry.pos) parts.push(`POS: ${entry.pos}`);
  if (options.includePhonetic && entry.phone) parts.push(`/${entry.phone}/`);
  if (options.includeContext && entry.ctx) parts.push(`Context: ${entry.ctx}`);

  return parts.filter(Boolean).join(" | ");
}

function buildTags(entry: VocabEntry): string {
  const tags = ["vocab-builder", `status-${entry.status}`];
  if (entry.pos) tags.push(`pos-${sanitizeTag(entry.pos)}`);
  return tags.join(" ");
}

function sanitizeTag(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function quoteCell(value: string, delimiter: "," | "\t"): string {
  const text = value ?? "";
  if (
    !text.includes('"') &&
    !text.includes("\n") &&
    !text.includes("\r") &&
    !text.includes(delimiter)
  ) {
    return text;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

function formatDateStamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}
