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
  matchesShortcut,
} from "./utils/shortcut";
import { lookupTranslation, storeTranslation } from "./translation-cache";

const NOTE_ID_PREF = `${config.prefsPrefix}.noteID`;
const PREF_PANE_SRC = `chrome://${config.addonRef}/content/preferences.xhtml`;
const PREF_PANE_SCRIPT = `chrome://${config.addonRef}/content/preferences-init.js`;
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

let _ws: VocabEntry[] = [];
let _noteID: number | null = readStoredNoteID();
let _syncBusy = false;
let _syncPending = false;
let _apiName = "youdao";
let _uiLanguage: UILanguage = DEFAULT_UI_LANGUAGE;
let _quickAddShortcut: string = DEFAULT_QUICK_ADD_SHORTCUT;
let _prefPaneID: string | null = null;
let _notifierID: string | null = null;
let _noteRefreshTimer: ReturnType<typeof setTimeout> | null = null;
const _prefsDocs = new Set<any>();

type APIProvider = "youdao" | "dictionary" | "custom";

function normalizeAPIProvider(value: string): APIProvider {
  return value === "dictionary" || value === "custom" ? value : "youdao";
}

function loadSettingsFromPrefs() {
  _apiName = normalizeAPIProvider(getPref("apiProvider") || "youdao");
  _uiLanguage = normalizeUILanguage(getPref("uiLanguage") || "zh-CN");
  _quickAddShortcut = getPref("quickAddShortcut") || DEFAULT_QUICK_ADD_SHORTCUT;
}

async function registerPrefsPane() {
  if (_prefPaneID || !(Zotero as any).PreferencePanes?.register) return;

  _prefPaneID = await Zotero.PreferencePanes.register({
    pluginID: config.addonID,
    id: `${config.addonRef}-preferences`,
    src: PREF_PANE_SRC,
    label: config.addonName,
    scripts: [PREF_PANE_SCRIPT],
  });
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
  _noteID = noteID > 0 ? noteID : null;
  storeNoteID(_noteID);
}

function _userLibID(): number {
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

function createRenderableEntries(entries = _ws): NoteEntry[] {
  return entries.map((entry) => ({ word: entry.word, entry }));
}

function renderCurrentNoteHTML(): string {
  return renderNoteHTML(createRenderableEntries(), new Date(), _uiLanguage);
}

async function isDup(word: string): Promise<boolean> {
  return _ws.some((entry) => entry.word === word);
}

function _setAPI(name: string) {
  _apiName = normalizeAPIProvider(name);
  setPref("apiProvider", _apiName);
}

async function _fetchAPI(
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

async function _translate(
  word: string,
): Promise<{ trans: string; def: string; pos: string; phone: string; example: string }> {
  // 先查本地翻译缓存（离线词库），命中则直接返回；可关闭以完全走在线翻译
  const cacheEnabled = getPref("translationCacheEnabled") !== false;
  const cached = cacheEnabled ? await lookupTranslation(word) : null;
  if (cached) return cached;

  const result = { trans: "", def: "", pos: "", phone: "", example: "" };

  const finish = async (finalResult: {
    trans: string;
    def: string;
    pos: string;
    phone: string;
    example: string;
  }) => {
    if (cacheEnabled && (finalResult.trans || finalResult.def)) {
      void storeTranslation(word, finalResult);
    }
    return finalResult;
  };

  if (_apiName === "custom") {
    const customConfig = parseCustomAPIConfig({
      url: getPref("customApiUrl") || "",
      headers: getPref("customApiHeaders") || "{}",
      transPath: getPref("customApiTransPath") || "",
      defPath: getPref("customApiDefPath") || "",
      posPath: getPref("customApiPosPath") || "",
      phonePath: getPref("customApiPhonePath") || "",
      examplePath: getPref("customApiExamplePath") || "",
    });

    if (!customConfig.url) return result;

    const raw = await _fetchAPI(buildCustomAPIUrl(customConfig.url, word), {
      headers: customConfig.headers,
    });
    if (!raw) return result;

    try {
      return await finish({
        ...result,
        ...extractCustomAPIFields(JSON.parse(raw), customConfig),
      });
    } catch (e) {
      return result;
    }
  }

  if (_apiName === "dictionary") {
    const raw = await _fetchAPI(
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
            if (!result.example) {
              for (const definition of meaning.definitions || []) {
                if (definition?.example) {
                  result.example = String(definition.example).trim();
                  break;
                }
              }
            }
          }
          result.phone = data.phonetic || "";
        }
      } catch (e) {}
    }
    return finish(result);
  }

  const raw = await _fetchAPI(
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
      // 有道的响应若包含例句（example）则一并提取
      const exampleNode = (
        doc.querySelector("example") ||
        doc.querySelector("sent") ||
        doc.querySelector("sentence")
      ) as any;
      if (exampleNode?.textContent?.trim()) {
        result.example = exampleNode.textContent.trim();
      }
    } catch (e) {}
  }

  if (!result.trans && !result.def) {
    const rawDictionary = await _fetchAPI(
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
            if (!result.example) {
              for (const definition of meaning.definitions || []) {
                if (definition?.example) {
                  result.example = String(definition.example).trim();
                  break;
                }
              }
            }
          }
          result.phone = data.phonetic || "";
        }
      } catch (e) {}
    }
  }

  return finish(result);
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

async function _findNoteByTag(): Promise<any | null> {
  try {
    const search = new Zotero.Search();
    search.addCondition("libraryID", "is", String(_userLibID()));
    search.addCondition("itemType", "is", "note");
    search.addCondition("tag", "is", NOTE_TAG);
    const ids = await search.search();
    return await pickBestNote(ids);
  } catch (e) {
    return null;
  }
}

async function _findNoteByMarker(): Promise<any | null> {
  try {
    const search = new Zotero.Search();
    search.addCondition("libraryID", "is", String(_userLibID()));
    search.addCondition("itemType", "is", "note");
    search.addCondition("note", "contains", NOTE_SEARCH_MARKER);
    const ids = await search.search();
    return await pickBestNote(ids);
  } catch (e) {
    return null;
  }
}

