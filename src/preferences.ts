import { config, version } from "../package.json";
import {
  buildCustomAPIUrl,
  extractCustomAPIFields,
  parseCustomAPIConfig,
} from "./custom-api";
import {
  buildExportBundle,
  type ExportFormat,
  type ExportScope,
} from "./exporters";
import {
  buildEntriesFromNoteEntries,
  NOTE_SEARCH_MARKER,
  NOTE_TAG,
  cleanWord,
  createVocabEntry,
  parseNoteHTML,
  renderNoteHTML,
  type NoteEntry,
  type VocabEntry,
} from "./note-state";
import { showNotification, type NotificationTone } from "./notifications";
import { clearPersistedState, loadPersistedState } from "./state-store";
import {
  applyDocumentLanguage,
  DEFAULT_UI_LANGUAGE,
  FEEDBACK_EMAIL,
  getExportHint,
  getWordCountLabel,
  normalizeUILanguage,
  t,
  type UILanguage,
} from "./ui-language";
import { getPref, setPref } from "./utils/prefs";
import {
  DEFAULT_QUICK_ADD_SHORTCUT,
  formatShortcutLabel,
  isValidShortcut,
  shortcutFromEvent,
} from "./utils/shortcut";

const NOTE_ID_PREF = `${config.prefsPrefix}.noteID`;
const prefsGlobal = globalThis as any;
const DEFAULT_TEXT_PREFS: Partial<
  Record<
    | "customApiUrl"
    | "customApiHeaders"
    | "customApiTransPath"
    | "customApiDefPath"
    | "customApiPosPath"
    | "customApiPhonePath"
    | "exportFormat"
    | "exportScope",
    string
  >
> = {
  customApiHeaders: "{}",
  exportFormat: "csv",
  exportScope: "all",
};

function getPrefsWindow(): any {
  return typeof prefsGlobal.window !== "undefined"
    ? prefsGlobal.window
    : prefsGlobal;
}

function getPrefsDocument(): Document {
  return getPrefsWindow().document as Document;
}

function getMaybePrefsDocument(): Document | null {
  try {
    return getPrefsDocument();
  } catch (e) {
    return null;
  }
}

type APIProvider = "youdao" | "dictionary" | "custom";

const state: {
  entries: VocabEntry[];
  noteID: number | null;
  syncBusy: boolean;
  syncPending: boolean;
  apiName: APIProvider;
  uiLanguage: UILanguage;
  quickAddShortcut: string;
  loadPromise: Promise<void> | null;
  initPromise: Promise<void> | null;
} = {
  entries: [],
  noteID: readStoredNoteID(),
  syncBusy: false,
  syncPending: false,
  apiName: "youdao",
  uiLanguage: DEFAULT_UI_LANGUAGE,
  quickAddShortcut: DEFAULT_QUICK_ADD_SHORTCUT,
  loadPromise: null,
  initPromise: null,
};

function normalizeAPIProvider(value: string): APIProvider {
  return value === "dictionary" || value === "custom" ? value : "youdao";
}

function loadSettingsFromPrefs() {
  state.apiName = normalizeAPIProvider(getPref("apiProvider") || "youdao");
  state.uiLanguage = normalizeUILanguage(getPref("uiLanguage") || "zh-CN");
  state.quickAddShortcut =
    getPref("quickAddShortcut") || DEFAULT_QUICK_ADD_SHORTCUT;
}

