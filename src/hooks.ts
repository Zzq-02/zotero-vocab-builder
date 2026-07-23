import { config } from "../package.json";
import {
  NOTE_SEARCH_MARKER,
  NOTE_TAG,
  cleanWord,
  createVocabEntry,
  parseNoteHTML,
  renderNoteHTML,
  type NoteEntry,
  type VocabEntry,
} from "./note-state";
import { loadPersistedState, savePersistedState } from "./state-store";

const NOTE_ID_PREF = `${config.prefsPrefix}.noteID`;

let _ws: VocabEntry[] = [];
let _noteID: number | null = readStoredNoteID();
let _syncBusy = false;
let _syncPending = false;
let _stateSaveChain: Promise<void> = Promise.resolve();
let _apiName = "youdao";
let _readerSeen: Record<string, boolean> = {};
const _prefsDocs = new Set<any>();

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

function snapshotEntries(entries = _ws): VocabEntry[] {
  return entries.map((entry) => ({ ...entry }));
}

function queueStateSave(): Promise<void> {
  const snapshot = {
    noteID: _noteID,
    entries: snapshotEntries(),
  };

  _stateSaveChain = _stateSaveChain
    .then(() => savePersistedState(snapshot))
    .catch((e) => {
      Zotero.debug("VocabBuilder: save state: " + e);
    });

  return _stateSaveChain;
}

function createRenderableEntries(entries = _ws): NoteEntry[] {
  return entries.map((entry) => ({ word: entry.word, entry }));
}

function renderCurrentNoteHTML(): string {
  return renderNoteHTML(createRenderableEntries());
}

async function isDup(word: string): Promise<boolean> {
  return _ws.some((entry) => entry.word === word);
}

function _setAPI(name: string) {
  _apiName = name;
}

async function _fetchAPI(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    return response.ok ? await response.text() : null;
  } catch (e) {
    try {
      return await new Promise((resolve) => {
        const request = new XMLHttpRequest();
        request.open("GET", url, true);
        request.timeout = 12000;
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
): Promise<{ trans: string; def: string; pos: string; phone: string }> {
  const result = { trans: "", def: "", pos: "", phone: "" };

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
          }
          result.phone = data.phonetic || "";
        }
      } catch (e) {}
    }
    return result;
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

  const discoveredNote = (await _findNoteByTag()) || (await _findNoteByMarker());
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
    await queueStateSave();

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

async function importWordsFromNote(note?: any): Promise<number> {
  const noteEntries = await readNoteEntries(note);
  if (!noteEntries.length) return 0;

  const nextEntries = snapshotEntries();
  const seen = new Set(nextEntries.map((entry) => entry.word));
  let imported = 0;

  for (const item of noteEntries) {
    if (!item.word || seen.has(item.word)) continue;
    seen.add(item.word);
    nextEntries.push(createVocabEntry(item.word, { status: "completed" }));
    imported++;
  }

  if (!imported) return 0;

  _ws = nextEntries;
  await queueStateSave();
  refreshUI();
  return imported;
}

async function hydrateFromNoteIfNeeded(): Promise<void> {
  if (_ws.length) return;

  const note = await ensureNote(false);
  if (!note) return;

  const imported = await importWordsFromNote(note);
  if (imported) {
    await _doSyncNoteSafe();
  }
}

function currentWordCount(): number {
  return _ws.length;
}

function refreshMenus() {
  const vocabLabel = `Vocabulary (${currentWordCount()})`;
  const apiLabel = `API: ${_apiName}`;

  for (const win of Zotero.getMainWindows()) {
    try {
      const vocabItem = win.document.getElementById("vb-menu-vocab");
      if (vocabItem) vocabItem.setAttribute("label", vocabLabel);

      const apiItem = win.document.getElementById("vb-menu-api");
      if (apiItem) apiItem.setAttribute("label", apiLabel);
    } catch (e) {}
  }
}