async function _findExistingNote(): Promise<any | null> {
  let storedNote: any = null;

  if (_noteID) {
    try {
      const note = Zotero.Items.get(_noteID);
      if (note?.isNote?.()) storedNote = note;
    } catch (e) {}
  }

  const discoveredNote =
    (await _findNoteByTag()) || (await _findNoteByMarker());
  if (!storedNote && discoveredNote?.isNote?.()) {
    rememberNote(discoveredNote);
    return discoveredNote;
  }

  if (storedNote?.isNote?.() && discoveredNote?.isNote?.() && !_ws.length) {
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
  const existing = await _findExistingNote();
  if (existing) return existing;
  if (!createIfMissing) return null;

  try {
    const note = new Zotero.Item("note");
    note.libraryID = _userLibID();
    note.setNote(renderCurrentNoteHTML());
    note.addTag(NOTE_TAG);
    await note.saveTx();
    rememberNote(note);

    if (note?.isNote?.()) return note;
    return await _findExistingNote();
  } catch (e) {
    Zotero.debug("VocabBuilder: create note: " + e);
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

function noteNeedsMarkupUpgrade(note: any): boolean {
  const html = String(note?.getNote?.() || "");
  if (!html) return false;

  return (
    /<a\b(?![^>]*class="vb-source-link")[^>]*href="zotero:\/\/open-pdf/i.test(
      html,
    ) || /a hrefzoteroopen-pdf/i.test(html)
  );
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
  const changed = !sameEntries(_ws, nextEntries);
  if (!changed) return { changed: false, count: nextEntries.length };
  _ws = nextEntries;
  refreshUI();
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
    const byId = _ws.find((entry) => entry.id === id);
    if (byId && byId.word === cleaned) return byId;
  }

  return _ws.find((entry) => entry.word === cleaned) || null;
}

async function migrateLegacyStateIfNeeded(): Promise<void> {
  const legacy = await loadPersistedState();
  if (legacy.noteID && !_noteID) {
    _noteID = legacy.noteID;
    storeNoteID(_noteID);
  }

  const note = await ensureNote(false);
  if (!note && legacy.entries.length) {
    _ws = legacy.entries;
    await ensureNote(true);
  }

  await clearPersistedState();
}

function scheduleNoteRefresh(): void {
  if (_noteRefreshTimer) {
    clearTimeout(_noteRefreshTimer);
  }

  _noteRefreshTimer = setTimeout(() => {
    _noteRefreshTimer = null;
    void reloadStateFromDisk();
  }, 150);
}

function registerNoteObserver(): void {
  if (_notifierID) return;

  _notifierID = Zotero.Notifier.registerObserver(
    {
      notify(event, type, ids) {
        if (type !== "item" || !_noteID) return;

        const matchesNote = ids.some((id) => Number(id) === _noteID);
        if (!matchesNote) return;

        if (event === "delete" || event === "trash") {
          rememberNote(null);
          _ws = [];
          refreshUI();
          return;
        }

        if (event === "modify" || event === "refresh" || event === "add") {
          scheduleNoteRefresh();
        }
      },
    },
    ["item"],
    `${config.addonRef}-note`,
  );
}

function unregisterNoteObserver(): void {
  if (!_notifierID) return;

  try {
    Zotero.Notifier.unregisterObserver(_notifierID);
  } catch (e) {}
  _notifierID = null;
}

function currentWordCount(): number {
  return _ws.length;
}

function refreshMenus() {
  const vocabLabel = t(_uiLanguage, "menu.vocab", {
    count: currentWordCount(),
  });
  const quickAddLabel = t(_uiLanguage, "menu.quickAdd");

  for (const win of Zotero.getMainWindows()) {
    try {
      const vocabItem = win.document.getElementById("vb-menu-vocab");
      if (vocabItem) vocabItem.setAttribute("label", vocabLabel);
      const addItem = win.document.getElementById("vb-menu-add");
      if (addItem) addItem.setAttribute("label", quickAddLabel);
    } catch (e) {}
  }
}

function refreshPrefsCounts() {
  const completed = _ws.filter((entry) => entry.status === "completed").length;
  const countLabel = getWordCountLabel(
    _uiLanguage,
    currentWordCount(),
    completed,
  );

  for (const doc of [..._prefsDocs]) {
    try {
      if (!doc.defaultView || doc.defaultView.closed) {
        _prefsDocs.delete(doc);
        continue;
      }

      const countSpan = doc.getElementById("vb-word-count");
      if (countSpan) countSpan.textContent = countLabel;
    } catch (e) {
      _prefsDocs.delete(doc);
    }
  }
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

function refreshUI() {
  refreshPrefsLanguage();
  refreshMenus();
  refreshPrefsCounts();
}

function setInputValue(doc: Document, id: string, value: string) {
  const element = doc.getElementById(id) as any;
  if (element) element.value = value;
}

function getInputValue(doc: Document, id: string): string {
  const element = doc.getElementById(id) as any;
  return element?.value?.toString() || "";
}

function toggleCustomAPISection(doc: Document) {
  const section = doc.getElementById(
    "vb-custom-api-section",
  ) as HTMLElement | null;
  if (!section) return;
  section.style.display = _apiName === "custom" ? "block" : "none";
}

function updateExportHint(doc: Document) {
  const hint = doc.getElementById("vb-export-hint");
  if (!hint) return;

  const format = getInputValue(doc, "vb-export-format") as ExportFormat;
  hint.textContent = getExportHint(_uiLanguage, format || "csv");
}

function copyToClipboard(text: string) {
  const helper = (Components as any).classes[
    "@mozilla.org/widget/clipboardhelper;1"
  ].getService(Components.interfaces.nsIClipboardHelper) as any;
  helper.copyString(text);
}

async function showSaveDialog(
  win: any,
  title: string,
  bundle: ReturnType<typeof buildExportBundle>,
): Promise<string | null> {
  const picker = (Components as any).classes[
    "@mozilla.org/filepicker;1"
  ].createInstance(Components.interfaces.nsIFilePicker) as any;
  picker.init(
    win.browsingContext,
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

async function exportVocabulary(
  win: any,
  format: ExportFormat,
  scope: ExportScope,
) {
  const note = await ensureNote(false);
  if (note) {
    await syncEntriesFromNote(note);
  }

  if (!_ws.length) {
    pwNotify(t(_uiLanguage, "notify.noExport"));
    return;
  }

  const bundle = buildExportBundle(format, scope, _ws);
  const exportPath = await showSaveDialog(
    win,
    t(_uiLanguage, "dialog.exportTitle"),
    bundle,
  );
  if (!exportPath) return;

  await IOUtils.writeUTF8(exportPath, bundle.content);
  pwNotify(
    t(_uiLanguage, "notify.exported", {
      extension: bundle.extension.toUpperCase(),
    }),
  );
}

function bindTextPref(
  doc: Document,
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
  const element = doc.getElementById(id) as any;
  if (!element) return;

  element.value = String(getPref(prefKey) || DEFAULT_TEXT_PREFS[prefKey] || "");
  if (element.localName === "select" && !element.value) {
    const firstOption = element.querySelector?.("option") as any;
    if (firstOption?.value) element.value = firstOption.value;
  }

  const save = () => {
    setPref(prefKey, element.value);
    if (id === "vb-export-format") updateExportHint(doc);
  };

  element.addEventListener("change", save);
  element.addEventListener("input", save);
}

async function _doSyncNoteSafe(): Promise<void> {
  if (_syncBusy) {
    _syncPending = true;
    return;
  }

  _syncBusy = true;
  try {
    await _doSyncNote();
  } catch (e) {
    Zotero.debug("VocabBuilder: sync: " + e);
  }
  _syncBusy = false;

  if (_syncPending) {
    _syncPending = false;
    await _doSyncNoteSafe();
  }
}

async function waitForNoteSyncIdle(): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (!_syncBusy && !_syncPending) return;
    await sleep(25);
  }
}

async function queueNoteSync(): Promise<void> {
  void _doSyncNoteSafe();
  await waitForNoteSyncIdle();
}

async function _doSyncNote(): Promise<void> {
  let note = await ensureNote(true);
  if (!note?.isNote?.()) {
    note = await _findExistingNote();
  }
  if (!note?.isNote?.()) {
    throw new Error("Vocabulary note is not available");
  }

  note.setNote(renderCurrentNoteHTML());
  await note.saveTx({ notifierData: {} });

  try {
    await note.reload();
  } catch (e) {}
  refreshUI();
}

async function _syncFromNote() {
  const note = await ensureNote(false);
  if (!note) {
    pwNotify(t(_uiLanguage, "notify.noVocabulary"));
    return;
  }

  const synced = await syncEntriesFromNote(note);
  if (synced.changed) {
    pwNotify(
      t(_uiLanguage, "notify.imported", { count: synced.count }),
      "success",
    );
  } else {
    pwNotify(t(_uiLanguage, "notify.noNewWords"));
  }
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

  _ws = [entry, ..._ws.filter((item) => item.word !== entry.word)];
  refreshUI();
  const noteSync = queueNoteSync();
  void _backgroundSync(entry, cleaned, noteSync);
  await noteSync;
  return entry;
}

async function _backgroundSync(
  entry: VocabEntry,
  cleaned: string,
  noteSync: Promise<void> = Promise.resolve(),
) {
  try {
    const targetId = entry.id;
    const online = typeof navigator !== "undefined" ? navigator.onLine : true;
    if (online) {
      const resultPromise = _translate(cleaned);
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
      // 语境优先使用翻译 API 返回的例句；已有内容（如缓存）则保留
      if (result.example) liveEntry.ctx = result.example;
      liveEntry.status = result.trans || result.def ? "completed" : "failed";

      if (liveEntry.status === "failed") {
        liveEntry.tries = Math.max(1, liveEntry.tries || 0);
        pwNotify(
          t(_uiLanguage, "notify.translationFailed", { word: cleaned }),
          "error",
        );
      } else {
        pwNotify(
          t(_uiLanguage, "notify.addedTranslated", { word: cleaned }),
          "success",
        );
      }
    } else {
      // 离线时先查本地翻译缓存，命中则直接完成
      const cacheEnabled = getPref("translationCacheEnabled") !== false;
      const cached = cacheEnabled ? await lookupTranslation(cleaned) : null;
      await noteSync;
      const latestNote = await ensureNote(false);
      if (latestNote && !(await noteStillHasWord(latestNote, cleaned))) return;
      const liveEntry = findLiveEntry(cleaned, targetId);
      if (!liveEntry) return;

      if (cached) {
        liveEntry.trans = cached.trans;
        liveEntry.def = cached.def;
        liveEntry.pos = cached.pos;
        liveEntry.phone = cached.phone;
        if (cached.example) liveEntry.ctx = cached.example;
        liveEntry.status = "completed";
        pwNotify(
          t(_uiLanguage, "notify.addedTranslated", { word: cleaned }),
          "success",
        );
      } else {
        liveEntry.status = "pending";
        pwNotify(t(_uiLanguage, "notify.offlineRetry", { word: cleaned }));
      }
    }

    await _doSyncNoteSafe();
  } catch (err) {
    pwNotify(
      t(_uiLanguage, "notify.error", {
        message: (err as any)?.message || err,
      }),
      "error",
    );
    Zotero.debug("VocabBuilder: bg sync: " + err);
  }
}

function _retryPending() {
  if (typeof navigator !== "undefined" && !navigator.onLine) return;

  let retried = 0;
  for (const entry of _ws) {
    if (entry.status !== "pending" && entry.status !== "failed") continue;
    if ((entry.tries || 0) >= 3) continue;

    const targetId = entry.id;
    entry.tries = (entry.tries || 0) + 1;
    _translate(entry.word).then(async (result) => {
      const latestNote = await ensureNote(false);
      if (latestNote && !(await noteStillHasWord(latestNote, entry.word))) {
        return;
      }
      const liveEntry = findLiveEntry(entry.word, targetId);
      if (!liveEntry) return;
      liveEntry.trans = result.trans || liveEntry.trans;
      liveEntry.def = result.def || liveEntry.def;
      liveEntry.pos = result.pos || liveEntry.pos;
      liveEntry.phone = result.phone || liveEntry.phone;
      if (result.example) liveEntry.ctx = result.example;
      liveEntry.status = result.trans || result.def ? "completed" : liveEntry.status;
      await _doSyncNoteSafe();
    });
    retried++;
  }

  if (retried > 0) {
    pwNotify(t(_uiLanguage, "notify.retrying", { count: retried }));
  }
}

function getDocLocaleVars(doc: Document) {
  const help = doc.getElementById("vb-pref-help");
  return {
    name: help?.getAttribute("data-build-name") || config.addonName,
    version: help?.getAttribute("data-build-version") || version,
    time: help?.getAttribute("data-build-time") || "",
    shortcut: formatShortcutLabel(
      getPref("quickAddShortcut") || DEFAULT_QUICK_ADD_SHORTCUT,
    ),
  };
}

function refreshPrefsLanguage() {
  for (const doc of [..._prefsDocs]) {
    try {
      if (!doc.defaultView || doc.defaultView.closed) {
        _prefsDocs.delete(doc);
        continue;
      }

      applyDocumentLanguage(doc, _uiLanguage, getDocLocaleVars(doc));
      const emailBox = doc.getElementById("vb-feedback-email");
      if (emailBox) {
        emailBox.textContent = FEEDBACK_EMAIL;
      }
      toggleCustomAPISection(doc);
      updateExportHint(doc);
    } catch (e) {
      _prefsDocs.delete(doc);
    }
  }
}

async function toggleUILanguage() {
  _uiLanguage = _uiLanguage === "zh-CN" ? "en-US" : "zh-CN";
  setPref("uiLanguage", _uiLanguage);
  refreshUI();
  await _doSyncNoteSafe();
}

async function onPrefsEvent(type: string, data: any) {
  if (type !== "load" || !data?.window) return;

  try {
    const doc = data.window.document;
    _prefsDocs.add(doc);
    loadSettingsFromPrefs();
    refreshUI();

    const openBtn = doc.getElementById("vb-open-note");
    bindEventOnce(openBtn, "OpenNote", "click", () => {
      void _openVocabNote();
    });

    const input = doc.getElementById("vb-quick-input") as any;
    const addBtn = doc.getElementById("vb-quick-add") as any;
    if (addBtn && input) {
      const doAdd = () => {
        const word = input.value?.trim();
        if (!word) return;
        input.value = "";
        addWord(word, "", "")
          .then((entry) => {
            if (entry) {
              refreshPrefsCounts();
            } else {
              pwNotify(t(_uiLanguage, "notify.duplicateInvalid"), "error");
            }
          })
          .catch((e) => {
            Zotero.debug("VocabBuilder: prefs add: " + e);
          });
      };

      bindEventOnce(addBtn, "QuickAdd", "click", doAdd);
      bindEventOnce(input, "QuickAddEnter", "keydown", (e: any) => {
        if (e.key === "Enter") doAdd();
      });
    }

    const select = doc.getElementById("vb-api-select") as any;
    if (select) {
      select.value = _apiName;
      bindEventOnce(select, "APISelect", "change", () => {
        _setAPI(select.value);
        toggleCustomAPISection(doc);
        refreshUI();
      });
    }

    bindTextPref(doc, "vb-custom-api-url", "customApiUrl");
    bindTextPref(doc, "vb-custom-api-headers", "customApiHeaders");
    bindTextPref(doc, "vb-custom-api-trans", "customApiTransPath");
    bindTextPref(doc, "vb-custom-api-def", "customApiDefPath");
    bindTextPref(doc, "vb-custom-api-pos", "customApiPosPath");
    bindTextPref(doc, "vb-custom-api-phone", "customApiPhonePath");
    bindTextPref(doc, "vb-export-format", "exportFormat");
    bindTextPref(doc, "vb-export-scope", "exportScope");

    const syncBtn = doc.getElementById("vb-sync");
    bindEventOnce(syncBtn, "Sync", "click", () => {
      void _syncFromNote();
    });

    const exportBtn = doc.getElementById("vb-export-btn");
    bindEventOnce(exportBtn, "Export", "click", () => {
      const format = getInputValue(doc, "vb-export-format") as ExportFormat;
      const scope = getInputValue(doc, "vb-export-scope") as ExportScope;
      void exportVocabulary(data.window, format || "csv", scope || "all");
    });

    const feedbackCopyBtn = doc.getElementById("vb-feedback-copy");
    bindEventOnce(feedbackCopyBtn, "FeedbackCopy", "click", () => {
      copyToClipboard(FEEDBACK_EMAIL);
      pwNotify(t(_uiLanguage, "notify.feedbackEmailCopied"), "success");
    });
  } catch (e) {
    Zotero.debug("VocabBuilder: prefs: " + e);
  }
}

function addMenu(win: any) {
  try {
    const doc = win.document;
    if (doc.getElementById("vb-sep")) return;

    const pop = doc.getElementById("menu_ToolsPopup");
    if (!pop) return;

    const sep = doc.createXULElement("menuseparator");
    sep.setAttribute("id", "vb-sep");
    pop.appendChild(sep);

    const openItem = doc.createXULElement("menuitem");
    openItem.setAttribute("id", "vb-menu-vocab");
    openItem.addEventListener("command", () => {
      void _openVocabNote();
    });
    pop.appendChild(openItem);

    const addItem = doc.createXULElement("menuitem");
    addItem.setAttribute("id", "vb-menu-add");
    addItem.addEventListener("command", () => {
      const word = win.prompt(t(_uiLanguage, "menu.enterWord"), "");
      if (word?.trim()) {
        addWord(word.trim(), "", "")
          .then((entry) => {
            if (entry) {
              return;
            } else {
              pwNotify(t(_uiLanguage, "notify.duplicateInvalid"), "error");
            }
          })
          .catch((e) => {
            Zotero.debug("VocabBuilder: add: " + e);
          });
      }
    });
    pop.appendChild(addItem);

    refreshMenus();
  } catch (e) {
    Zotero.debug("VocabBuilder: addMenu: " + e);
  }
}

async function _openVocabNote() {
  const note = await ensureNote(_ws.length > 0);
  if (note) {
    const opened = await openNoteForEditing(note);
    if (opened) return;
    Zotero.debug("VocabBuilder: open note failed");
  }

  pwNotify(t(_uiLanguage, "notify.noVocabulary"));
}

function getReaderSelection(reader: any): string {
  try {
    const annotation = getReaderSelectionAnnotation(reader);
    if (annotation?.text) return annotation.text.trim();
  } catch (e) {}

  try {
    const selection = reader._iframeWindow?.getSelection();
    if (selection) {
      const text = selection.toString().trim();
      if (text) return text;
    }
  } catch (e) {}

  try {
    const selection = (
      reader._internalReader as any
    )?._primaryView?._iframeWindow?.getSelection();
    if (selection) {
      const text = selection.toString().trim();
      if (text) return text;
    }
  } catch (e) {}

  return "";
}

function getReaderSelectionAnnotation(reader: any): any | null {
  try {
    return (reader?._internalReader as any)?._lastView?._selectionPopup
      ?.annotation;
  } catch (e) {
    return null;
  }
}

type ReaderSourceContext = {
  attachmentKey: string;
  libraryID: number;
  pageIndex: number;
  position: any | null;
  annotationKey: string;
};

function captureReaderSourceContext(reader: any): ReaderSourceContext | null {
  try {
    const item = reader?._item;
    if (!item?.isPDFAttachment?.() || !item.key || !item.libraryID) return null;

    const annotation = getReaderSelectionAnnotation(reader);
    const pageIndex =
      annotation?.position?.pageIndex ??
      annotation?.pageIndex ??
      reader?.state?.pageIndex;
    if (!Number.isInteger(pageIndex) || pageIndex < 0) return null;

    return {
      attachmentKey: String(item.key),
      libraryID: Number(item.libraryID),
      pageIndex,
      position: clonePosition(annotation?.position),
      annotationKey: readAnnotationKey(annotation),
    };
  } catch (e) {
    return null;
  }
}

function buildReaderSourceLink(source: ReaderSourceContext | null): string {
  if (!source) return "";

  try {
    const libraryPath = buildOpenPDFLibraryPath(source.libraryID);
    const params = [`page=${source.pageIndex + 1}`];
    if (source.position) {
      params.push(
        `position=${encodeURIComponent(JSON.stringify(source.position))}`,
      );
    }
    if (source.annotationKey) {
      params.push(`annotation=${encodeURIComponent(source.annotationKey)}`);
    }
    return `zotero://open-pdf/${libraryPath}/items/${encodeURIComponent(source.attachmentKey)}?${params.join("&")}`;
  } catch (e) {
    return "";
  }
}

function buildOpenPDFLibraryPath(libraryID: number): string {
  try {
    const path = Zotero.URI.getLibraryPath(libraryID);
    if (!path) return "library";
    return /^users\//i.test(path) ? "library" : path;
  } catch (e) {
    return "library";
  }
}

function readAnnotationKey(annotation: any): string {
  const key = String(annotation?.key || annotation?.id || "").trim();
  return /^[A-Z0-9]{8}$/.test(key) ? key : "";
}

type ParsedSourceLink = {
  itemID: number;
  pageIndex: number;
  annotationID: string;
  position: any | null;
};

function parseSourceLink(src: string): ParsedSourceLink | null {
  try {
    const match = String(src)
      .trim()
      .match(/^zotero:\/\/open-pdf\/(.+?)\/items\/([A-Z0-9]{8})\?(.+)$/i);
    if (!match) return null;

    const libraryPath = decodeURIComponent(match[1]);
    const itemKey = decodeURIComponent(match[2]);
    const params = new URLSearchParams(match[3]);
    const page = Number(params.get("page") || "0");
    const pageIndex = Number.isFinite(page) && page > 0 ? page - 1 : 0;
    const annotationID = readAnnotationKey({
      key: params.get("annotation") || "",
    });
    const position = parseSourcePosition(params.get("position"));

    const libraryID =
      libraryPath === "library"
        ? _userLibID()
        : Number((Zotero.URI.getPathLibrary(libraryPath) as any)?.libraryID || 0);
    if (!libraryID) return null;

    const item = Zotero.Items.getByLibraryAndKey(libraryID, itemKey) as any;
    const itemID = Number(item?.id || item?.itemID || 0);
    if (!itemID) return null;

    return { itemID, pageIndex, annotationID, position };
  } catch (e) {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getReaderByItemID(itemID: number): any | null {
  try {
    const readers = (Zotero.Reader as any)._readers;
    if (!readers) return null;
    const list: any[] = Array.isArray(readers) ? readers : Object.values(readers);
    return (
      list.find((entry) => {
        const reader = entry?.tabID ? Zotero.Reader.getByTabID(entry.tabID) : entry;
        return Number(reader?.itemID || reader?._item?.id || 0) === itemID;
      }) || null
    );
  } catch (e) {
    return null;
  }
}

async function waitForReaderByItemID(itemID: number): Promise<any | null> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const reader = getReaderByItemID(itemID);
    if (reader) return reader;
    await sleep(120);
  }
  return null;
}

function clonePosition(position: any): any | null {
  if (!position) return null;

  try {
    return JSON.parse(JSON.stringify(position));
  } catch (e) {
    return null;
  }
}

function parseSourcePosition(raw: string | null): any | null {
  if (!raw) return null;
  try {
    const position = JSON.parse(decodeURIComponent(raw));
    return isValidReaderPosition(position) ? position : null;
  } catch (e) {
    return null;
  }
}

function isValidReaderPosition(position: any): boolean {
  if (!position || typeof position !== "object") return false;
  if (!Number.isInteger(position.pageIndex) || position.pageIndex < 0) {
    return false;
  }
  const hasRects = Array.isArray(position.rects) && position.rects.length > 0;
  const hasPaths = Array.isArray(position.paths) && position.paths.length > 0;
  const hasNextPageRects =
    Array.isArray(position.nextPageRects) && position.nextPageRects.length > 0;
  return hasRects || hasPaths || hasNextPageRects;
}

function buildReaderFindState(previousState: any, query: string) {
  return {
    popupOpen: previousState?.popupOpen ?? false,
    active: true,
    query,
    highlightAll: true,
    caseSensitive: false,
    entireWord: true,
    index: null,
    result: null,
  };
}

async function triggerNativeReaderFind(reader: any, query: string): Promise<boolean> {
  const internalReader = reader?._internalReader || reader;
  if (!internalReader) return false;

  const primary = internalReader._lastViewPrimary ?? true;
  const stateKey = primary ? "primaryViewFindState" : "secondaryViewFindState";
  const view = primary ? internalReader._primaryView : internalReader._secondaryView;
  if (!view) return false;

  try {
    await view.initializedPromise;
  } catch (e) {}

  const nextFindState = buildReaderFindState(
    internalReader?._state?.[stateKey],
    query,
  );
  const resetFindState = {
    ...nextFindState,
    active: false,
  };

  if (typeof internalReader._updateState === "function") {
    internalReader._updateState({
      [stateKey]: resetFindState,
    });
    internalReader._updateState({
      [stateKey]: nextFindState,
    });
    return true;
  }

  if (typeof view.setFindState === "function") {
    await view.setFindState(resetFindState);
    await view.setFindState(nextFindState);
    return true;
  }

  return false;
}

async function getReaderSearchContext(reader: any): Promise<{
  iframeWindow: any;
  app: any;
} | null> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const iframeWindow =
      reader?._iframeWindow ||
      (reader?._internalReader as any)?._primaryView?._iframeWindow;
    const app = iframeWindow?.PDFViewerApplication;

    if (app) {
      try {
        await app.initializedPromise;
      } catch (e) {}

      if (
        typeof (app.findController as any)?.executeCommand === "function" ||
        typeof app.eventBus?.dispatch === "function" ||
        typeof iframeWindow?.find === "function"
      ) {
        return { iframeWindow, app };
      }
    }

    await sleep(120);
  }

  return null;
}