function readStoredNoteID(): number | null {
  try {
    const value = Number(Zotero.Prefs.get(NOTE_ID_PREF, true));
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch (e) {
    return null;
  }
}

function storeNoteID(noteID: number | null) {
  try {
    if (noteID) {
      Zotero.Prefs.set(NOTE_ID_PREF, noteID, true);
    } else {
      Zotero.Prefs.clear(NOTE_ID_PREF, true);
    }
  } catch (e) {}
}

function getNoteID(note: any): number {
  const noteID = Number(note?.id || note?.itemID || 0);
  return Number.isInteger(noteID) && noteID > 0 ? noteID : 0;
}

function rememberNote(note: any) {
  const noteID = getNoteID(note);
  state.noteID = noteID > 0 ? noteID : null;
  storeNoteID(state.noteID);
}

function userLibID(): number {
  try {
    return (Zotero.Libraries as any).userLibraryID;
  } catch (e) {
    return 1;
  }
}

async function openNoteForEditing(note: any): Promise<boolean> {
  const noteID = getNoteID(note);
  if (!noteID) return false;

  for (const win of Zotero.getMainWindows()) {
    try {
      if (typeof win.ZoteroPane?.openNoteWindow === "function") {
        win.ZoteroPane.openNoteWindow(noteID);
        return true;
      }
    } catch (e) {}
  }

  for (const win of Zotero.getMainWindows()) {
    try {
      if (typeof win.ZoteroPane?.selectItem === "function") {
        win.focus?.();
        await win.ZoteroPane.selectItem(noteID, true);
        await win.ZoteroPane.itemSelected?.();
        return true;
      }
    } catch (e) {}
  }

  try {
    (Zotero.Notes as any).open(noteID, null, { openInWindow: true });
    return true;
  } catch (e) {
    return false;
  }
}

function createRenderableEntries(entries = state.entries): NoteEntry[] {
  return entries.map((entry) => ({ word: entry.word, entry }));
}

function renderCurrentNoteHTML(): string {
  return renderNoteHTML(
    createRenderableEntries(),
    new Date(),
    state.uiLanguage,
  );
}

async function isDup(word: string): Promise<boolean> {
  return state.entries.some((entry) => entry.word === word);
}

async function fetchAPI(
  url: string,
  options: { headers?: Record<string, string> } = {},
): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: options.headers,
      signal: AbortSignal.timeout(10000),
    });
    return response.ok ? await response.text() : null;
  } catch (e) {
    try {
      return await new Promise((resolve) => {
        const request = new XMLHttpRequest();
        request.open("GET", url, true);
        request.timeout = 12000;
        for (const [key, value] of Object.entries(options.headers || {})) {
          request.setRequestHeader(key, value);
        }
        request.onload = () =>
          resolve(request.status === 200 ? request.responseText : null);
        request.onerror = () => resolve(null);
        request.ontimeout = () => resolve(null);
        request.send();
      });
    } catch (e2) {
      return null;
    }
  }
}

async function translate(
  word: string,
): Promise<{ trans: string; def: string; pos: string; phone: string }> {
  const result = { trans: "", def: "", pos: "", phone: "" };

  if (state.apiName === "custom") {
    const customConfig = parseCustomAPIConfig({
      url: getPref("customApiUrl") || "",
      headers: getPref("customApiHeaders") || "{}",
      transPath: getPref("customApiTransPath") || "",
      defPath: getPref("customApiDefPath") || "",
      posPath: getPref("customApiPosPath") || "",
      phonePath: getPref("customApiPhonePath") || "",
    });

    if (!customConfig.url) return result;

    const raw = await fetchAPI(buildCustomAPIUrl(customConfig.url, word), {
      headers: customConfig.headers,
    });
    if (!raw) return result;

    try {
      return {
        ...result,
        ...extractCustomAPIFields(JSON.parse(raw), customConfig),
      };
    } catch (e) {
      return result;
    }
  }

  if (state.apiName === "dictionary") {
    const raw = await fetchAPI(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
    );
    if (raw) {
      try {
        const data = JSON.parse(raw)?.[0];
        if (data) {
          for (const meaning of data.meanings || []) {
            if (!result.pos) result.pos = meaning.partOfSpeech || "";
            if (!result.def && meaning.definitions?.[0]) {
              result.def = meaning.definitions[0].definition;
            }
          }
          result.phone = data.phonetic || "";
        }
      } catch (e) {}
    }
    return result;
  }

  const raw = await fetchAPI(
    `http://dict.youdao.com/fsearch?q=${encodeURIComponent(word)}`,
  );
  if (raw) {
    try {
      const doc = new DOMParser().parseFromString(raw, "text/xml");
      const translations: string[] = [];
      doc.querySelectorAll("translation content").forEach((node: any) => {
        const text = node.textContent?.trim();
        if (text && !translations.includes(text)) translations.push(text);
      });
      if (translations.length) result.trans = translations[0];
    } catch (e) {}
  }

  if (!result.trans && !result.def) {
    const rawDictionary = await fetchAPI(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
    );
    if (rawDictionary) {
      try {
        const data = JSON.parse(rawDictionary)?.[0];
        if (data) {
          for (const meaning of data.meanings || []) {
            if (!result.pos) result.pos = meaning.partOfSpeech || "";
            if (!result.def && meaning.definitions?.[0]) {
              result.def = meaning.definitions[0].definition;
            }
          }
          result.phone = data.phonetic || "";
        }
      } catch (e) {}
    }
  }

  return result;
}