function refreshPrefsCounts() {
  const countLabel = `${currentWordCount()} words`;

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

function refreshUI() {
  refreshMenus();
  refreshPrefsCounts();
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

  await queueStateSave();
  refreshUI();
}

async function _syncFromNote() {
  const note = await ensureNote(false);
  if (!note) {
    pwNotify("No vocabulary yet. Add a word first.");
    return;
  }

  const imported = await importWordsFromNote(note);
  if (imported) {
    await _doSyncNoteSafe();
    pwNotify(`Imported ${imported} words from note.`);
  } else {
    pwNotify("No new words found in note.");
  }
}

async function addWord(
  word: string,
  ctx: string,
  src: string,
): Promise<VocabEntry | null> {
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
  await queueStateSave();
  await _doSyncNoteSafe();
  void _backgroundSync(entry, cleaned);
  return entry;
}

async function _backgroundSync(entry: VocabEntry, cleaned: string) {
  try {
    const online = typeof navigator !== "undefined" ? navigator.onLine : true;
    if (online) {
      const result = await _translate(cleaned);
      entry.trans = result.trans;
      entry.def = result.def;
      entry.pos = result.pos;
      entry.phone = result.phone;
      entry.status = result.trans || result.def ? "completed" : "failed";

      if (entry.status === "failed") {
        entry.tries = Math.max(1, entry.tries || 0);
        pwNotify("Translation failed for: " + cleaned);
      } else if (result.trans) {
        pwNotify(`${cleaned} -> ${result.trans}`);
      } else if (result.def) {
        pwNotify(`${cleaned}: ${result.def.substring(0, 40)}`);
      }
    } else {
      entry.status = "pending";
      pwNotify("Offline. Will retry later: " + cleaned);
    }

    await queueStateSave();
    await _doSyncNoteSafe();
  } catch (err) {
    pwNotify("Error: " + ((err as any)?.message || err));
    Zotero.debug("VocabBuilder: bg sync: " + err);
  }
}

function _retryPending() {
  if (typeof navigator !== "undefined" && !navigator.onLine) return;

  let retried = 0;
  for (const entry of _ws) {
    if (entry.status !== "pending" && entry.status !== "failed") continue;
    if ((entry.tries || 0) >= 3) continue;

    entry.tries = (entry.tries || 0) + 1;
    _translate(entry.word).then(async (result) => {
      entry.trans = result.trans || entry.trans;
      entry.def = result.def || entry.def;
      entry.pos = result.pos || entry.pos;
      entry.phone = result.phone || entry.phone;
      entry.status = result.trans || result.def ? "completed" : entry.status;
      await queueStateSave();
      await _doSyncNoteSafe();
    });
    retried++;
  }

  if (retried > 0) pwNotify(`Retrying ${retried} pending words`);
}

async function onPrefsEvent(type: string, data: any) {
  if (type !== "load" || !data?.window) return;

  try {
    const doc = data.window.document;
    _prefsDocs.add(doc);
    refreshPrefsCounts();

    const openBtn = doc.getElementById("vb-open-note");
    if (openBtn) {
      openBtn.addEventListener("command", () => {
        void _openVocabNote();
      });
    }

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
              pwNotify("Added: " + entry.word);
              refreshPrefsCounts();
            } else {
              pwNotify("Duplicate or invalid word.");
            }
          })
          .catch((e) => {
            Zotero.debug("VocabBuilder: prefs add: " + e);
          });
      };

      addBtn.addEventListener("command", doAdd);
      input.addEventListener("keydown", (e: any) => {
        if (e.key === "Enter") doAdd();
      });
    }

    const select = doc.getElementById("vb-api-select") as any;
    if (select) {
      select.value = _apiName;
      select.addEventListener("command", () => {
        _setAPI(select.value);
        refreshUI();
      });
    }

    const syncBtn = doc.getElementById("vb-sync");
    if (syncBtn) {
      syncBtn.addEventListener("command", () => {
        void _syncFromNote();
      });
    }
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
    addItem.setAttribute("label", "+ Quick Add Word");
    addItem.setAttribute("id", "vb-menu-add");
    addItem.addEventListener("command", () => {
      const word = win.prompt("Enter word:", "");
      if (word?.trim()) {
        addWord(word.trim(), "", "")
          .then((entry) => {
            if (entry) {
              pwNotify("Added: " + entry.word);
            } else {
              pwNotify("Duplicate or invalid word.");
            }
          })
          .catch((e) => {
            Zotero.debug("VocabBuilder: add: " + e);
          });
      }
    });
    pop.appendChild(addItem);

    const apiItem = doc.createXULElement("menuitem");
    apiItem.setAttribute("id", "vb-menu-api");
    apiItem.addEventListener("command", () => {
      _setAPI(_apiName === "youdao" ? "dictionary" : "youdao");
      refreshUI();
    });
    pop.appendChild(apiItem);

    refreshMenus();
  } catch (e) {
    Zotero.debug("VocabBuilder: addMenu: " + e);
  }
}