async function highlightReaderQuery(reader: any, query: string): Promise<void> {
  const rawQuery = String(query || "").trim();
  const cleanedQuery = cleanWord(rawQuery) || rawQuery;
  if (!cleanedQuery) return;

  if (await triggerNativeReaderFind(reader, cleanedQuery)) {
    return;
  }

  const searchContext = await getReaderSearchContext(reader);
  if (!searchContext) return;

  const { iframeWindow, app } = searchContext;

  try {
    const eventBus = app?.eventBus as any;
    const searchState = {
      query: cleanedQuery,
      phraseSearch: true,
      caseSensitive: false,
      entireWord: true,
      highlightAll: true,
      findPrevious: false,
      matchDiacritics: false,
    };
    if (typeof (app?.findController as any)?.executeCommand === "function") {
      (app.findController as any).executeCommand("find", searchState);
      (app.findController as any).executeCommand("find", {
        ...searchState,
        type: "again",
      });
      return;
    }
    if (typeof eventBus?.dispatch === "function") {
      eventBus.dispatch("find", {
        source: app || reader,
        type: "",
        ...searchState,
      });
      await sleep(120);
      eventBus.dispatch("find", {
        source: app || reader,
        type: "again",
        ...searchState,
      });
      return;
    }
  } catch (e) {}

  try {
    iframeWindow?.focus?.();
    if (typeof iframeWindow?.find === "function") {
      iframeWindow.find(
        cleanedQuery,
        false,
        false,
        true,
        false,
        false,
        false,
      );
    }
  } catch (e) {}
}