async function scoreNote(note: any): Promise<number> {
  if (!note?.isNote?.()) return -1;

  try {
    await note.reload();
  } catch (e) {}

  const html = note.getNote() || "";
  const entryCount = parseNoteHTML(html).length;
  return entryCount * 100000 + html.length;
}

async function pickBestNote(ids: number[] | undefined): Promise<any | null> {
  if (!ids?.length) return null;

  let bestNote: any = null;
  let bestScore = -1;

  for (const id of ids) {
    try {
      const note = Zotero.Items.get(id);
      const score = await scoreNote(note);
      if (score > bestScore) {
        bestScore = score;
        bestNote = note;
      }
    } catch (e) {}
  }

  return bestNote;
}

async function findNoteByTag(): Promise<any | null> {
  try {
    const search = new Zotero.Search();
    search.addCondition("libraryID", "is", String(userLibID()));
    search.addCondition("itemType", "is", "note");
    search.addCondition("tag", "is", NOTE_TAG);
    const ids = await search.search();
    return await pickBestNote(ids);
  } catch (e) {
    return null;
  }
}

async function findNoteByMarker(): Promise<any | null> {
  try {
    const search = new Zotero.Search();
    search.addCondition("libraryID", "is", String(userLibID()));
    search.addCondition("itemType", "is", "note");
    search.addCondition("note", "contains", NOTE_SEARCH_MARKER);
    const ids = await search.search();
    return await pickBestNote(ids);
  } catch (e) {
    return null;
  }
}

async function findExistingNote(): Promise<any | null> {
  let storedNote: any = null;

  if (state.noteID) {
    try {
      const note = Zotero.Items.get(state.noteID);
      if (note?.isNote?.()) storedNote = note;
    } catch (e) {}
  }

  const discoveredNote = (await findNoteByTag()) || (await findNoteByMarker());
  if (!storedNote && discoveredNote?.isNote?.()) {
    rememberNote(discoveredNote);
    return discoveredNote;
  }

  if (
    storedNote?.isNote?.() &&
    discoveredNote?.isNote?.() &&
    !state.entries.length
  ) {
    const storedScore = await scoreNote(storedNote);
    const discoveredScore = await scoreNote(discoveredNote);
    if (discoveredScore > storedScore) {
      rememberNote(discoveredNote);
      return discoveredNote;
    }
  }

  if (storedNote?.isNote?.()) {
    rememberNote(storedNote);
    return storedNote;
  }

  rememberNote(null);
  return null;
}

async function ensureNote(createIfMissing = true): Promise<any | null> {
  const existing = await findExistingNote();
  if (existing) return existing;
  if (!createIfMissing) return null;

  try {
    const note = new Zotero.Item("note");
    note.libraryID = userLibID();
    note.setNote(renderCurrentNoteHTML());
    note.addTag(NOTE_TAG);
    await note.saveTx();
    rememberNote(note);

    if (note?.isNote?.()) return note;
    return await findExistingNote();
  } catch (e) {
    Zotero.debug("VocabBuilder: prefs create note: " + e);
    return null;
  }
}

