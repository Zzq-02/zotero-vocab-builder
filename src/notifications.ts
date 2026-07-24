import { config } from "../package.json";

export type NotificationTone = "success" | "error" | "info";

const PLUGIN_ICON_URI = `chrome://${config.addonRef}/content/icons/favicon@0.5x.png`;
const SUCCESS_ICON_URI = "chrome://zotero/skin/tick.png";
const ERROR_ICON_URI = "chrome://zotero/skin/cross.png";

const PALETTES: Record<
  NotificationTone,
  {
    background: string;
    text: string;
  }
> = {
  success: {
    background: "#e7f7ec",
    text: "#185b36",
  },
  error: {
    background: "#fbeaea",
    text: "#8a2323",
  },
  info: {
    background: "#edf7f1",
    text: "#215a45",
  },
};

function timerHost(): any {
  try {
    return (Zotero as any).getMainWindow?.() || globalThis;
  } catch (e) {
    return globalThis;
  }
}

function defer(callback: () => void, ms: number) {
  const host = timerHost();
  if (typeof host?.setTimeout === "function") {
    host.setTimeout(callback, ms);
  }
}

function resolveIcon(tone: NotificationTone): string {
  if (tone === "success") return SUCCESS_ICON_URI;
  if (tone === "error") return ERROR_ICON_URI;
  return PLUGIN_ICON_URI;
}

function applyLineStyles(line: any, tone: NotificationTone): boolean {
  const row = line?._hbox;
  const text = line?._itemText;
  const image = line?._image;
  const doc = row?.ownerDocument as Document | undefined;
  if (!row?.style || !text?.style || !doc) return false;

  const palette = PALETTES[tone];
  const root = doc.documentElement as HTMLElement | null;
  if (root?.style) {
    root.style.background = palette.background;
  }
  const body = doc.body as HTMLBodyElement | null;
  if (body?.style) {
    body.style.background = palette.background;
    body.style.margin = "0";
    body.style.padding = "8px 12px";
  }

  row.style.background = "transparent";
  row.style.border = "none";
  row.style.borderRadius = "0";
  row.style.padding = "0";
  row.style.margin = "0";
  row.style.minHeight = "auto";
  row.style.height = "auto";
  row.style.width = "auto";
  row.style.maxWidth = "none";
  row.style.alignItems = "center";
  row.style.boxShadow = "none";

  text.style.color = palette.text;
  text.style.fontWeight = "600";
  text.style.lineHeight = "1.45";
  text.style.whiteSpace = "normal";
  text.style.wordBreak = "break-word";
  text.style.overflow = "visible";
  text.style.maxWidth = "none";

  const parent = row.parentElement as HTMLElement | null;
  if (parent?.style) {
    parent.style.width = "auto";
    parent.style.background = "transparent";
  }

  if (image?.style) {
    image.style.width = "18px";
    image.style.height = "18px";
    image.style.marginInlineEnd = "8px";
  }

  return true;
}

function queueLineStyles(line: any, tone: NotificationTone, attempts = 12) {
  const tryApply = (remaining: number) => {
    if (applyLineStyles(line, tone) || remaining <= 0) return;
    defer(() => tryApply(remaining - 1), 40);
  };

  defer(() => tryApply(attempts), 0);
}

export function showNotification(
  message: string,
  tone: NotificationTone = "info",
) {
  try {
    const fullMessage = message.replace(/\s+/g, " ").trim();
    const pw = new (Zotero as any).ProgressWindow({ closeOnClick: true });
    pw.show();

    const line = new pw.ItemProgress(resolveIcon(tone), fullMessage);
    (pw as any).progress = line;
    if (tone === "error") {
      line.setError();
    } else {
      line.setProgress(100);
    }

    queueLineStyles(line, tone);
    pw.startCloseTimer(tone === "error" ? 4200 : 3200);
  } catch (e) {}
}
