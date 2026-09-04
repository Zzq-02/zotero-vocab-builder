/**
 * 快捷键解析、匹配与格式化工具。
 *
 * 存储格式：小写、以 "+" 连接的修饰键与主键，例如 "alt+a"、"ctrl+shift+b"。
 * 修饰键顺序固定为 ctrl、alt、shift、meta，主键为最后一个 token。
 */

export const DEFAULT_QUICK_ADD_SHORTCUT = "alt+a";
export const DEFAULT_RETRY_SHORTCUT = "alt+r";

export interface ShortcutParts {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  key: string;
}

const MODIFIER_KEYS = new Set(["ctrl", "control", "alt", "shift", "meta"]);

/** 允许作为主键的键名（除单个字符外） */
const NAMED_KEYS = new Set([
  "f1",
  "f2",
  "f3",
  "f4",
  "f5",
  "f6",
  "f7",
  "f8",
  "f9",
  "f10",
  "f11",
  "f12",
  "space",
  "tab",
  "enter",
  "backspace",
  "delete",
  "home",
  "end",
  "pageup",
  "pagedown",
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
  "insert",
]);

/** 解析 "ctrl+alt+shift+meta+key" 形式的字符串，非法时返回 null */
export function parseShortcut(value: string): ShortcutParts | null {
  if (typeof value !== "string") return null;

  const tokens = value
    .trim()
    .toLowerCase()
    .split("+")
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length < 2) return null;

  const parts: ShortcutParts = {
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
    key: "",
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (i === tokens.length - 1) {
      parts.key = token;
      continue;
    }
    if (token === "ctrl" || token === "control") parts.ctrl = true;
    else if (token === "alt") parts.alt = true;
    else if (token === "shift") parts.shift = true;
    else if (token === "meta") parts.meta = true;
    else return null; // 未知修饰键
  }

  if (!parts.key) return null;
  return parts;
}

function isNamedKey(key: string): boolean {
  return NAMED_KEYS.has(key);
}

function isPrintableKey(key: string): boolean {
  return /^[a-z0-9]$/.test(key);
}

function isValidKey(key: string): boolean {
  return isPrintableKey(key) || isNamedKey(key);
}

/**
 * 校验快捷键是否可用：
 * - 至少包含一个 Ctrl/Alt/Meta 修饰键（防止拦截普通打字）
 * - 主键为字母、数字或常见功能键
 */
export function isValidShortcut(value: string): boolean {
  const parts = parseShortcut(value);
  if (!parts) return false;
  if (!(parts.ctrl || parts.alt || parts.meta)) return false;
  return isValidKey(parts.key);
}

/** 从键盘事件生成存储格式字符串；纯修饰键按下时返回 null */
export function shortcutFromEvent(
  e: Pick<KeyboardEvent, "ctrlKey" | "altKey" | "shiftKey" | "metaKey" | "key">,
): string | null {
  const key = String(e.key || "").toLowerCase();
  if (key === " ") return null; // 单独空格不参与录制
  if (MODIFIER_KEYS.has(key)) return null; // 单独按下修饰键
  if (!isValidKey(key)) return null;
  if (!(e.ctrlKey || e.altKey || e.metaKey)) return null;

  const tokens: string[] = [];
  if (e.ctrlKey) tokens.push("ctrl");
  if (e.altKey) tokens.push("alt");
  if (e.shiftKey) tokens.push("shift");
  if (e.metaKey) tokens.push("meta");
  tokens.push(key);
  return tokens.join("+");
}

/** 判断键盘事件是否匹配存储格式的快捷键 */
export function matchesShortcut(
  e: Pick<
    KeyboardEvent,
    "ctrlKey" | "altKey" | "shiftKey" | "metaKey" | "key" | "isComposing"
  >,
  value: string,
): boolean {
  const parts = parseShortcut(value);
  if (!parts) return false;
  if (e.isComposing) return false;
  if (String(e.key || "").toLowerCase() !== parts.key) return false;
  if (!!e.ctrlKey !== parts.ctrl) return false;
  if (!!e.altKey !== parts.alt) return false;
  if (!!e.shiftKey !== parts.shift) return false;
  if (!!e.metaKey !== parts.meta) return false;
  return true;
}

/** 生成人类可读标签，如 "Alt+A"、"Ctrl+Shift+B" */
export function formatShortcutLabel(value: string): string {
  const parts = parseShortcut(value);
  if (!parts) return value || "";

  const tokens: string[] = [];
  if (parts.ctrl) tokens.push("Ctrl");
  if (parts.alt) tokens.push("Alt");
  if (parts.shift) tokens.push("Shift");
  if (parts.meta) tokens.push("Meta");

  const key =
    parts.key === "space"
      ? "Space"
      : parts.key === "tab"
        ? "Tab"
        : parts.key.length === 1
          ? parts.key.toUpperCase()
          : parts.key.charAt(0).toUpperCase() + parts.key.slice(1);

  tokens.push(key);
  return tokens.join("+");
}