async function openSourceLink(src: string, query: string): Promise<void> {
  const parsed = parseSourceLink(src);
  if (!parsed) return;

  const location: any = parsed.position
    ? { position: parsed.position }
    : { pageIndex: parsed.pageIndex };
  if (!parsed.position && parsed.annotationID) {
    location.pageIndex = parsed.pageIndex;
  }

  try {
    await (Zotero.Reader as any).open(parsed.itemID, location, {
      openInBackground: false,
      allowDuplicate: false,
    });
  } catch (e) {
    Zotero.debug("VocabBuilder: open source: " + e);
  }

  const reader = await waitForReaderByItemID(parsed.itemID);
  if (!reader) return;

  if (parsed.position) return;

  if (parsed.annotationID) {
    const annotations = (reader?._internalReader as any)?._state?.annotations || [];
    const annotation = annotations.find((item: any) => item?.id === parsed.annotationID);
    const position = clonePosition(annotation?.position);
    if (position) {
      try {
        await reader.navigate({ position });
        return;
      } catch (e) {}
    }
  }

  await highlightReaderQuery(reader, query);
}

function findSourceAnchor(target: any): any | null {
  try {
    const element =
      target?.nodeType === 1 ? target : target?.parentElement || null;
    const anchor = element?.closest?.("a") || null;
    if (!anchor) return null;

    const href = String(anchor.getAttribute?.("href") || "").trim();
    const source = String(anchor.getAttribute?.("data-vb-source") || "").trim();
    if (source.startsWith("zotero://open-pdf/")) return anchor;
    if (href.startsWith("zotero://open-pdf/")) return anchor;
    return null;
  } catch (e) {
    return null;
  }
}

