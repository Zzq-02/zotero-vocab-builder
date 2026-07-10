import { config } from "../package.json";

/* ========== Path Utilities ========== */
function pf(): string {
  try { const p = (Zotero as any).ProfileDirectory; if (p) { if (typeof p === "string") return p; if (p.path) return p.path; } } catch(e) {}
  try { return ((Components as any).classes["@mozilla.org/file/directory_service;1"].getService(Components.interfaces.nsIProperties).get("ProfD", Components.interfaces.nsIFile) as any).path; } catch(e) {}
  return "";
}

/* ========== Storage ========== */
let _ws: any[] = [], _fp = "", _st: any = null, _noteID: number | null = null;

function _sv() {
  if (_st) clearTimeout(_st);
  _st = setTimeout(() => {
    try {
      const data: any = { words: _ws, updated: new Date().toISOString(), api: _apiName };
      if (_noteID) data.noteID = _noteID;
      IOUtils.writeJSON(_fp, data).catch(() => {});
    } catch(e) {}
  }, 500);
}

function clean(t: string): string {
  if (!t) return "";
  return t.trim().replace(/[^a-zA-Z'\- ]/g,"").replace(/\s+/g," ").toLowerCase();
}

function isDup(p: string): boolean {
  return _ws.some((w: any)=>w.word.toLowerCase()===p.toLowerCase());
}

/* ========== Translation API ========== */
// Available APIs: "youdao" (default), "dictionary" (Free Dictionary, English only)
let _apiName = "youdao";

function _apiPref(): string { return _apiName; }

function _setAPI(name: string) {
  _apiName = name;
  _sv(); // save to JSON
}

// YouDao free web API (English ↔ Chinese, no key needed)
async function _youdao(text: string): Promise<{ trans: string; def: string } | null> {
  try {
    const r = await fetch(
      `http://fanyi.youdao.com/translate?&i=${encodeURIComponent(text)}&doctype=json&type=EN2ZH_CN`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!r.ok) return null;
    const d: any = await r.json();
    if (d.errorCode === 0 && d.translateResult?.[0]?.[0]?.tgt) {
      return { trans: d.translateResult[0][0].tgt, def: "" };
    }
    return null;
  } catch (e) { return null; }
}

// Free Dictionary API (English definitions + phonetics)
async function _dict(word: string): Promise<{ def: string; pos: string; phone: string } | null> {
  try {
    const r = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) }
    );
    if (r.status === 404) return { def: "[Not found]", pos: "", phone: "" };
    if (!r.ok) return null;
    const d: any = await r.json();
    if (!d?.[0]) return null;
    const e = d[0];
    let def = "", pos = "", phone = e.phonetic || "";
    if (e.meanings) for (const m of e.meanings) {
      if (!pos) pos = m.partOfSpeech || "";
      if (m.definitions?.[0] && !def) def = m.definitions[0].definition;
    }
    return { def, pos, phone };
  } catch (e) { return null; }
}

// Unified translate: tries selected API, then falls back
async function _translate(word: string): Promise<{ trans: string; def: string; pos: string; phone: string }> {
  const result = { trans: "", def: "", pos: "", phone: "" };
  const api = _apiPref();
  // Step 1: translate (YouDao gives Chinese, Dictionary gives English def)
  if (api === "youdao") {
    const y = await _youdao(word);
    if (y) result.trans = y.trans;
    else { const d = await _dict(word); if (d) { result.def = d.def; result.pos = d.pos; result.phone = d.phone; } }
  } else {
    const d = await _dict(word);
    if (d) { result.def = d.def; result.pos = d.pos; result.phone = d.phone; }
  }
  // Step 2: if YouDao didn't give a definition, try to get English def too
  if (api === "youdao" && !result.def) {
    const d = await _dict(word);
    if (d) { result.def = d.def; result.pos = d.pos; result.phone = d.phone; }
  }
  return result;
}

