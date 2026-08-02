import { assert } from "chai";
import { buildLocalContext, extractSentenceAt } from "../src/utils/sentence.js";

describe("sentence", function () {
  describe("extractSentenceAt", function () {
    it("extracts the full sentence around the index", function () {
      const text = "The quick brown fox jumps over the lazy dog.";
      assert.equal(extractSentenceAt(text, 10), text);
    });

    it("extracts the middle sentence of several", function () {
      const text = "Hello world. This is a test. Bye now.";
      // index 指向 "is" 中的 'i'
      const index = text.indexOf("is");
      assert.equal(extractSentenceAt(text, index), "This is a test.");
    });

    it("extracts the first sentence", function () {
      const text = "First sentence here. Second one.";
      assert.equal(extractSentenceAt(text, 0), "First sentence here.");
    });

    it("extracts the last sentence", function () {
      const text = "First one. Second sentence here.";
      const index = text.indexOf("Second");
      assert.equal(extractSentenceAt(text, index), "Second sentence here.");
    });

    it("keeps abbreviations inside the sentence", function () {
      const text = "Dr. Smith said hello. He left.";
      const index = text.indexOf("Smith");
      assert.equal(extractSentenceAt(text, index), "Dr. Smith said hello.");
    });

    it("does not split on abbreviation dots in the middle", function () {
      const text = "See Fig. 3 for details. It matters.";
      const index = text.indexOf("3");
      assert.equal(extractSentenceAt(text, index), "See Fig. 3 for details.");
    });

    it("keeps dotted abbreviations like e.g. inside the sentence", function () {
      const text = "This is e.g. a test. Another one.";
      const index = text.indexOf("test");
      assert.equal(extractSentenceAt(text, index), "This is e.g. a test.");
    });

    it("keeps dotted abbreviations like U.S. inside the sentence", function () {
      const text = "It works in the U.S. market. Sure.";
      const index = text.indexOf("market");
      assert.equal(
        extractSentenceAt(text, index),
        "It works in the U.S. market.",
      );
    });

    it("does not treat plain us. or am. as abbreviations", function () {
      const text = "He helped us. We thanked him.";
      const index = text.indexOf("We");
      assert.equal(extractSentenceAt(text, index), "We thanked him.");
    });

    it("handles question marks and exclamation marks", function () {
      const text = "Really? Yes! That is true.";
      const index = text.indexOf("Yes");
      assert.equal(extractSentenceAt(text, index), "Yes!");
    });

    it("handles Chinese punctuation", function () {
      const text = "这是第一句。这是第二句！第三句？";
      const index = text.indexOf("第二");
      assert.equal(extractSentenceAt(text, index), "这是第二句！");
    });

    it("handles newline-separated sentences", function () {
      const text = "Line one.\nLine two.\nLine three.";
      const index = text.indexOf("two");
      assert.equal(extractSentenceAt(text, index), "Line two.");
    });

    it("returns trimmed empty for empty input", function () {
      assert.equal(extractSentenceAt("", 0), "");
    });

    it("returns the whole text when index is out of range", function () {
      assert.equal(
        extractSentenceAt("A single sentence.", 999),
        "A single sentence.",
      );
    });
  });

  describe("buildLocalContext", function () {
    it("collects siblings up to the sentence boundary", function () {
      const siblings = ["Hello.", "This", "is", "a", "test.", "Bye", "now."];
      const built = buildLocalContext(siblings, 2, 0);
      assert.isNotNull(built);
      assert.equal(built.text, "Hello. This is a test.");
      // 锚点 "is" 前的文本 "Hello. This " 长度 12
      assert.equal(built.offset, 12);
      assert.equal(
        extractSentenceAt(built.text, built.offset),
        "This is a test.",
      );
    });

    it("collects all siblings when the sentence spans the whole array", function () {
      const siblings = ["The", "quick", "brown", "fox", "jumps."];
      const built = buildLocalContext(siblings, 3, 0);
      assert.isNotNull(built);
      assert.equal(built.text, "The quick brown fox jumps.");
      assert.equal(built.offset, 16); // "The "(4) + "quick "(6) + "brown "(6)
      assert.equal(
        extractSentenceAt(built.text, built.offset),
        "The quick brown fox jumps.",
      );
    });

    it("stops at block boundaries", function () {
      const siblings = ["prev.", "mid", "next.", "tail"];
      const built = buildLocalContext(siblings, 1, 0, {
        blockFlags: [false, false, false, true],
      });
      assert.isNotNull(built);
      assert.equal(built.text, "prev. mid next.");
      // 锚点前的 "prev. " 长度 6
      assert.equal(built.offset, 6);
    });

    it("does not collect past the max sibling count", function () {
      const siblings = Array.from({ length: 200 }, (_, i) => `w${i}`);
      const built = buildLocalContext(siblings, 100, 0, { max: 10 });
      assert.isNotNull(built);
      assert.equal(built.text.split(" ").length, 21); // 前10 + 锚点 + 后10
    });

    it("returns null for an invalid anchor index", function () {
      assert.isNull(buildLocalContext(["a", "b"], 5, 0));
      assert.isNull(buildLocalContext([], 0, 0));
    });
  });
});