function attachNoteEditorLinks() {
  const editors = ((Zotero.Notes as any)?._editorInstances || []) as any[];
  for (const editor of editors) {
    const noteID = getNoteID(editor?._item);
    if (!noteID || !_noteID || noteID !== _noteID) continue;

    const win = editor?._iframeWindow;
    const doc = win?.document;
    if (!win || !doc) continue;
    if (doc._vbSourceLinksAttached) continue;

    doc.addEventListener(
      "click",
      (event: any) => {
        const anchor = findSourceAnchor(event.target);
        if (!anchor) return;

        const src = String(
          anchor.getAttribute("data-vb-source") ||
            anchor.getAttribute("href") ||
            "",
        ).trim();
        const query = String(
          anchor.getAttribute("data-vb-query") ||
            anchor.getAttribute("data-vb-word") ||
            anchor.querySelector?.("strong")?.textContent ||
            anchor.textContent ||
            "",
        ).trim();
        if (!src) return;

        event.preventDefault();
        event.stopPropagation();
        void openSourceLink(src, query);
      },
      true,
    );

    doc._vbSourceLinksAttached = true;
  }
}

function attachReaderKeys(win: any, reader?: any) {
  if (!win || win._vbAttached) return;
  win._vbAttached = true;

  win.addEventListener("keydown", (e: any) => {
    if (matchesShortcut(e, _quickAddShortcut)) {
      // 快捷键添加时快速取消并关闭气泡（含未到期的显示定时器）
      win._vbCancelBubble?.();
      let text = "";
      if (reader) text = getReaderSelection(reader);
      if (!text) {
        try {
          text = win.getSelection()?.toString()?.trim() || "";
        } catch (ex) {}
      }
      if (text) void handleAltA(e, text, reader);
    }
  });

  attachSelectionBubble(win, reader);
}

