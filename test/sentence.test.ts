import { assert } from "chai";
import { extractSentenceAt } from "../src/utils/sentence.js";

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
});