async function readNoteEntries(note?: any): Promise<NoteEntry[]> {
  const resolvedNote = note || (await ensureNote(false));
  if (!resolvedNote) return [];

  try {
    await resolvedNote.reload();
  } catch (e) {}

  return parseNoteHTML(resolvedNote.getNote() || "");
}

function sameEntries(left: VocabEntry[], right: VocabEntry[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function syncEntriesFromNote(note?: any): Promise<{
  changed: boolean;
  count: number;
}> {
  const noteEntries = await readNoteEntries(note);
  const nextEntries = buildEntriesFromNoteEntries(noteEntries);
  const changed = !sameEntries(state.entries, nextEntries);
  if (!changed) return { changed: false, count: nextEntries.length };
  state.entries = nextEntries;
  refreshWordCount();
  return { changed: true, count: nextEntries.length };
}

async function noteStillHasWord(note: any, word: string): Promise<boolean> {
  const noteEntries = await readNoteEntries(note);
  return noteEntries.some((item) => item.word === word);
}

function findLiveEntry(word: string, id?: string): VocabEntry | null {
  const cleaned = cleanWord(word);
  if (!cleaned) return null;

  if (id) {
    const byId = state.entries.find((entry) => entry.id === id);
    if (byId && byId.word === cleaned) return byId;
  }

  return state.entries.find((entry) => entry.word === cleaned) || null;
}

async function migrateLegacyStateIfNeeded(): Promise<void> {
  const legacy = await loadPersistedState();
  if (legacy.noteID && !state.noteID) {
    state.noteID = legacy.noteID;
    storeNoteID(state.noteID);
  }

  const note = await ensureNote(false);
  if (!note && legacy.entries.length) {
    state.entries = legacy.entries;
    await ensureNote(true);
  }

  await clearPersistedState();
}

async function syncNoteSafe(): Promise<void> {
  if (state.syncBusy) {
    state.syncPending = true;
    return;
  }

  state.syncBusy = true;
  try {
    await syncNote();
  } catch (e) {
    Zotero.debug("VocabBuilder: prefs sync note: " + e);
  }
  state.syncBusy = false;

  if (state.syncPending) {
    state.syncPending = false;
    await syncNoteSafe();
  }
}

async function waitForNoteSyncIdle(): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (!state.syncBusy && !state.syncPending) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function queueNoteSync(): Promise<void> {
  void syncNoteSafe();
  await waitForNoteSyncIdle();
}

async function syncNote(): Promise<void> {
  let note = await ensureNote(true);
  if (!note?.isNote?.()) {
    note = await findExistingNote();
  }
  if (!note?.isNote?.()) {
    throw new Error("Vocabulary note is not available");
  }

  note.setNote(renderCurrentNoteHTML());
  await note.saveTx({ notifierData: {} });

  try {
    await note.reload();
  } catch (e) {}
  refreshWordCount();
}

async function addWord(
  word: string,
  ctx: string,
  src: string,
): Promise<VocabEntry | null> {
  const existingNote = await ensureNote(false);
  if (existingNote) {
    await syncEntriesFromNote(existingNote);
  }

  const cleaned = cleanWord(word);
  if (!cleaned) return null;
  if (await isDup(cleaned)) return null;

  const entry = createVocabEntry(cleaned, {
    ctx: ctx || "",
    src: src || "",
    status: "pending",
    tries: 0,
  });

  state.entries = [
    entry,
    ...state.entries.filter((item) => item.word !== entry.word),
  ];
  refreshWordCount();
  const noteSync = queueNoteSync();
  void backgroundSync(entry, cleaned, noteSync);
  await noteSync;
  return entry;
}

async function backgroundSync(
  entry: VocabEntry,
  cleaned: string,
  noteSync: Promise<void> = Promise.resolve(),
) {
  try {
    const targetId = entry.id;
    const online = typeof navigator !== "undefined" ? navigator.onLine : true;
    if (online) {
      const resultPromise = translate(cleaned);
      const result = await resultPromise;
      await noteSync;
      const latestNote = await ensureNote(false);
      if (latestNote && !(await noteStillHasWord(latestNote, cleaned))) return;
      const liveEntry = findLiveEntry(cleaned, targetId);
      if (!liveEntry) return;

      liveEntry.trans = result.trans;
      liveEntry.def = result.def;
      liveEntry.pos = result.pos;
      liveEntry.phone = result.phone;
      liveEntry.status = result.trans || result.def ? "completed" : "failed";

      if (liveEntry.status === "failed") {
        liveEntry.tries = Math.max(1, liveEntry.tries || 0);
        notify(
          t(state.uiLanguage, "notify.translationFailed", { word: cleaned }),
          "error",
        );
      } else {
        notify(
          t(state.uiLanguage, "notify.addedTranslated", { word: cleaned }),
          "success",
        );
      }
    } else {
      await noteSync;
      const latestNote = await ensureNote(false);
      if (latestNote && !(await noteStillHasWord(latestNote, cleaned))) return;
      const liveEntry = findLiveEntry(cleaned, targetId);
      if (!liveEntry) return;
      liveEntry.status = "pending";
      notify(t(state.uiLanguage, "notify.offlineRetry", { word: cleaned }));
    }

    await syncNoteSafe();
    await notifyMainAddon();
  } catch (e) {
    notify(
      t(state.uiLanguage, "notify.error", {
        message: (e as any)?.message || e,
      }),
      "error",
    );
    Zotero.debug("VocabBuilder: prefs background sync: " + e);
  }
}

function notify(message: string, tone: NotificationTone = "info") {
  showNotification(message, tone);
}

function bindEventOnce(
  element: any,
  key: string,
  eventName: string,
  listener: EventListener,
) {
  if (!element) return;
  const marker = `vbBound${key}`;
  if (element[marker]) return;
  element.addEventListener(eventName, listener);
  element[marker] = true;
}

function getInputValue(id: string): string {
  const element = getPrefsDocument().getElementById(id) as any;
  return element?.value?.toString() || "";
}

function setInputValue(id: string, value: string) {
  const element = getPrefsDocument().getElementById(id) as any;
  if (!element) return;

  element.value = value;
  if (element.localName === "select" && !element.value) {
    const firstOption = element.querySelector?.("option") as any;
    if (firstOption?.value) element.value = firstOption.value;
  }
}

function refreshWordCount() {
  const countSpan = getPrefsDocument().getElementById("vb-word-count");
  if (countSpan) {
    const completed = state.entries.filter(
      (entry) => entry.status === "completed",
    ).length;
    countSpan.textContent = getWordCountLabel(
      state.uiLanguage,
      state.entries.length,
      completed,
    );
  }
}

function toggleCustomAPISection() {
  const section = getPrefsDocument().getElementById(
    "vb-custom-api-section",
  ) as HTMLElement | null;
  if (!section) return;
  section.style.display = state.apiName === "custom" ? "block" : "none";
}

function updateExportHint() {
  const hint = getPrefsDocument().getElementById("vb-export-hint");
  if (!hint) return;

  const format = getInputValue("vb-export-format") as ExportFormat;
  hint.textContent = getExportHint(state.uiLanguage, format || "csv");
}

function bindTextPref(
  id: string,
  prefKey:
    | "customApiUrl"
    | "customApiHeaders"
    | "customApiTransPath"
    | "customApiDefPath"
    | "customApiPosPath"
    | "customApiPhonePath"
    | "exportFormat"
    | "exportScope",
) {
  const element = getPrefsDocument().getElementById(id) as any;
  if (!element) return;

  element.value = String(getPref(prefKey) || DEFAULT_TEXT_PREFS[prefKey] || "");
  if (element.localName === "select" && !element.value) {
    const firstOption = element.querySelector?.("option") as any;
    if (firstOption?.value) element.value = firstOption.value;
  }

  const save = () => {
    setPref(prefKey, element.value);
    if (id === "vb-export-format") updateExportHint();
  };

  bindEventOnce(element, `${id}Change`, "change", save);
  bindEventOnce(element, `${id}Input`, "input", save);
}

function copyToClipboard(text: string) {
  const helper = (Components as any).classes[
    "@mozilla.org/widget/clipboardhelper;1"
  ].getService(Components.interfaces.nsIClipboardHelper) as any;
  helper.copyString(text);
}

function setDonationOverlayVisible(visible: boolean) {
  const overlay = getMaybePrefsDocument()?.getElementById(
    "vb-donate-overlay",
  ) as HTMLElement | null;
  if (!overlay) return;
  overlay.style.display = visible ? "flex" : "none";
}

async function showSaveDialog(
  title: string,
  bundle: ReturnType<typeof buildExportBundle>,
): Promise<string | null> {
  const picker = (Components as any).classes[
    "@mozilla.org/filepicker;1"
  ].createInstance(Components.interfaces.nsIFilePicker) as any;
  picker.init(
    getPrefsWindow().browsingContext,
    title,
    Components.interfaces.nsIFilePicker.modeSave,
  );
  picker.defaultString = bundle.defaultFileName;
  picker.defaultExtension = bundle.extension;
  picker.appendFilter(bundle.filterLabel, `*.${bundle.extension}`);
  picker.appendFilters(Components.interfaces.nsIFilePicker.filterAll);

  const result = await new Promise<number>((resolve) => {
    picker.open(resolve);
  });

  if (
    result !== Components.interfaces.nsIFilePicker.returnOK &&
    result !== Components.interfaces.nsIFilePicker.returnReplace
  ) {
    return null;
  }

  return picker.file?.path || null;
}

async function exportVocabulary(format: ExportFormat, scope: ExportScope) {
  await ensureLoaded(true);

  if (!state.entries.length) {
    notify(t(state.uiLanguage, "notify.noExport"));
    return;
  }

  const bundle = buildExportBundle(format, scope, state.entries);
  const exportPath = await showSaveDialog(
    t(state.uiLanguage, "dialog.exportTitle"),
    bundle,
  );
  if (!exportPath) return;

  await IOUtils.writeUTF8(exportPath, bundle.content);
  notify(
    t(state.uiLanguage, "notify.exported", {
      extension: bundle.extension.toUpperCase(),
    }),
    "success",
  );
}

async function openVocabNote() {
  await ensureLoaded(true);

  const note = await ensureNote(state.entries.length > 0);
  if (note) {
    const opened = await openNoteForEditing(note);
    if (opened) return;
    Zotero.debug("VocabBuilder: prefs open note failed");
  }

  notify(t(state.uiLanguage, "notify.noVocabulary"));
}

async function syncFromNote() {
  await ensureLoaded(true);

  const note = await ensureNote(false);
  if (!note) {
    notify(t(state.uiLanguage, "notify.noVocabulary"));
    return;
  }

  const synced = await syncEntriesFromNote(note);
  if (synced.changed) {
    await notifyMainAddon();
    notify(
      t(state.uiLanguage, "notify.imported", { count: synced.count }),
      "success",
    );
  } else {
    notify(t(state.uiLanguage, "notify.noNewWords"));
  }
}

async function quickAddWord() {
  await ensureLoaded(true);

  const input = getPrefsDocument().getElementById("vb-quick-input") as any;
  const word = input?.value?.trim();
  if (!word) return;

  input.value = "";
  const entry = await addWord(word, "", "");
  if (entry) {
    await notifyMainAddon();
  } else {
    notify(t(state.uiLanguage, "notify.duplicateInvalid"), "error");
  }
}

function getLocaleVars() {
  const help = getPrefsDocument().getElementById("vb-pref-help");
  return {
    name: help?.getAttribute("data-build-name") || config.addonName,
    version: help?.getAttribute("data-build-version") || version,
    time: help?.getAttribute("data-build-time") || "",
    shortcut: formatShortcutLabel(
      getPref("quickAddShortcut") || DEFAULT_QUICK_ADD_SHORTCUT,
    ),
  };
}

function applyLanguage() {
  const doc = getPrefsDocument();
  applyDocumentLanguage(doc, state.uiLanguage, getLocaleVars());

  const emailBox = doc.getElementById("vb-feedback-email");
  if (emailBox) {
    emailBox.textContent = FEEDBACK_EMAIL;
  }

  const shortcutInput = doc.getElementById("vb-shortcut-input") as any;
  if (shortcutInput) {
    shortcutInput.value = formatShortcutLabel(state.quickAddShortcut);
  }

  refreshWordCount();
  updateExportHint();
  toggleCustomAPISection();
}

async function toggleLanguage() {
  await ensureLoaded(true);
  state.uiLanguage = state.uiLanguage === "zh-CN" ? "en-US" : "zh-CN";
  setPref("uiLanguage", state.uiLanguage);
  applyLanguage();
  await syncNoteSafe();
  await notifyMainAddon();
}

async function notifyMainAddon() {
  try {
    const reload = (Zotero as any)[config.addonInstance]?.hooks
      ?.reloadStateFromDisk;
    if (typeof reload === "function") {
      await reload();
    }
  } catch (e) {}
}

function bindShortcutControls() {
  const doc = getPrefsDocument();
  const input = doc.getElementById("vb-shortcut-input") as any;
  if (!input) return;

  input.value = formatShortcutLabel(state.quickAddShortcut);

  const commitShortcut = (rawValue: string) => {
    const normalized = rawValue.trim().toLowerCase().replace(/\s+/g, "");
    if (!isValidShortcut(normalized)) {
      notify(
        t(state.uiLanguage, "shortcut.invalid", { shortcut: rawValue }),
        "error",
      );
      input.value = formatShortcutLabel(state.quickAddShortcut);
      return;
    }
    if (normalized === state.quickAddShortcut) {
      input.value = formatShortcutLabel(normalized);
      return;
    }
    state.quickAddShortcut = normalized;
    setPref("quickAddShortcut", normalized);
    input.value = formatShortcutLabel(normalized);
    notify(
      t(state.uiLanguage, "shortcut.saved", {
        shortcut: formatShortcutLabel(normalized),
      }),
      "success",
    );
    applyLanguage();
    void notifyMainAddon();
  };

  // 录制模式：点击输入框后按下组合键即保存；其他按键放行以便手动输入
  bindEventOnce(input, "ShortcutKeydown", "keydown", (e: any) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      input.value = formatShortcutLabel(state.quickAddShortcut);
      input.blur();
      return;
    }
    const value = shortcutFromEvent(e);
    if (value) {
      e.preventDefault();
      e.stopPropagation();
      commitShortcut(value);
    }
  });

  // 聚焦时全选，便于录制或直接输入覆盖
  bindEventOnce(input, "ShortcutFocus", "focus", () => {
    try {
      input.select();
    } catch (ex) {}
  });

  // 失焦时：存在未提交的手动输入则交给随后的 change 提交，否则恢复保存值
  bindEventOnce(input, "ShortcutBlur", "blur", () => {
    if (
      input.value.trim() &&
      input.value !== formatShortcutLabel(state.quickAddShortcut)
    ) {
      return;
    }
    input.value = formatShortcutLabel(state.quickAddShortcut);
  });

  // 支持手动输入（Firefox 中 change 在 blur 之后触发）
  bindEventOnce(input, "ShortcutChange", "change", () => {
    if (input.value.trim()) commitShortcut(input.value);
    else input.value = formatShortcutLabel(state.quickAddShortcut);
  });
}