/**
 * 阅读器选中英文单词后，在选区上方显示“添加到生词表”气泡按钮。
 * 点击即调用与快捷键相同的 handleAltA 链路（含例句提取）。
 */
function attachSelectionBubble(win: any, reader?: any) {
  if (!win || win._vbBubbleAttached) return;
  const doc = win.document;
  if (!doc) return;
  win._vbBubbleAttached = true;

  let bubble: HTMLElement | null = null;
  let showTimer: ReturnType<typeof setTimeout> | null = null;
  // mousedown 起点（用于判断拖动与方向）
  let mouseDownPos: { x: number; y: number } | null = null;
  // mouseup 瞬间缓存的鼠标位置（气泡锚点；键盘选中时为 null 走选区定位）
  let mouseAnchor: { x: number; y: number } | null = null;
  // 拖动方向（从左往右选词 → 气泡放右侧；从右往左 → 左侧）
  let dragDirection: "left" | "right" | null = null;
  // 双击选词模式（气泡显示在鼠标上方/下方，而非左右侧）
  let dblClickMode = false;
  // mouseup 瞬间缓存的选区矩形（键盘选中回退用）
  let cachedAnchorRect: DOMRect | null = null;

  const hideBubble = () => {
    if (bubble) bubble.style.display = "none";
  };
  win._vbHideBubble = hideBubble;

  // 彻底取消：清掉未到期的显示定时器并隐藏气泡、重置锚点
  const cancelBubble = () => {
    if (showTimer) {
      clearTimeout(showTimer);
      showTimer = null;
    }
    hideBubble();
    mouseAnchor = null;
    cachedAnchorRect = null;
    dragDirection = null;
    dblClickMode = false;
  };
  win._vbCancelBubble = cancelBubble;

  const ensureBubble = (): HTMLElement => {
    if (bubble) return bubble;
    const el = doc.createElement("div");
    el.className = "vb-add-bubble";
    el.style.cssText = [
      "position:fixed",
      "z-index:2147483647",
      "display:none",
      "padding:6px 12px",
      "border-radius:16px",
      "background:#0f766e",
      "color:#fff",
      "font-size:13px",
      "font-family:system-ui,sans-serif",
      "cursor:pointer",
      "box-shadow:0 2px 8px rgba(0,0,0,.25)",
      "user-select:none",
      "white-space:nowrap",
    ].join(";");
    el.textContent = t(_uiLanguage, "bubble.add");
    // 阻止 mousedown 默认行为，避免点击气泡时清除 iframe 内的选区
    el.addEventListener("mousedown", (e: any) => {
      e.preventDefault();
      e.stopPropagation();
    });
    el.addEventListener("click", (e: any) => {
      e.preventDefault();
      e.stopPropagation();
      if (showTimer) clearTimeout(showTimer);
      hideBubble();

      // 与快捷键 keydown 处理逐字一致：读取选区 → handleAltA，
      // 由 handleAltA 内部统一提取例句（不再预提取、不再传缓存句子）
      let text = "";
      if (reader) text = getReaderSelection(reader);
      if (!text) {
        try {
          text = win.getSelection()?.toString()?.trim() || "";
        } catch (ex) {}
      }
      if (text) {
        void handleAltA(
          { preventDefault() {}, stopPropagation() {} },
          text,
          reader,
        );
      }
    });
    doc.body.appendChild(el);
    bubble = el;
    return el;
  };

  const showBubble = () => {
    try {
      // 鼠标定位优先：用 mouseup 瞬间缓存的鼠标位置（选完单词那一刻），
      // 气泡放在鼠标右侧（默认）/左侧（右侧空间不足），垂直中心对齐鼠标。
      // 键盘选中（无鼠标位置）时回退到选区矩形定位。
      const bubbleEl = ensureBubble();
      bubbleEl.style.display = "block";
      // 先测量实际尺寸（同一同步块内完成，不会闪烁），再计算位置
      bubbleEl.style.visibility = "hidden";
      const bubbleWidth = bubbleEl.offsetWidth || 140;
      const bubbleHeight = bubbleEl.offsetHeight || 34;
      const gap = 0;
      const margin = 0;
      // 显示在“上方”时额外上移的量（让气泡更靠上一点）
      const aboveOffset = 6;
      // 双击模式离鼠标更远的额外间距
      const dblAboveOffset = 16;

      let left: number;
      let top: number;
      let anchorLabel: string;

      if (mouseAnchor) {
        if (dblClickMode) {
          // 双击选词：气泡水平居中于鼠标，显示在鼠标上方（优先）/下方（兜底）
          left = Math.max(
            margin,
            Math.min(
              mouseAnchor.x - bubbleWidth / 2,
              win.innerWidth - bubbleWidth - margin,
            ),
          );
          top = mouseAnchor.y - bubbleHeight - gap - dblAboveOffset;
          if (top < margin) {
            // 下方兜底：间距与上方一致
            top = mouseAnchor.y + gap + dblAboveOffset;
          }
          top = Math.max(
            margin,
            Math.min(top, win.innerHeight - bubbleHeight - margin),
          );
        } else {
          // 拖动选择：气泡在鼠标的左上方/右上方（随方向），
          // 上方空间不足时改为左下方/右下方
          if (dragDirection === "left") {
            left = mouseAnchor.x - gap - bubbleWidth;
            if (left < margin) {
              left = mouseAnchor.x + gap;
            }
            left = Math.min(left, win.innerWidth - bubbleWidth - margin);
            left = Math.max(margin, left);
          } else {
            left = mouseAnchor.x + gap;
            if (left + bubbleWidth > win.innerWidth - margin) {
              left = Math.max(margin, mouseAnchor.x - gap - bubbleWidth);
            }
          }
          // 垂直：默认气泡在鼠标上方（左上方/右上方），空间不足则放下方
          top = mouseAnchor.y - bubbleHeight - gap - aboveOffset;
          if (top < margin) {
            top = mouseAnchor.y + gap;
          }
          top = Math.max(
            margin,
            Math.min(top, win.innerHeight - bubbleHeight - margin),
          );
        }
        anchorLabel = `mouse=${Math.round(mouseAnchor.x)},${Math.round(mouseAnchor.y)} dir=${dragDirection ?? (dblClickMode ? "dbl" : "")}`;
      } else {
        // 键盘选中回退：用缓存的选区矩形（缺失时实时获取）
        let rect = cachedAnchorRect;
        if (!rect) {
          const selection = win.getSelection();
          if (!selection || selection.rangeCount === 0) return hideBubble();
          const text = selection.toString().trim();
          if (!cleanWord(text)) return hideBubble();
          const r = selection.getRangeAt(0).getBoundingClientRect();
          if (!r || (r.width === 0 && r.height === 0)) return hideBubble();
          rect = r;
        }
        const anchorRect: DOMRect = rect as DOMRect;

        // 水平：以选区为中心居中
        left = Math.max(
          margin,
          Math.min(
            anchorRect.left + anchorRect.width / 2 - bubbleWidth / 2,
            win.innerWidth - bubbleWidth - margin,
          ),
        );
        // 垂直：优先选区正上方，空间不足则正下方
        top = anchorRect.top - bubbleHeight - gap;
        if (top < margin) {
          top = anchorRect.bottom + gap;
          if (top + bubbleHeight > win.innerHeight - margin) {
            top = Math.max(
              margin,
              Math.min(
                anchorRect.top,
                win.innerHeight - bubbleHeight - margin,
              ),
            );
          }
        }
        anchorLabel = `rect=${Math.round(anchorRect.left)},${Math.round(anchorRect.top)} ${Math.round(anchorRect.width)}x${Math.round(anchorRect.height)}`;
      }

      bubbleEl.style.left = `${left}px`;
      bubbleEl.style.top = `${top}px`;
      bubbleEl.style.visibility = "visible";

      // 调试日志：输出锚点与气泡最终位置，便于定位偏差
      Zotero.debug(
        `VocabBuilder: bubble anchor=${anchorLabel} bubble=${bubbleWidth}x${bubbleHeight} at=${Math.round(left)},${Math.round(top)} viewport=${Math.round(win.innerWidth)}x${Math.round(win.innerHeight)}`,
      );
    } catch (e) {
      hideBubble();
    }
  };

  const scheduleShow = () => {
    if (showTimer) clearTimeout(showTimer);
    showTimer = setTimeout(showBubble, 120);
  };

  // 气泡开关：可在设置中关闭（关闭后不显示，也不响应选中）
  const bubbleEnabled = () => getPref("selectionBubbleEnabled") !== false;

  // mousedown 记录起点：用于判断是否真正拖动选择了单词，以及拖动方向
  win.addEventListener("mousedown", (e: any) => {
    mouseDownPos = { x: e.clientX, y: e.clientY };
    mouseAnchor = null;
    if (!bubbleEnabled()) hideBubble();
  });

  // mouseup 瞬间：按"是否真正选中了文本"决定是否显示气泡；
  // 拖动选择 → 气泡在鼠标左右侧（随方向）；双击选词 → 气泡在鼠标上方/下方
  win.addEventListener("mouseup", (e: any) => {
    if (!bubbleEnabled()) {
      hideBubble();
      return;
    }
    let selectedText = "";
    let selectionRect: DOMRect | null = null;
    try {
      const selection = win.getSelection();
      if (selection && selection.rangeCount > 0) {
        selectedText = selection.toString().trim();
        const r = selection.getRangeAt(0).getBoundingClientRect();
        if (r && r.width > 0 && r.height > 0) {
          selectionRect = r;
        }
      }
    } catch (ex) {}

    // 没有选中有效文本：不弹气泡
    if (!cleanWord(selectedText)) {
      mouseAnchor = null;
      dragDirection = null;
      cachedAnchorRect = null;
      return;
    }

    cachedAnchorRect = selectionRect;
    if (e.detail >= 2) {
      // 双击选词：气泡显示在鼠标上方/下方（水平居中于鼠标）
      mouseAnchor = { x: e.clientX, y: e.clientY };
      dragDirection = null;
      dblClickMode = true;
    } else {
      mouseAnchor = { x: e.clientX, y: e.clientY };
      dragDirection =
        mouseDownPos && e.clientX < mouseDownPos.x ? "left" : "right";
      dblClickMode = false;
    }
    scheduleShow();
  });
  win.addEventListener("keyup", () => {
    if (!bubbleEnabled()) {
      hideBubble();
      return;
    }
    mouseAnchor = null;
    dragDirection = null;
    dblClickMode = false;
    cachedAnchorRect = null;
    scheduleShow();
  });
  win.addEventListener("scroll", hideBubble, true);
  doc.addEventListener("scroll", hideBubble, true);
  doc.addEventListener(
    "click",
    (e: any) => {
      if (!e.target?.closest?.(".vb-add-bubble")) hideBubble();
    },
    true,
  );
}