async function _openVocabNote() {
  const note = await ensureNote(_ws.length > 0);
  if (note) {
    try {
      (Zotero.Notes as any).open(note.id, null, { openInWindow: false });
      return;
    } catch (e) {
      Zotero.debug("VocabBuilder: open note: " + e);
    }
  }

  pwNotify("No vocabulary yet. Add a word first.");
}

function getReaderSelection(reader: any): string {
  try {
    const annotation = (reader._internalReader as any)?._lastView?._selectionPopup
      ?.annotation;
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
    const selection =
      (reader._internalReader as any)?._primaryView?._iframeWindow?.getSelection();
    if (selection) {
      const text = selection.toString().trim();
      if (text) return text;
    }
  } catch (e) {}

  return "";
}

function attachReaderKeys(win: any, reader?: any) {
  if (!win || win._vbAttached) return;
  win._vbAttached = true;

  win.addEventListener("keydown", (e: any) => {
    if (
      e.altKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      e.key.toLowerCase() === "a" &&
      !e.isComposing
    ) {
      let text = "";
      if (reader) text = getReaderSelection(reader);
      if (!text) {
        try {
          text = win.getSelection()?.toString()?.trim() || "";
        } catch (ex) {}
      }
      if (text) void handleAltA(e, text);
    }
  });
}

async function handleAltA(e: any, text: string) {
  e.preventDefault();
  e.stopPropagation();

  const selectedText = text.trim();
  if (!selectedText) return;

  const word = cleanWord(selectedText);
  if (!word) return;

  const entry = await addWord(word, selectedText, "");
  if (entry) {
    pwNotify("Added: " + entry.word);
  } else {
    pwNotify("Duplicate: " + word);
  }
}

function pwNotify(msg: string) {
  try {
    const pw = new (Zotero as any).ProgressWindow({ closeOnClick: true });
    pw.changeHeadline(msg);
    pw.show();
    pw.startCloseTimer(3000);
  } catch (e) {}
}

function pollReaders() {
  try {
    const readers = (Zotero.Reader as any)._readers;
    if (!readers) return;

    const list: any[] = Array.isArray(readers) ? readers : Object.values(readers);
    for (const entry of list) {
      const reader = entry?.tabID ? Zotero.Reader.getByTabID(entry.tabID) : entry;
      if (!reader || _readerSeen[reader.tabID]) continue;

      const iframeWindow = reader._iframeWindow;
      if (iframeWindow) attachReaderKeys(iframeWindow, reader);

      try {
        const primaryWindow = (reader._internalReader as any)?._primaryView
          ?._iframeWindow;
        if (primaryWindow && primaryWindow !== iframeWindow) {
          attachReaderKeys(primaryWindow, reader);
        }
      } catch (e) {}

      _readerSeen[reader.tabID] = true;
    }
  } catch (e) {}
}

function addMainWindowKeys(win: any) {
  if (!win || win._vbMainAttached) return;
  win._vbMainAttached = true;

  win.addEventListener("keydown", (e: any) => {
    if (
      e.altKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      e.key.toLowerCase() === "a" &&
      !e.isComposing
    ) {
      try {
        const tabID = win.Zotero_Tabs?.selectedID;
        if (!tabID) return;
        const reader = Zotero.Reader.getByTabID(tabID);
        if (!reader) return;
        const text = getReaderSelection(reader);
        if (text) void handleAltA(e, text);
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

    const state = await loadPersistedState();
    if (state.noteID) _noteID = state.noteID;
    _ws = state.entries;
    storeNoteID(_noteID);

    await hydrateFromNoteIfNeeded();

    pollReaders();
    setInterval(pollReaders, 3000);

    for (const win of Zotero.getMainWindows()) {
      addMenu(win);
      addMainWindowKeys(win);
    }
    refreshUI();

    if (
      _ws.some((entry) => entry.status === "pending" || entry.status === "failed") &&
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

function onShutdown() {
  _prefsDocs.clear();
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
  onShortcuts: function () {},
};