function bindControls() {
  bindShortcutControls();

  const input = getPrefsDocument().getElementById("vb-quick-input") as any;
  bindEventOnce(input, "QuickAddEnter", "keydown", (e: any) => {
    if (e.key === "Enter") void quickAddWord();
  });

  const select = getPrefsDocument().getElementById("vb-api-select") as any;
  if (select) {
    select.value = state.apiName;
    bindEventOnce(select, "APISelect", "change", () => {
      state.apiName = normalizeAPIProvider(select.value);
      setPref("apiProvider", state.apiName);
      toggleCustomAPISection();
    });
  }

  bindTextPref("vb-custom-api-url", "customApiUrl");
  bindTextPref("vb-custom-api-headers", "customApiHeaders");
  bindTextPref("vb-custom-api-trans", "customApiTransPath");
  bindTextPref("vb-custom-api-def", "customApiDefPath");
  bindTextPref("vb-custom-api-pos", "customApiPosPath");
  bindTextPref("vb-custom-api-phone", "customApiPhonePath");
  bindTextPref("vb-export-format", "exportFormat");
  bindTextPref("vb-export-scope", "exportScope");
}

async function ensureLoaded(forceRefresh = false) {
  if (forceRefresh || !state.loadPromise) {
    state.loadPromise = loadLatestState().catch((e) => {
      state.loadPromise = null;
      throw e;
    });
  }

  await state.loadPromise;
}