/* ========== Note Management ========== */
function _escapeHtml(s: string): string {
  if (!s) return "";
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function _userLibID(): number {
  try { return (Zotero.Libraries as any).userLibraryID; } catch(e) { return 1; }
}

let _noteTimer: any = null;
let _noteSyncing = false;

function _syncNote() {
  if (_noteTimer) clearTimeout(_noteTimer);
  _noteTimer = setTimeout(async () => {
    try { await _doSyncNote(); } catch(e) { Zotero.debug("VocabBuilder: Note sync: " + e); }
  }, 2000);
}

async function _doSyncNote(): Promise<void> {
  let note: any = null;
  if (_noteID) {
    try {
      note = Zotero.Items.get(_noteID);
      if (!note || !note.isNote()) note = null;
    } catch(e) { note = null; }
  }
  if (!note) {
    try {
      const s = new Zotero.Search();
      s.addCondition("libraryID", "is", String(_userLibID()));
      s.addCondition("itemType", "is", "note");
      s.addCondition("tag", "is", "vocab-builder");
      const ids = await s.search();
      if (ids && ids.length) {
        _noteID = ids[0]; _sv();
        note = Zotero.Items.get(ids[0]);
      }
    } catch(e) {}
  }
  if (!note) {
    try {
      const n = new Zotero.Item("note");
      n.libraryID = _userLibID();
      n.setNote(`<div class="zotero-note znv1"><h1>📚 生词列表 / Vocabulary List</h1><p><i>Loading...</i></p></div>`);
      n.addTag("vocab-builder");
      const id: number = await (n.saveTx() as any) || 0;
      if (id) { _noteID = id; _sv(); note = Zotero.Items.get(id); }
    } catch(e) { Zotero.debug("VocabBuilder: create note: " + e); return; }
  }
  if (!note) return;

  let html = `<div class="zotero-note znv1"><h1>📚 生词列表 / Vocabulary List</h1>`;
  html += `<p><i>Total: ${_ws.length} words · Updated: ${new Date().toLocaleDateString()}</i></p><hr><ul>`;
  for (const w of _ws) {
    const trans = w.trans ? ` <span style="color:#c00;">${_escapeHtml(w.trans)}</span>` : "";
    const def = w.def ? ` — ${w.def}` : "";
    const pos = w.pos ? ` <i>(${w.pos})</i>` : "";
    const phone = w.phone ? ` /${w.phone}/` : "";
    const ctx = w.ctx ? `<br><span style="color:#888;">"${_escapeHtml(w.ctx)}"</span>` : "";
    const icon = w.status === "completed" ? "✅" : w.status === "failed" ? "❌" : "⏳";
    html += `<li>${icon} <b>${_escapeHtml(w.word)}</b>${phone}${pos}${trans}${def}${ctx}</li>`;
  }
  html += `</ul></div>`;

  _noteSyncing = true;
  note.setNote(html);
  await note.saveTx({ notifierData: {} });
  try { await note.reload(); Zotero.Notifier.trigger('modify', 'item', [note.id]); } catch(e) {}
  _noteSyncing = false;
}

/* ========== Observe note edits (bidirectional sync) ========== */
function registerNoteObserver() {
  try {
    Zotero.Notifier.registerObserver({
      notify: (event: string, type: string, ids: any[]) => {
        if (_noteSyncing) return;
        if (event !== 'modify' || type !== 'item') return;
        if (!_noteID || !ids.includes(_noteID)) return;
        // User edited the vocab note — read it back and sync deletions
        try {
          const note = Zotero.Items.get(_noteID);
          if (!note) return;
          const html = note.getNote();
          // Extract words from <b> tags in the note
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, 'text/html');
          const kept: string[] = [];
          doc.querySelectorAll('li b').forEach((b: any) => {
            const w = clean(b.textContent || '');
            if (w) kept.push(w);
          });
          // Remove words that user deleted from note
          const before = _ws.length;
          _ws = _ws.filter((w: any) => kept.includes(w.word));
          if (_ws.length < before) { _sv(); pwNotify("🗑 Synced note deletion"); }
        } catch(e) { Zotero.debug("VocabBuilder: note observer: " + e); }
      }
    }, ['item'], 'vocab-builder');
  } catch(e) { Zotero.debug("VocabBuilder: observer: " + e); }
}

/* ========== Core Word Functions ========== */
async function addWord(word:string, ctx:string, src:string): Promise<any> {
  const c = clean(word);
  if (!c) return null;
  if (isDup(c)) return null;

  const e: any = {
    id: Date.now().toString(36) + Math.random().toString(36).substring(2, 8),
    word: c, def: "", pos: "", phone: "", trans: "",
    ctx: ctx || "", src: src || "",
    created: new Date().toISOString(),
    status: "pending", tries: 0
  };
  _ws.unshift(e); _sv();

  _backgroundSync(e, c);
  return e;
}

