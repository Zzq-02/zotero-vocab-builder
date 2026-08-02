import { getPref } from "./utils/prefs";

/**
 * 翻译结果缓存（离线词库）。
 *
 * 缓存文件默认位于 <profile>/plugins/vocab-builder/translation-cache.json，
 * 可通过设置项 translationCachePath 自定义路径：
 * - 填绝对路径（含路径分隔符）时直接使用该文件；
 * - 填纯文件名时视为默认目录下的文件名；
 * - 留空使用默认位置。
 */

export interface TranslationResult {
  trans: string;
  def: string;
  pos: string;
  phone: string;
}

const PLUGIN_DIR_NAME = "vocab-builder";
const DEFAULT_CACHE_FILE_NAME = "translation-cache.json";

const cache: Map<string, TranslationResult> = new Map();
let loaded = false;
let loadPromise: Promise<Map<string, TranslationResult>> | null = null;
let writeChain: Promise<void> = Promise.resolve();
let generation = 0;

export function getTranslationCachePath(): string | null {
  const configured = String(getPref("translationCachePath") || "").trim();
  if (configured) {
    const isAbsolute =
      typeof PathUtils.isAbsolute === "function" &&
      PathUtils.isAbsolute(configured);
    if (isAbsolute) return configured;
    const defaultDir = getCacheDirPath();
    return defaultDir ? PathUtils.join(defaultDir, configured) : null;
  }

  const defaultDir = getCacheDirPath();
  return defaultDir
    ? PathUtils.join(defaultDir, DEFAULT_CACHE_FILE_NAME)
    : null;
}

function getCacheDirPath(): string | null {
  const profileDir = getProfileDir();
  return profileDir
    ? PathUtils.join(profileDir, "plugins", PLUGIN_DIR_NAME)
    : null;
}

function getProfileDir(): string {
  try {
    const profileDir = (Zotero as any).ProfileDirectory;
    if (profileDir) {
      return typeof profileDir === "string" ? profileDir : profileDir.path;
    }
  } catch (e) {
    // 回退到 nsIProperties
  }

  try {
    return (
      (Components as any).classes["@mozilla.org/file/directory_service;1"]
        .getService(Components.interfaces.nsIProperties)
        .get("ProfD", Components.interfaces.nsIFile) as any
    ).path;
  } catch (e) {
    return "";
  }
}

async function readCacheFromDisk(): Promise<Map<string, TranslationResult>> {
  const path = getTranslationCachePath();
  if (!path) return new Map();

  try {
    if (!(await IOUtils.exists(path))) return new Map();
    const raw = JSON.parse(await IOUtils.readUTF8(path));
    const result = new Map<string, TranslationResult>();
    for (const [word, value] of Object.entries(raw || {})) {
      if (!word || !value || typeof value !== "object") continue;
      const entry = value as Partial<TranslationResult>;
      result.set(word.toLowerCase(), {
        trans: String(entry.trans || ""),
        def: String(entry.def || ""),
        pos: String(entry.pos || ""),
        phone: String(entry.phone || ""),
      });
    }
    return result;
  } catch (e) {
    // 缓存损坏时按空缓存处理
    return new Map();
  }
}

async function ensureLoaded(): Promise<Map<string, TranslationResult>> {
  if (loaded) return cache;
  const myGeneration = generation;
  if (!loadPromise) {
    loadPromise = readCacheFromDisk().then((entries) => {
      if (myGeneration !== generation) return cache; // 期间被清空，丢弃旧数据
      cache.clear();
      for (const [word, entry] of entries) cache.set(word, entry);
      loaded = true;
      return cache;
    });
  }
  return loadPromise;
}

/** 查询翻译缓存；命中且至少有一项内容时返回结果，否则返回 null */
export async function lookupTranslation(
  word: string,
): Promise<TranslationResult | null> {
  const cleaned = word.trim().toLowerCase();
  if (!cleaned) return null;

  const entries = await ensureLoaded();
  const hit = entries.get(cleaned);
  if (!hit) return null;
  if (!hit.trans && !hit.def) return null;
  return { ...hit };
}

/** 写入翻译缓存（先等待磁盘加载完成，再更新内存并串行落盘，避免并发覆盖） */
export function storeTranslation(
  word: string,
  result: TranslationResult,
): Promise<void> {
  const cleaned = word.trim().toLowerCase();
  if (!cleaned || (!result.trans && !result.def)) {
    return Promise.resolve();
  }

  writeChain = writeChain
    .then(async () => {
      await ensureLoaded();
      cache.set(cleaned, {
        trans: result.trans || "",
        def: result.def || "",
        pos: result.pos || "",
        phone: result.phone || "",
      });
      await writeCacheToDisk();
    })
    .catch(() => {});
  return writeChain;
}

async function writeCacheToDisk(): Promise<void> {
  const path = getTranslationCachePath();
  if (!path) return;

  const parent = PathUtils.parent(path);
  const dir = parent || ".";
  await IOUtils.makeDirectory(dir, { ignoreExisting: true });
  await IOUtils.writeUTF8(
    path,
    JSON.stringify(Object.fromEntries(cache), null, 2),
  );
}

/** 清空缓存（内存与磁盘），测试或设置项使用 */
export async function clearTranslationCache(): Promise<void> {
  generation++;
  cache.clear();
  loaded = true;
  loadPromise = null;
  const path = getTranslationCachePath();
  if (!path) return;
  try {
    if (await IOUtils.exists(path)) {
      await IOUtils.remove(path);
    }
  } catch (e) {
    // 删除失败不影响功能，忽略
  }
}