async function handleAltA(e: any, text: string, reader?: any) {
  const selectedText = text.trim();
  if (!selectedText) return;

  e.preventDefault();
  e.stopPropagation();

  const word = cleanWord(selectedText);
  if (!word) return;

  // 语境（例句）不再从阅读器 DOM 提取，改由翻译 API 返回后填充
  const source = captureReaderSourceContext(reader);
  const entry = await addWord(word, "", buildReaderSourceLink(source));
  if (!entry) {
    pwNotify(t(_uiLanguage, "notify.duplicate", { word }), "error");
    return;
  }
}

function pwNotify(msg: string, tone: NotificationTone = "info") {
  showNotification(msg, tone);
}

/** 当前 PDF 附件中已收录的生词（按来源链接里的附件 key 匹配） */
function getKnownWordsForAttachment(reader: any): string[] {
  const itemKey = reader?._item?.key;
  if (!itemKey) return [];

  const words: string[] = [];
  for (const entry of _ws) {
    if (!entry.src) continue;
    const match = String(entry.src).match(/\/items\/([A-Z0-9]{8})(?:\?|$)/i);
    if (match && match[1] === itemKey) {
      const cleaned = cleanWord(entry.word);
      if (cleaned) words.push(cleaned);
    }
  }
  return words;
}

