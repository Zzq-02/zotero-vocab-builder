import { assert } from "chai";
import {
  buildCustomAPIUrl,
  extractCustomAPIFields,
  parseCustomAPIConfig,
} from "../src/custom-api.js";

describe("custom-api", function () {
  it("replaces both encoded and raw word placeholders", function () {
    const url = buildCustomAPIUrl(
      "https://example.com?q={word}&raw={wordRaw}",
      "ice cream",
    );

    assert.equal(url, "https://example.com?q=ice%20cream&raw=ice cream");
  });

  it("parses custom headers and trims field paths", function () {
    const config = parseCustomAPIConfig({
      url: " https://example.com?q={word} ",
      headers: '{"Authorization":"Bearer token","X-Test":"1"}',
      transPath: " data.translation ",
      defPath: " data.definition ",
      posPath: " data.pos ",
      phonePath: " data.phone ",
      examplePath: " data.example ",
    });

    assert.equal(config.url, "https://example.com?q={word}");
    assert.deepEqual(config.headers, {
      Authorization: "Bearer token",
      "X-Test": "1",
    });
    assert.equal(config.transPath, "data.translation");
    assert.equal(config.examplePath, "data.example");
  });

  it("extracts values from nested JSON paths", function () {
    const fields = extractCustomAPIFields(
      {
        data: {
          translation: ["frost", "freeze"],
          entries: [
            {
              definition: "frozen water",
              pos: "noun",
              phone: "ais",
            },
          ],
        },
      },
      {
        transPath: "data.translation",
        defPath: "data.entries[0].definition",
        posPath: "data.entries[0].pos",
        phonePath: "data.entries[0].phone",
      },
    );

    assert.equal(fields.trans, "frost; freeze");
    assert.equal(fields.def, "frozen water");
    assert.equal(fields.pos, "noun");
    assert.equal(fields.phone, "ais");
  });

  it("extracts the example sentence from a custom path", function () {
    const fields = extractCustomAPIFields(
      {
        data: {
          translation: "ice",
          example: "Ice melts in the sun.",
        },
      },
      {
        transPath: "data.translation",
        defPath: "",
        posPath: "",
        phonePath: "",
        examplePath: "data.example",
      },
    );

    assert.equal(fields.trans, "ice");
    assert.equal(fields.example, "Ice melts in the sun.");
  });

  it("returns an empty example when the path is missing", function () {
    const fields = extractCustomAPIFields(
      { data: { translation: "ice" } },
      {
        transPath: "data.translation",
        defPath: "",
        posPath: "",
        phonePath: "",
        examplePath: "data.example",
      },
    );

    assert.equal(fields.example, "");
  });
});
