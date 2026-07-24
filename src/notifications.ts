import { config } from "../package.json";

export type NotificationTone = "success" | "error" | "info";

const PLUGIN_ICON_URI = `chrome://${config.addonRef}/content/icons/favicon@0.5x.png`;
const SUCCESS_ICON_URI = "chrome://zotero/skin/tick.png";
const ERROR_ICON_URI = "chrome://zotero/skin/cross.png";

function resolveIcon(tone: NotificationTone): string {
  if (tone === "success") return SUCCESS_ICON_URI;
  if (tone === "error") return ERROR_ICON_URI;
  return PLUGIN_ICON_URI;
}

function resolvePrefix(tone: NotificationTone): string {
  if (tone === "success") return "\u2705 ";
  if (tone === "error") return "\u274C ";
  return "";
}

function showNativeAlert(
  title: string,
  text: string,
  icon: string,
): boolean {
  try {
    const alerts = (Components as any).classes[
      "@mozilla.org/alerts-service;1"
    ]?.getService((Components as any).interfaces.nsIAlertsService);
    if (!alerts?.showAlertNotification) return false;
    alerts.showAlertNotification(
      icon,
      title,
      text,
      false,
      "",
      null,
      config.addonRef,
    );
    return true;
  } catch (e) {
    return false;
  }
}

export function showNotification(
  message: string,
  tone: NotificationTone = "info",
) {
  try {
    const fullMessage = `${resolvePrefix(tone)}${message.replace(/\s+/g, " ").trim()}`;
    const icon = resolveIcon(tone);
    if (showNativeAlert(config.addonName, fullMessage, icon)) {
      return;
    }

    const pw = new (Zotero as any).ProgressWindow({ closeOnClick: true });
    pw.show();

    const line = new pw.ItemProgress(icon, fullMessage);
    (pw as any).progress = line;
    if (tone === "error") {
      line.setError();
    } else {
      line.setProgress(100);
    }

    pw.startCloseTimer(tone === "error" ? 4200 : 3200);
  } catch (e) {}
}