/**
 * 生词高亮回看：在 PDF 文本层中找到已收录的生词并加高亮。
 * 幂等（已高亮的 span 跳过）；翻页后新渲染的 span 会在下次轮询补高亮。
 */
function highlightKnownWordsInReader(reader: any): void {
  try {
    if (getPref("highlightReadWordsEnabled") === false) return;

    const win = reader?._iframeWindow;
    const doc = win?.document;
    if (!doc) return;

    const words = getKnownWordsForAttachment(reader);
    if (!words.length) return;

    // 高亮样式（每个文档注入一次）
    if (!doc._vbHlStyleInjected) {
      const style = doc.createElement("style");
      style.textContent =
        ".vb-hl-word{background-color:rgba(255,235,59,.45)!important;border-radius:2px}";
      (doc.head || doc.documentElement).appendChild(style);
      doc._vbHlStyleInjected = true;
    }

    const wordSet = new Set(words);
    const spans = doc.querySelectorAll(
      ".textLayer span, .textLayer div",
    ) as NodeListOf<Element>;
    let count = 0;
    spans.forEach((span: Element) => {
      if (span.classList.contains("vb-hl-word")) return;
      const cleaned = cleanWord((span.textContent || "").trim());
      if (cleaned && wordSet.has(cleaned)) {
        span.classList.add("vb-hl-word");
        count++;
      }
    });
    if (count > 0) {
      Zotero.debug(`VocabBuilder: highlighted ${count} known words`);
    }
  } catch (e) {}
}

function pollReaders() {
  try {
    const readers = (Zotero.Reader as any)._readers;
    if (!readers) return;

    const list: any[] = Array.isArray(readers)
      ? readers
      : Object.values(readers);
    for (const entry of list) {
      const reader = entry?.tabID
        ? Zotero.Reader.getByTabID(entry.tabID)
        : entry;
      if (!reader) continue;

      // attachReaderKeys 自身按 window 幂等防重（_vbAttached），
      // 因此这里每次轮询都可安全调用；iframe 重建后新 window 会被重新绑定。
      const iframeWindow = reader._iframeWindow;
      if (iframeWindow) attachReaderKeys(iframeWindow, reader);

      try {
        const primaryWindow = (reader._internalReader as any)?._primaryView
          ?._iframeWindow;
        if (primaryWindow && primaryWindow !== iframeWindow) {
          attachReaderKeys(primaryWindow, reader);
        }
      } catch (e) {}

      // 生词高亮回看（幂等；翻页后新渲染的 span 在下次轮询补高亮）
      highlightKnownWordsInReader(reader);
    }
  } catch (e) {}
}

function addMainWindowKeys(win: any) {
  if (!win || win._vbMainAttached) return;
  win._vbMainAttached = true;

  win.addEventListener("keydown", (e: any) => {
    if (matchesShortcut(e, _quickAddShortcut)) {
      try {
        const tabID = win.Zotero_Tabs?.selectedID;
        if (!tabID) return;
        const reader = Zotero.Reader.getByTabID(tabID);
        if (!reader) return;
        const text = getReaderSelection(reader);
        if (text) {
          void handleAltA(e, text, reader);
        }
      } catch (ex) {}
    }
  });
}

async function onStartup() {
  try {
    await Promise.all([
      Zotero.initializationPromise,
      Zotero.unlockPromise,
      Zotero.uiReadyPromise,
    ]);

    await registerPrefsPane();
    registerNoteObserver();
    await reloadStateFromDisk({ upgradeLegacyMarkup: true });

    pollReaders();
    attachNoteEditorLinks();
    setInterval(pollReaders, 3000);
    setInterval(attachNoteEditorLinks, 1500);

    for (const win of Zotero.getMainWindows()) {
      addMenu(win);
      addMainWindowKeys(win);
    }
    refreshUI();

    if (
      _ws.some(
        (entry) => entry.status === "pending" || entry.status === "failed",
      ) &&
      (typeof navigator === "undefined" || navigator.onLine)
    ) {
      setTimeout(_retryPending, 3000);
    }

    for (const win of Zotero.getMainWindows()) {
      try {
        (win as any).addEventListener("online", () => {
          setTimeout(_retryPending, 3000);
        });
      } catch (e) {}
    }

    addon.data.initialized = true;
  } catch (e) {
    Zotero.debug("VocabBuilder: startup: " + e);
  }
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow) {
  addMenu(win as any);
  addMainWindowKeys(win as any);
  refreshUI();
}

async function reloadStateFromDisk(options: { upgradeLegacyMarkup?: boolean } = {}) {
  try {
    loadSettingsFromPrefs();
    await migrateLegacyStateIfNeeded();

    const note = await ensureNote(false);
    if (note) {
      await syncEntriesFromNote(note);
      if (options.upgradeLegacyMarkup && noteNeedsMarkupUpgrade(note)) {
        await _doSyncNoteSafe();
      }
      attachNoteEditorLinks();
      return;
    }

    rememberNote(null);
    _ws = [];
    refreshUI();
  } catch (e) {
    Zotero.debug("VocabBuilder: reload state: " + e);
  }
}

function onShutdown() {
  _prefsDocs.clear();
  if (_noteRefreshTimer) {
    clearTimeout(_noteRefreshTimer);
    _noteRefreshTimer = null;
  }
  unregisterNoteObserver();
  if (_prefPaneID) {
    try {
      Zotero.PreferencePanes.unregister(_prefPaneID);
    } catch (e) {}
    _prefPaneID = null;
  }
  addon.data.alive = false;
  delete (Zotero as any)[config.addonInstance];
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload: function () {},
  onNotify: function () {},
  onPrefsEvent,
  reloadStateFromDisk,
  onShortcuts: function () {},
};
