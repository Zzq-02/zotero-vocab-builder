import { assert } from "chai";
import {
  buildEntriesFromNoteEntries,
  createVocabEntry,
  extractMutableEntries,
  mergeNoteEntries,
  parseNoteHTML,
  renderNoteHTML,
} from "../src/note-state.js";

describe("note-state", function () {
  it("preserves legacy note rows when new words are merged in", function () {
    const legacyHtml = [
      `<div class="zotero-note znv1">`,
      `<h1>Vocabulary List</h1>`,
      `<ul><li>legacy <b>alpha</b> row</li></ul>`,
      `</div>`,
    ].join("");

    const noteEntries = parseNoteHTML(legacyHtml);
    const sessionEntry = createVocabEntry("beta", {
      status: "pending",
      ctx: "beta context",
    });

    const merged = mergeNoteEntries(noteEntries, [sessionEntry]);
    const rendered = renderNoteHTML(
      merged,
      new Date("2026-07-23T00:00:00.000Z"),
      "en-US",
    );

    assert.include(rendered, "legacy <b>alpha</b> row");
    assert.include(rendered, `data-vb-word="beta"`);
    assert.include(rendered, "Total: 2 words");
  });

  it("reads legacy words wrapped in strong tags", function () {
    const legacyHtml = [
      `<div class="zotero-note znv1">`,
      `<h1>Vocabulary List</h1>`,
      `<ul><li>legacy <strong>theta</strong> row</li></ul>`,
      `</div>`,
    ].join("");

    const parsed = parseNoteHTML(legacyHtml);

    assert.lengthOf(parsed, 1);
    assert.equal(parsed[0].word, "theta");
  });

  it("re-hydrates structured entries from rendered note html", function () {
    const entry = createVocabEntry("gamma", {
      status: "failed",
      tries: 2,
      trans: "gamma translation",
      def: "gamma definition",
      pos: "noun",
      phone: "ga-ma",
      ctx: "gamma context",
    });

    const html = renderNoteHTML(
      [{ word: entry.word, entry }],
      new Date("2026-07-23T00:00:00.000Z"),
    );
    const parsed = parseNoteHTML(html);

    assert.lengthOf(parsed, 1);
    assert.equal(parsed[0].entry?.word, "gamma");
    assert.equal(parsed[0].entry?.status, "failed");
    assert.equal(parsed[0].entry?.tries, 2);
    assert.equal(parsed[0].entry?.trans, "gamma translation");
    assert.equal(parsed[0].entry?.ctx, "gamma context");
  });

  it("only keeps unresolved structured entries for in-memory retry state", function () {
    const pending = createVocabEntry("delta", {
      status: "pending",
      tries: 1,
    });
    const completed = createVocabEntry("epsilon", {
      status: "completed",
      trans: "done",
    });

    const html = renderNoteHTML(
      [
        { word: pending.word, entry: pending },
        { word: completed.word, entry: completed },
      ],
      new Date("2026-07-23T00:00:00.000Z"),
    );

    const mutable = extractMutableEntries(parseNoteHTML(html));

    assert.deepEqual(
      mutable.map((item) => item.word),
      ["delta"],
    );
    assert.equal(mutable[0].tries, 1);
    assert.equal(mutable[0].status, "pending");
  });

  it("renders status icons as symbols instead of OK/ERR text", function () {
    const completed = createVocabEntry("zeta", {
      status: "completed",
      trans: "done",
    });
    const failed = createVocabEntry("eta", {
      status: "failed",
      tries: 1,
    });

    const html = renderNoteHTML(
      [
        { word: completed.word, entry: completed },
        { word: failed.word, entry: failed },
      ],
      new Date("2026-07-23T00:00:00.000Z"),
    );

    assert.include(html, "vb-status-success");
    assert.include(html, "vb-status-failed");
    assert.notInclude(html, "[OK]");
    assert.notInclude(html, "[ERR]");
  });

  it("rebuilds local state entries from note content", function () {
    const structured = createVocabEntry("lambda", {
      status: "failed",
      tries: 2,
      trans: "lambda translation",
    });
    const html = [
      `<div class="zotero-note znv1">`,
      `<h1>Vocabulary List</h1>`,
      `<ul>`,
      renderNoteHTML([{ word: structured.word, entry: structured }]).match(
        /<li\b[^>]*>[\s\S]*?<\/li>/,
      )?.[0] || "",
      `<li>legacy <strong>sigma</strong> row</li>`,
      `</ul>`,
      `</div>`,
    ].join("");

    const rebuilt = buildEntriesFromNoteEntries(parseNoteHTML(html));

    assert.lengthOf(rebuilt, 2);
    assert.equal(rebuilt[0].word, "lambda");
    assert.equal(rebuilt[0].status, "failed");
    assert.equal(rebuilt[1].word, "sigma");
    assert.equal(rebuilt[1].status, "completed");
  });
});
