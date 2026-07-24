import { assert } from "chai";
import { buildExportBundle } from "../src/exporters.js";
import { createVocabEntry } from "../src/note-state.js";

describe("exporters", function () {
  it("builds completed-only anki export", function () {
    const pending = createVocabEntry("alpha", {
      status: "pending",
      ctx: "pending context",
    });
    const completed = createVocabEntry("beta", {
      status: "completed",
      trans: "beta translation",
      def: "beta definition",
      ctx: "beta context",
      pos: "noun",
    });

    const bundle = buildExportBundle(
      "anki",
      "completed",
      [pending, completed],
      new Date("2026-07-23T00:00:00.000Z"),
    );

    assert.equal(bundle.extension, "txt");
    assert.equal(bundle.defaultFileName, "vocabulary-anki-20260723.txt");
    assert.notInclude(bundle.content, "alpha");
    assert.include(bundle.content, "beta");
    assert.include(bundle.content, "beta translation");
    assert.include(bundle.content, "vocab-builder");
  });

  it("builds quizlet export as two-column text", function () {
    const entry = createVocabEntry("gamma", {
      status: "completed",
      trans: "gamma translation",
      def: "gamma definition",
      phone: "ga-ma",
      ctx: "gamma context",
    });

    const bundle = buildExportBundle("quizlet", "all", [entry]);

    assert.equal(bundle.extension, "txt");
    assert.include(bundle.content, "gamma");
    assert.include(bundle.content, "gamma translation");
    assert.include(bundle.content, "Context: gamma context");
  });

  it("builds universal csv export with header row", function () {
    const entry = createVocabEntry("delta", {
      status: "failed",
      trans: "delta translation",
      tries: 2,
    });

    const bundle = buildExportBundle(
      "csv",
      "all",
      [entry],
      new Date("2026-07-23T00:00:00.000Z"),
    );

    assert.equal(bundle.extension, "csv");
    assert.equal(bundle.defaultFileName, "vocabulary-export-20260723.csv");
    assert.match(bundle.content, /^word,translation,definition,/);
    assert.include(bundle.content, "delta");
    assert.include(bundle.content, "failed");
  });
});