async function _backgroundSync(e: any, c: string) {
  try {
    if (navigator.onLine) {
      const r = await _translate(c);
      e.trans = r.trans; e.def = r.def; e.pos = r.pos; e.phone = r.phone;
      e.status = r.trans || r.def ? "completed" : "failed";
      if (e.status === "failed") e.tries = 1;
    } else {
      e.status = "pending";
    }
    _syncNote();
  } catch(e) { Zotero.debug("VocabBuilder: bg sync: " + e); }
}

// Retry pending/failed words when coming online
function _retryPending() {
  if (!navigator.onLine) return;
  let retried = 0;
  for (const w of _ws) {
    if (w.status !== "pending" && w.status !== "failed") continue;
    if ((w.tries || 0) >= 3) continue;
    w.tries = (w.tries || 0) + 1;
    _translate(w.word).then(r => {
      w.trans = r.trans || w.trans;
      w.def = r.def || w.def;
      w.pos = r.pos || w.pos;
      w.phone = r.phone || w.phone;
      w.status = r.trans || r.def ? "completed" : w.status;
      _sv(); _syncNote();
    });
    retried++;
  }
  if (retried > 0) pwNotify("🔄 Retrying " + retried + " pending words");
}

function deleteWord(id: string) {
  _ws = _ws.filter(w => w.id !== id);
  _sv();
  _syncNote();
}

/* ========== Menu ========== */
function addMenu(win: any) {
  try {
    const doc = win.document;
    if (doc.getElementById("vb-sep")) return;
    const pop = doc.getElementById("menu_ToolsPopup");
    if (!pop) return;

    const sep = doc.createXULElement("menuseparator");
    sep.setAttribute("id", "vb-sep"); pop.appendChild(sep);

    const el1 = doc.createXULElement("menuitem");
    el1.setAttribute("label", "📚 Vocab");
    el1.setAttribute("id", "vb-menu-vocab");
    el1.addEventListener("command", function() { openVocabNote(win); });
    pop.appendChild(el1);

    const el2 = doc.createXULElement("menuitem");
    el2.setAttribute("label", "+ Quick Add Word");
    el2.setAttribute("id", "vb-menu-add");
    el2.addEventListener("command", function() {
      const w = win.prompt("Enter word:", "");
      if (w?.trim()) {
        addWord(w.trim(), "", "").then(r => {
          if (r) pwNotify("✅ Added: " + r.word);
          else pwNotify("⏭ Duplicate or invalid word.");
        }).catch(e => { Zotero.debug("VocabBuilder: add: " + e); });
      }
    });
    pop.appendChild(el2);

    const el3 = doc.createXULElement("menuitem");
    el3.setAttribute("label", "📥 Export");
    el3.setAttribute("id", "vb-menu-export");
    el3.addEventListener("command", function() { exportVocab(win); });
    pop.appendChild(el3);

    const el4 = doc.createXULElement("menuitem");
    el4.setAttribute("label", "🔁 API: " + _apiName);
    el4.setAttribute("id", "vb-menu-api");
    el4.addEventListener("command", function() {
      const newApi = _apiName === "youdao" ? "dictionary" : "youdao";
      _setAPI(newApi);
      win.alert("✅ Switched to: " + newApi);
    });
    pop.appendChild(el4);
  } catch(e: any) { Zotero.debug("VocabBuilder: addMenu: " + e); }
}

function openVocabNote(win: any) {
  if (_noteID) {
    try {
      (Zotero.Notes as any).open(_noteID, null, { openInWindow: false });
      return;
    } catch(e) { Zotero.debug("VocabBuilder: openNote: " + e); }
  }
  try {
    _syncNote();
    setTimeout(() => {
      if (_noteID) {
        try { (Zotero.Notes as any).open(_noteID, null, { openInWindow: false }); } catch(e) {}
      } else {
        win.alert("No vocabulary yet. Add a word first.");
      }
    }, 3000);
  } catch(e) {}
}

/* ========== Reader: Alt+A ========== */
function getReaderSelection(reader: any): string {
  try {
    const anno = (reader._internalReader as any)?._lastView?._selectionPopup?.annotation;
    if (anno?.text) return anno.text.trim();
  } catch(e) {}
  try {
    const sel = reader._iframeWindow?.getSelection();
    if (sel) { const t = sel.toString().trim(); if (t) return t; }
  } catch(e) {}
  try {
    const sel2 = (reader._internalReader as any)?._primaryView?._iframeWindow?.getSelection();
    if (sel2) { const t = sel2.toString().trim(); if (t) return t; }
  } catch(e) {}
  return "";
}

