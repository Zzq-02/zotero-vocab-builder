import { config } from "../package.json";

/* ========== Storage (memory only, note is source of truth) ========== */
let _ws: any[] = [], _noteID: number | null = null;

function clean(t: string): string {
  if (!t) return "";
  return t.trim().replace(/[^a-zA-Z'\- ]/g,"").replace(/\s+/g," ").toLowerCase();
}

function isDup(p: string): boolean {
  return _ws.some((w: any)=>w.word.toLowerCase()===p.toLowerCase());
}

/* ========== Translation API ========== */
let _apiName = "youdao";

function _setAPI(name: string) { _apiName = name; }

async function _fetchAPI(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    return r.ok ? await r.text() : null;
  } catch(e) {
    try {
      return await new Promise((resolve) => {
        const x = new XMLHttpRequest();
        x.open("GET", url, true); x.timeout = 12000;
        x.onload = () => resolve(x.status === 200 ? x.responseText : null);
        x.onerror = () => resolve(null); x.ontimeout = () => resolve(null);
        x.send();
      });
    } catch(e2) { return null; }
  }
}

async function _translate(word: string): Promise<{ trans: string; def: string; pos: string; phone: string }> {
  const r = { trans: "", def: "", pos: "", phone: "" };
  if (_apiName === "dictionary") {
    const raw = await _fetchAPI(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
    if (raw) {
      try {
        const d = JSON.parse(raw)?.[0];
        if (d) { for (const m of d.meanings || []) { if (!r.pos) r.pos = m.partOfSpeech || ""; if (!r.def && m.definitions?.[0]) r.def = m.definitions[0].definition; } r.phone = d.phonetic || ""; }
      } catch(e) {}
    }
    return r;
  }
  const raw = await _fetchAPI(`http://dict.youdao.com/fsearch?q=${encodeURIComponent(word)}`);
  if (raw) {
    try {
      const doc = new DOMParser().parseFromString(raw, "text/xml");
      const ts: string[] = [];
      doc.querySelectorAll("translation content").forEach((n: any) => { const t = n.textContent?.trim(); if (t && !ts.includes(t)) ts.push(t); });
      if (ts.length) r.trans = ts[0];
    } catch(e) {}
  }
  if (!r.trans && !r.def) {
    const raw2 = await _fetchAPI(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
    if (raw2) {
      try {
        const d = JSON.parse(raw2)?.[0];
        if (d) { for (const m of d.meanings || []) { if (!r.pos) r.pos = m.partOfSpeech || ""; if (!r.def && m.definitions?.[0]) r.def = m.definitions[0].definition; } r.phone = d.phonetic || ""; }
      } catch(e) {}
    }
  }
  return r;
}

/* ========== Note Management ========== */
function _escapeHtml(s: string): string {
  if (!s) return "";
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function _userLibID(): number {
  try { return (Zotero.Libraries as any).userLibraryID; } catch(e) { return 1; }
}

let _syncBusy = false;
let _syncPending = false;

function _syncNote() {
  setTimeout(async () => { await _doSyncNoteSafe(); }, 2000);
}

async function _doSyncNoteSafe(): Promise<void> {
  if (_syncBusy) { _syncPending = true; return; }
  _syncBusy = true;
  try { await _doSyncNote(); } catch(e) { Zotero.debug("VocabBuilder: sync: " + e); }
  _syncBusy = false;
  if (_syncPending) { _syncPending = false; _doSyncNoteSafe(); }
}

async function _doSyncNote(): Promise<void> {
  let note: any = null;
  if (_noteID) {
    try { note = Zotero.Items.get(_noteID); if (!note || !note.isNote()) note = null; } catch(e) { note = null; }
  }
  if (!note) {
    try {
      const s = new Zotero.Search();
      s.addCondition("libraryID", "is", String(_userLibID()));
      s.addCondition("itemType", "is", "note");
      s.addCondition("tag", "is", "vocab-builder");
      const ids = await s.search();
      if (ids?.length) { _noteID = ids[0]; note = Zotero.Items.get(ids[0]); }
    } catch(e) {}
  }
  if (!note) {
    try {
      const n = new Zotero.Item("note");
      n.libraryID = _userLibID();
      n.setNote(`<div class="zotero-note znv1"><h1>📚 生词列表 / Vocabulary List</h1><p><i>Loading...</i></p></div>`);
      n.addTag("vocab-builder");
      const id: number = await (n.saveTx() as any) || 0;
      if (id) { _noteID = id; note = Zotero.Items.get(id); }
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

  note.setNote(html);
  await note.saveTx({ notifierData: {} });
  try { await note.reload(); } catch(e) {}
}

/* ========== Note observer (note = source of truth) ========== */
function registerNoteObserver() {
  try {
    Zotero.Notifier.registerObserver({
      notify: async (event: string, type: string, ids: any[]) => {
        if (_syncBusy) return;
        if (event !== 'modify' || type !== 'item') return;
        if (!_noteID || !ids.includes(_noteID)) return;
        try {
          const note = await Zotero.Items.getAsync(_noteID);
          if (!note) return;
          await note.reload();
          const html = note.getNote();
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const kept: string[] = [];
          doc.querySelectorAll('li b').forEach((b: any) => {
            const w = clean(b.textContent || '');
            if (w) kept.push(w);
          });
          if (kept.length) _ws = _ws.filter((w: any) => kept.includes(w.word));
        } catch(e) {}
      }
    }, ['item'], 'vocab-builder');
  } catch(e) { Zotero.debug("VocabBuilder: observer fail: " + e); }
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
  _ws.unshift(e);
  _doSyncNoteSafe();
  _backgroundSync(e, c);
  return e;
}

async function _backgroundSync(e: any, c: string) {
  try {
    const online = typeof navigator !== "undefined" ? navigator.onLine : true;
    if (online) {
      const r = await _translate(c);
      e.trans = r.trans; e.def = r.def; e.pos = r.pos; e.phone = r.phone;
      e.status = r.trans || r.def ? "completed" : "failed";
      if (e.status === "failed") { e.tries = 1; pwNotify("❌ Translation failed for: " + c); }
      else { if (r.trans) pwNotify("🌐 " + c + " → " + r.trans); else if (r.def) pwNotify("📖 " + c + ": " + r.def.substring(0, 40)); }
    } else { e.status = "pending"; pwNotify("📴 Offline, will retry later: " + c); }
    _doSyncNoteSafe();
  } catch(err) { pwNotify("❌ Error: " + ((err as any)?.message || err)); Zotero.debug("VocabBuilder: bg sync: " + err); }
}

function _retryPending() {
  if (!navigator.onLine) return;
  let retried = 0;
  for (const w of _ws) {
    if (w.status !== "pending" && w.status !== "failed") continue;
    if ((w.tries || 0) >= 3) continue;
    w.tries = (w.tries || 0) + 1;
    _translate(w.word).then(r => {
      w.trans = r.trans || w.trans; w.def = r.def || w.def; w.pos = r.pos || w.pos; w.phone = r.phone || w.phone;
      w.status = r.trans || r.def ? "completed" : w.status;
      _doSyncNoteSafe();
    });
    retried++;
  }
  if (retried > 0) pwNotify("🔄 Retrying " + retried + " pending words");
}

/* ========== Preferences Panel ========== */
async function onPrefsEvent(type: string, data: any) {
  if (type !== 'load' || !data?.window) return;
  try {
    const doc = data.window.document;
    // Open note button
    const openBtn = doc.getElementById("vb-open-note");
    if (openBtn) openBtn.addEventListener("command", () => _openVocabNote());
    // Word count
    const countSpan = doc.getElementById("vb-word-count");
    if (countSpan) countSpan.textContent = _ws.length + " words";
    // Quick add
    const input = doc.getElementById("vb-quick-input") as any;
    const addBtn = doc.getElementById("vb-quick-add") as any;
    if (addBtn && input) {
      const doAdd = () => {
        const w = input.value?.trim();
        if (!w) return;
        input.value = "";
        addWord(w, "", "").then(r => {
          if (r) { pwNotify("✅ Added: " + r.word); if (countSpan) countSpan.textContent = _ws.length + " words"; }
          else pwNotify("⏭ Duplicate");
        });
      };
      addBtn.addEventListener("command", doAdd);
      input.addEventListener("keydown", (e: any) => { if (e.key === "Enter") doAdd(); });
    }
    // API select
    const sel = doc.getElementById("vb-api-select") as any;
    if (sel) {
      sel.value = _apiName;
      sel.addEventListener("command", () => { _setAPI(sel.value); });
    }
    // Sync from note
    const syncBtn = doc.getElementById("vb-sync");
    if (syncBtn) syncBtn.addEventListener("command", () => { _syncFromNote(); if (countSpan) countSpan.textContent = _ws.length + " words"; });
  } catch(e) { Zotero.debug("VocabBuilder: prefs: " + e); }
}

function _openVocabNote() {
  if (_noteID) {
    try { (Zotero.Notes as any).open(_noteID, null, { openInWindow: false }); return; } catch(e) { Zotero.debug("VocabBuilder: openNote: " + e); }
  }
  try { pwNotify("No vocabulary yet. Add a word first."); } catch(e) {}
}

function _syncFromNote() {
  if (!_noteID) return;
  try {
    const note = Zotero.Items.get(_noteID);
    if (!note) return;
    const html = note.getNote();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const kept: string[] = [];
    doc.querySelectorAll('li b').forEach((b: any) => {
      const w = clean(b.textContent || '');
      if (w) kept.push(w);
    });
    const before = _ws.length;
    _ws = _ws.filter((w: any) => kept.includes(w.word));
    if (_ws.length < before) pwNotify("🗑 Removed " + (before - _ws.length) + " deletions");
    else pwNotify("✅ Note already in sync");
  } catch(e) {}
}

/* ========== Reader: Alt+A ========== */
function getReaderSelection(reader: any): string {
  try { const anno = (reader._internalReader as any)?._lastView?._selectionPopup?.annotation; if (anno?.text) return anno.text.trim(); } catch(e) {}
  try { const sel = reader._iframeWindow?.getSelection(); if (sel) { const t = sel.toString().trim(); if (t) return t; } } catch(e) {}
  try { const sel2 = (reader._internalReader as any)?._primaryView?._iframeWindow?.getSelection(); if (sel2) { const t = sel2.toString().trim(); if (t) return t; } } catch(e) {}
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
  try { const pw = new (Zotero as any).ProgressWindow({ closeOnClick: true }); pw.changeHeadline(msg); pw.show(); pw.startCloseTimer(3000); } catch(e) {}
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
      try { const w2 = (r._internalReader as any)?._primaryView?._iframeWindow; if (w2 && w2 !== w1) attachReaderKeys(w2, r); } catch(ex) {}
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

/* ========== Hooks ========== */
async function onStartup() {
  try {
    await Promise.all([Zotero.initializationPromise, Zotero.unlockPromise, Zotero.uiReadyPromise]);

    // Find or create note, load _ws from it
    try {
      const s = new Zotero.Search();
      s.addCondition("libraryID", "is", String(_userLibID()));
      s.addCondition("itemType", "is", "note");
      s.addCondition("tag", "is", "vocab-builder");
      const ids = await s.search();
      if (ids?.length) {
        _noteID = ids[0];
        const note = Zotero.Items.get(_noteID);
        if (note) {
          await note.reload();
          const html = note.getNote();
          const doc = new DOMParser().parseFromString(html, 'text/html');
          doc.querySelectorAll('li b').forEach((b: any) => {
            const w = clean(b.textContent || '');
            if (w) _ws.push({ id: Date.now().toString(36), word: w, def: "", pos: "", phone: "", trans: "", ctx: "", src: "", created: new Date().toISOString(), status: "completed", tries: 0 });
          });
        }
      }
    } catch(e) {}

    pollReaders();
    setInterval(pollReaders, 3000);

    for (const w of Zotero.getMainWindows()) { addMainWindowKeys(w); }

    registerNoteObserver();
    for (const w of Zotero.getMainWindows()) { try { (w as any).addEventListener("online", () => { setTimeout(_retryPending, 3000); }); } catch(e) {} }

    addon.data.initialized = true;
  } catch(e: any) {}
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow) { addMainWindowKeys(win as any); }

function onShutdown() {
  addon.data.alive = false;
  delete (Zotero as any)[config.addonInstance];
}

export default { onStartup, onShutdown, onMainWindowLoad, onMainWindowUnload: function(){}, onNotify: function(){}, onPrefsEvent, onShortcuts: function(){} };
