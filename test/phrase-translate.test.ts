import { assert } from "chai";
import {
  parseMyMemory,
  parseYoudaoFanyi,
  parseYoudaoJsonapi,
} from "../src/phrase-translate.js";

describe("phrase-translate", function () {
  describe("parseYoudaoJsonapi", function () {
    it("extracts translation, phonetic and example", function () {
      const payload = {
        ec: {
          word: [
            {
              usphone: "ˈhaɪ skuːl",
              trs: [{ tr: [{ l: { i: ["高中"] } }] }],
            },
          ],
        },
        blng_sents_part: {
          "sentence-pair": [
            {
              sentence: "She goes to high school.",
              "sentence-translation": "她上高中。",
            },
          ],
        },
      };
      const result = parseYoudaoJsonapi(payload);
      assert.equal(result.trans, "高中");
      assert.equal(result.phone, "ˈhaɪ skuːl");
      assert.equal(result.example, "She goes to high school.");
    });

    it("falls back to phrs entries when ec is missing", function () {
      const payload = {
        phrs: {
          phrase: [
            {
              trs: [{ tr: [{ l: { i: ["艺术"] } }] }],
            },
          ],
        },
      };
      assert.equal(parseYoudaoJsonapi(payload).trans, "艺术");
    });

    it("joins multiple meanings", function () {
      const payload = {
        ec: {
          word: [
            {
              trs: [
                { tr: [{ l: { i: ["高中"] } }] },
                { tr: [{ l: { i: ["中学"] } }] },
              ],
            },
          ],
        },
      };
      assert.equal(parseYoudaoJsonapi(payload).trans, "高中；中学");
    });

    it("returns empty fields for malformed payloads", function () {
      const result = parseYoudaoJsonapi(null);
      assert.equal(result.trans, "");
      assert.equal(result.def, "");
      assert.equal(result.phone, "");
      assert.equal(result.example, "");
      assert.equal(parseYoudaoJsonapi({}).trans, "");
    });
  });

  describe("parseYoudaoFanyi", function () {
    it("concatenates the translated segments", function () {
      const payload = {
        translateResult: [[{ tgt: "高中" }, { tgt: "" }]],
      };
      assert.equal(parseYoudaoFanyi(payload), "高中");
    });

    it("returns empty string on malformed payloads", function () {
      assert.equal(parseYoudaoFanyi(null), "");
      assert.equal(parseYoudaoFanyi({}), "");
    });
  });

  describe("parseMyMemory", function () {
    it("returns the translated text", function () {
      const payload = {
        responseStatus: 200,
        responseData: { translatedText: "高中" },
      };
      assert.equal(parseMyMemory(payload), "高中");
    });

    it("rejects non-200 responses", function () {
      const payload = {
        responseStatus: 403,
        responseData: { translatedText: "QUERY LENGTH LIMIT EXCEEDED" },
      };
      assert.equal(parseMyMemory(payload), "");
    });

    it("rejects quota warnings", function () {
      const payload = {
        responseStatus: 200,
        responseData: { translatedText: "INVALID QUERY LENGTH" },
      };
      assert.equal(parseMyMemory(payload), "");
    });
  });
});
