import { createVocabEntry, type VocabEntry } from "./note-state";

export interface PersistedState {
  noteID: number | null;
  entries: VocabEntry[];
}

const PLUGIN_DIR_NAME = "vocab-builder";
const STATE_FILE_NAME = "state.json";

export async function loadPersistedState(): Promise<PersistedState> {
  const statePath = getStateFilePath();
  if (!statePath) return { noteID: null, entries: [] };

  try {
    if (!(await IOUtils.exists(statePath))) {
      return { noteID: null, entries: [] };
    }

    const raw = JSON.parse(await IOUtils.readUTF8(statePath));
    return {
      noteID: normalizeNoteID(raw?.noteID),
      entries: normalizeEntries(raw?.entries),
    };
  } catch (e) {
    return { noteID: null, entries: [] };
  }
}

export async function savePersistedState(state: PersistedState): Promise<void> {
  const statePath = getStateFilePath();
  const stateDir = getStateDirPath();
  if (!statePath || !stateDir) return;

  await IOUtils.makeDirectory(stateDir, { ignoreExisting: true });
  await IOUtils.writeUTF8(
    statePath,
    JSON.stringify(
      {
        noteID: normalizeNoteID(state.noteID),
        entries: normalizeEntries(state.entries),
      },
      null,
      2,
    ),
  );
}

function getStateFilePath(): string | null {
  const stateDir = getStateDirPath();
  return stateDir ? PathUtils.join(stateDir, STATE_FILE_NAME) : null;
}

function getStateDirPath(): string | null {
  const profileDir = getProfileDir();
  return profileDir
    ? PathUtils.join(profileDir, "plugins", PLUGIN_DIR_NAME)
    : null;
}

function getProfileDir(): string {
  try {
    const profileDir = (Zotero as any).ProfileDirectory;
    if (profileDir) {
      return typeof profileDir === "string" ? profileDir : profileDir.path;
    }
  } catch (e) {}

  try {
    return (
      (Components as any)
        .classes["@mozilla.org/file/directory_service;1"]
        .getService(Components.interfaces.nsIProperties)
        .get("ProfD", Components.interfaces.nsIFile) as any
    ).path;
  } catch (e) {
    return "";
  }
}

function normalizeNoteID(value: unknown): number | null {
  const noteID = Number(value || 0);
  return Number.isInteger(noteID) && noteID > 0 ? noteID : null;
}

function normalizeEntries(entries: unknown): VocabEntry[] {
  if (!Array.isArray(entries)) return [];

  const normalized: VocabEntry[] = [];
  const seen = new Set<string>();

  for (const rawEntry of entries) {
    if (!rawEntry || typeof rawEntry !== "object") continue;

    const word = String((rawEntry as any).word || "");
    const entry = createVocabEntry(word, {
      id: String((rawEntry as any).id || ""),
      def: String((rawEntry as any).def || ""),
      pos: String((rawEntry as any).pos || ""),
      phone: String((rawEntry as any).phone || ""),
      trans: String((rawEntry as any).trans || ""),
      ctx: String((rawEntry as any).ctx || ""),
      src: String((rawEntry as any).src || ""),
      created:
        typeof (rawEntry as any).created === "string" &&
        (rawEntry as any).created
          ? (rawEntry as any).created
          : undefined,
      status: (rawEntry as any).status,
      tries: normalizeTries((rawEntry as any).tries),
    });

    if (!entry.word || seen.has(entry.word)) continue;
    seen.add(entry.word);
    normalized.push(entry);
  }

  return normalized;
}

function normalizeTries(value: unknown): number {
  const tries = Number(value || 0);
  return Number.isFinite(tries) && tries >= 0 ? Math.floor(tries) : 0;
}
