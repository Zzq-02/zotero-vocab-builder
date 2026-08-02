import { assert } from "chai";
import {
  DEFAULT_QUICK_ADD_SHORTCUT,
  formatShortcutLabel,
  isValidShortcut,
  matchesShortcut,
  parseShortcut,
  shortcutFromEvent,
} from "../src/utils/shortcut.js";

function fakeEvent(partial: {
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
  key: string;
  isComposing?: boolean;
}) {
  return {
    ctrlKey: partial.ctrlKey ?? false,
    altKey: partial.altKey ?? false,
    shiftKey: partial.shiftKey ?? false,
    metaKey: partial.metaKey ?? false,
    key: partial.key,
    isComposing: partial.isComposing ?? false,
  };
}

describe("shortcut", function () {
  describe("parseShortcut", function () {
    it("parses a simple combination", function () {
      assert.deepEqual(parseShortcut("alt+a"), {
        ctrl: false,
        alt: true,
        shift: false,
        meta: false,
        key: "a",
      });
    });

    it("parses multiple modifiers and normalizes case", function () {
      assert.deepEqual(parseShortcut("Ctrl+Shift+B"), {
        ctrl: true,
        alt: false,
        shift: true,
        meta: false,
        key: "b",
      });
    });

    it("accepts meta and function keys", function () {
      assert.deepEqual(parseShortcut("meta+f5"), {
        ctrl: false,
        alt: false,
        shift: false,
        meta: true,
        key: "f5",
      });
    });

    it("rejects values without a modifier", function () {
      assert.isNull(parseShortcut("a"));
    });

    it("rejects single tokens and unknown modifiers", function () {
      assert.isNull(parseShortcut("ctrl"));
      assert.isNull(parseShortcut("foo+bar"));
      assert.isNull(parseShortcut(""));
    });
  });

  describe("isValidShortcut", function () {
    it("accepts combos with ctrl/alt/meta", function () {
      assert.isTrue(isValidShortcut("alt+a"));
      assert.isTrue(isValidShortcut("ctrl+shift+b"));
      assert.isTrue(isValidShortcut("meta+9"));
    });

    it("rejects shortcuts without a strong modifier", function () {
      assert.isFalse(isValidShortcut("a"));
      assert.isFalse(isValidShortcut("shift+a"));
    });

    it("rejects unsupported keys", function () {
      assert.isFalse(isValidShortcut("alt+"));
      assert.isFalse(isValidShortcut("alt+ф"));
      assert.isFalse(isValidShortcut("alt+escape"));
    });
  });

  describe("shortcutFromEvent", function () {
    it("records alt+a from an event", function () {
      assert.equal(shortcutFromEvent(fakeEvent({ altKey: true, key: "A" })), "alt+a");
    });

    it("records ctrl+shift+b", function () {
      assert.equal(
        shortcutFromEvent(fakeEvent({ ctrlKey: true, shiftKey: true, key: "b" })),
        "ctrl+shift+b",
      );
    });

    it("ignores modifier-only presses", function () {
      assert.isNull(shortcutFromEvent(fakeEvent({ ctrlKey: true, key: "Control" })));
      assert.isNull(shortcutFromEvent(fakeEvent({ altKey: true, key: "Alt" })));
    });

    it("ignores plain keys and spaces", function () {
      assert.isNull(shortcutFromEvent(fakeEvent({ key: "a" })));
      assert.isNull(shortcutFromEvent(fakeEvent({ altKey: true, key: " " })));
    });

    it("ignores escape", function () {
      assert.isNull(shortcutFromEvent(fakeEvent({ altKey: true, key: "Escape" })));
    });
  });

  describe("matchesShortcut", function () {
    it("matches the configured shortcut", function () {
      assert.isTrue(matchesShortcut(fakeEvent({ altKey: true, key: "a" }), "alt+a"));
      assert.isTrue(matchesShortcut(fakeEvent({ altKey: true, key: "A" }), "alt+a"));
      assert.isTrue(
        matchesShortcut(
          fakeEvent({ ctrlKey: true, shiftKey: true, key: "b" }),
          "ctrl+shift+b",
        ),
      );
    });

    it("does not match different keys or modifiers", function () {
      assert.isFalse(matchesShortcut(fakeEvent({ altKey: true, key: "b" }), "alt+a"));
      assert.isFalse(matchesShortcut(fakeEvent({ ctrlKey: true, key: "a" }), "alt+a"));
      assert.isFalse(matchesShortcut(fakeEvent({ altKey: true, key: "a" }), "alt+shift+a"));
    });

    it("respects composition state", function () {
      assert.isFalse(
        matchesShortcut(
          fakeEvent({ altKey: true, key: "a", isComposing: true }),
          "alt+a",
        ),
      );
    });

    it("returns false for invalid stored values", function () {
      assert.isFalse(matchesShortcut(fakeEvent({ altKey: true, key: "a" }), ""));
      assert.isFalse(matchesShortcut(fakeEvent({ altKey: true, key: "a" }), "bogus"));
    });
  });

  describe("formatShortcutLabel", function () {
    it("formats human-readable labels", function () {
      assert.equal(formatShortcutLabel("alt+a"), "Alt+A");
      assert.equal(formatShortcutLabel("ctrl+shift+b"), "Ctrl+Shift+B");
      assert.equal(formatShortcutLabel("alt+f5"), "Alt+F5");
      assert.equal(formatShortcutLabel("meta+space"), "Meta+Space");
    });

    it("falls back to the raw value", function () {
      assert.equal(formatShortcutLabel("bogus"), "bogus");
      assert.equal(formatShortcutLabel(""), "");
    });

    it("defaults to alt+a", function () {
      assert.equal(DEFAULT_QUICK_ADD_SHORTCUT, "alt+a");
      assert.equal(formatShortcutLabel(DEFAULT_QUICK_ADD_SHORTCUT), "Alt+A");
    });
  });
});