function attachReaderKeys(win: any, reader?: any) {
  if (!win || win._vbAttached) return;
  win._vbAttached = true;
  win.addEventListener("keydown", async (e: any) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "a" && !e.isComposing) {
      let text = "";
      if (reader) text = getReaderSelection(reader);
      if (!text) { try { text = win.getSelection()?.toString()?.trim() || ""; } catch(ex) {} }
      if (text) handleAltA(e, text, win);
    }
  });
}

async function handleAltA(e: any, text: string, win?: any) {
  e.preventDefault(); e.stopPropagation();
  const t = text.trim();
  if (!t) return;
  const word = clean(t);
  if (!word) return;
  const r = await addWord(word, t, "");
  if (r) pwNotify("✅ Added: " + r.word);
  else pwNotify("⏭ Duplicate: " + word);
}

function pwNotify(msg: string) {
  try {
    const pw = new (Zotero as any).ProgressWindow({ closeOnClick: true });
    pw.changeHeadline(msg); pw.show(); pw.startCloseTimer(3000);
  } catch(e) {}
}

let _readerSeen: any = {};

function pollReaders() {
  try {
    const readers = (Zotero.Reader as any)._readers;
    if (!readers) return;
    const list: any[] = Array.isArray(readers) ? readers : Object.values(readers);
    for (const entry of list) {
      const r = entry?.tabID ? Zotero.Reader.getByTabID(entry.tabID) : entry;
      if (!r || _readerSeen[r.tabID]) continue;
      const w1 = r._iframeWindow;
      if (w1) attachReaderKeys(w1, r);
      try {
        const w2 = (r._internalReader as any)?._primaryView?._iframeWindow;
        if (w2 && w2 !== w1) attachReaderKeys(w2, r);
      } catch(ex) {}
      _readerSeen[r.tabID] = true;
    }
  } catch(e: any) {}
}

function addMainWindowKeys(win: any) {
  if (!win || win._vbMainAttached) return;
  win._vbMainAttached = true;
  win.addEventListener("keydown", async (e: any) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "a" && !e.isComposing) {
      try {
        const tabID = win.Zotero_Tabs?.selectedID;
        if (!tabID) return;
        const reader = Zotero.Reader.getByTabID(tabID);
        if (!reader) return;
        const text = getReaderSelection(reader);
        if (text) handleAltA(e, text, win);
      } catch(ex) {}
    }
  });
}
function exportVocab(win: any) {
  try {
    const json = JSON.stringify({ exported: new Date().toISOString(), total: _ws.length, words: _ws }, null, 2);
    const clip = ((Components as any).classes)["@mozilla.org/widget/clipboardhelper;1"]
      .getService(Components.interfaces.nsIClipboardHelper);
    clip.copyString(json);
    pwNotify("✅ Copied " + _ws.length + " words");
  } catch(e) {
    try { if (win) win.alert("Export: " + _ws.length + " words"); } catch(e2) {}
  }
}

/* ========== Hooks ========== */
async function onStartup() {
  try {
    await Promise.all([Zotero.initializationPromise, Zotero.unlockPromise, Zotero.uiReadyPromise]);

    const pd = pf();
    if (!pd) return;
    const dd = PathUtils.join(pd, "plugins", "vocab-builder");
    await IOUtils.makeDirectory(dd, { createAncestors: true });
    _fp = PathUtils.join(dd, "vocabulary.json");

    try {
      if (await IOUtils.exists(_fp)) {
        const data = await IOUtils.readJSON(_fp);
        if (Array.isArray(data)) _ws = data;
        else if (data && typeof data === "object") { _ws = data.words || []; _noteID = data.noteID || null; _apiName = data.api || "youdao"; }
      }
    } catch(e) {}

    pollReaders();
    setInterval(pollReaders, 3000);

    for (const w of Zotero.getMainWindows()) { addMenu(w); addMainWindowKeys(w); }

    registerNoteObserver();
    // Retry pending words when coming online
    for (const w of Zotero.getMainWindows()) {
      try {
        (w as any).addEventListener("online", () => { setTimeout(_retryPending, 3000); });
      } catch(e) {}
    }
    _syncNote();
    addon.data.initialized = true;
  } catch(e: any) {}
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow) { addMenu(win as any); addMainWindowKeys(win as any); }

function onShutdown() {
  addon.data.alive = false;
  delete (Zotero as any)[config.addonInstance];
}

export default { onStartup, onShutdown, onMainWindowLoad, onMainWindowUnload: function(){}, onNotify: function(){}, onPrefsEvent: async function(){}, onShortcuts: function(){} };