async function loadLatestState() {
  await Promise.all([Zotero.initializationPromise, Zotero.uiReadyPromise]);
  loadSettingsFromPrefs();
  await migrateLegacyStateIfNeeded();

  const note = await ensureNote(false);
  if (note) {
    await syncEntriesFromNote(note);
    return;
  }

  state.entries = [];
  rememberNote(null);
  refreshWordCount();
}

async function refreshLatestState() {
  state.loadPromise = loadLatestState().catch((e) => {
    state.loadPromise = null;
    throw e;
  });
  await state.loadPromise;
}

async function runInit() {
  if (!getPrefsDocument().getElementById("vb-open-note")) return;

  loadSettingsFromPrefs();
  bindControls();
  await refreshLatestState();

  setInputValue("vb-api-select", state.apiName);
  applyLanguage();
}

async function init() {
  const doc = getMaybePrefsDocument();
  if (!doc?.getElementById("vb-open-note")) return;

  if (!state.initPromise) {
    state.initPromise = runInit().catch((e) => {
      state.initPromise = null;
      throw e;
    });
  }

  await state.initPromise;
}

function bootstrapInit(attempts = 40) {
  const doc = getMaybePrefsDocument();
  if (doc?.getElementById("vb-open-note")) {
    void init();
    return;
  }

  if (attempts <= 0) return;

  const win = getPrefsWindow();
  if (typeof win?.setTimeout === "function") {
    win.setTimeout(() => bootstrapInit(attempts - 1), 50);
  }
}

