import { config } from "../package.json";

export type NotificationTone = "success" | "error" | "info";

const PLUGIN_ICON_URI = `chrome://${config.addonRef}/content/icons/favicon@0.5x.png`;
const SUCCESS_ICON_URI = "chrome://zotero/skin/tick.png";
const ERROR_ICON_URI = "chrome://zotero/skin/cross.png";

const PALETTES: Record<
  NotificationTone,
  {
    background: string;
    border: string;
    text: string;
    shadow: string;
  }
> = {
  success: {
    background: "linear-gradient(90deg, #e8f8ee 0%, #f6fcf8 100%)",
    border: "#89d0a3",
    text: "#175b35",
    shadow: "0 8px 20px rgba(39, 148, 88, 0.18)",
  },
  error: {
    background: "linear-gradient(90deg, #fff0f0 0%, #fff8f8 100%)",
    border: "#efb6b6",
    text: "#8f2626",
    shadow: "0 8px 20px rgba(196, 72, 72, 0.14)",
  },
  info: {
    background: "linear-gradient(90deg, #ecf8f0 0%, #f7fcf8 100%)",
    border: "#aad8b8",
    text: "#1d5d46",
    shadow: "0 8px 20px rgba(33, 110, 76, 0.12)",
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
  if (!row?.style || !text?.style) return false;

  const palette = PALETTES[tone];
  row.style.background = palette.background;
  row.style.border = `1px solid ${palette.border}`;
  row.style.borderRadius = "10px";
  row.style.padding = "6px 10px";
  row.style.margin = "8px 0 0 0";
  row.style.minHeight = "30px";
  row.style.boxShadow = palette.shadow;

  text.style.color = palette.text;
  text.style.fontWeight = "600";
  text.style.lineHeight = "1.45";

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
    const pw = new (Zotero as any).ProgressWindow({ closeOnClick: true });
    pw.changeHeadline(config.addonName);
    pw.show();

    const line = new pw.ItemProgress(resolveIcon(tone), message);
    if (tone === "error") {
      line.setError();
    } else {
      line.setProgress(100);
    }

    queueLineStyles(line, tone);
    pw.startCloseTimer(tone === "error" ? 4200 : 3200);
  } catch (e) {}
}