const prefsController = {
  init,
  openVocabNote,
  quickAddWord,
  syncFromNote,
  toggleLanguage,
  exportVocabulary,
  exportCurrent() {
    const format = getInputValue("vb-export-format") as ExportFormat;
    const scope = getInputValue("vb-export-scope") as ExportScope;
    void exportVocabulary(format || "csv", scope || "all");
  },
  copyFeedbackEmail() {
    copyToClipboard(FEEDBACK_EMAIL);
    notify(t(state.uiLanguage, "notify.feedbackEmailCopied"), "success");
  },
  openDonationQr() {
    setDonationOverlayVisible(true);
  },
  closeDonationQr() {
    setDonationOverlayVisible(false);
  },
  resetShortcut() {
    state.quickAddShortcut = DEFAULT_QUICK_ADD_SHORTCUT;
    setPref("quickAddShortcut", DEFAULT_QUICK_ADD_SHORTCUT);
    const input = getPrefsDocument().getElementById("vb-shortcut-input") as any;
    if (input) input.value = formatShortcutLabel(DEFAULT_QUICK_ADD_SHORTCUT);
    notify(
      t(state.uiLanguage, "shortcut.saved", {
        shortcut: formatShortcutLabel(DEFAULT_QUICK_ADD_SHORTCUT),
      }),
      "success",
    );
    applyLanguage();
    void notifyMainAddon();
  },
};

prefsGlobal.VocabBuilderPreferences = prefsController;
if (prefsGlobal.window) {
  prefsGlobal.window.VocabBuilderPreferences = prefsController;
  const readyState = prefsGlobal.window.document?.readyState;
  if (readyState === "complete" || readyState === "interactive") {
    prefsGlobal.window.setTimeout(() => bootstrapInit(), 0);
  } else {
    prefsGlobal.window.addEventListener("load", () => bootstrapInit(), {
      once: true,
    });
  }
}
