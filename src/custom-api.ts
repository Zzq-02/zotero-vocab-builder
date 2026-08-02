export interface CustomAPIConfig {
  url: string;
  headers: string;
  transPath: string;
  defPath: string;
  posPath: string;
  phonePath: string;
  examplePath: string;
}

export interface CustomAPIParsedConfig {
  url: string;
  headers: Record<string, string>;
  transPath: string;
  defPath: string;
  posPath: string;
  phonePath: string;
  examplePath: string;
}

export function parseCustomAPIConfig(
  config: CustomAPIConfig,
): CustomAPIParsedConfig {
  return {
    url: (config.url || "").trim(),
    headers: parseHeaders(config.headers || "{}"),
    transPath: (config.transPath || "").trim(),
    defPath: (config.defPath || "").trim(),
    posPath: (config.posPath || "").trim(),
    phonePath: (config.phonePath || "").trim(),
    examplePath: (config.examplePath || "").trim(),
  };
}

export function buildCustomAPIUrl(template: string, word: string): string {
  const encodedWord = encodeURIComponent(word);
  return template
    .replaceAll("{word}", encodedWord)
    .replaceAll("{wordRaw}", word);
}

export function extractCustomAPIFields(
  payload: unknown,
  config: Pick<
    CustomAPIParsedConfig,
    "transPath" | "defPath" | "posPath" | "phonePath" | "examplePath"
  >,
) {
  return {
    trans: stringifyPathValue(readPath(payload, config.transPath)),
    def: stringifyPathValue(readPath(payload, config.defPath)),
    pos: stringifyPathValue(readPath(payload, config.posPath)),
    phone: stringifyPathValue(readPath(payload, config.phonePath)),
    example: stringifyPathValue(readPath(payload, config.examplePath)),
  };
}

export function parseHeaders(rawHeaders: string): Record<string, string> {
  const text = (rawHeaders || "").trim();
  if (!text) return {};

  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!key) continue;
      headers[String(key)] = String(value ?? "");
    }
    return headers;
  } catch (e) {
    return {};
  }
}

export function readPath(value: unknown, rawPath: string): unknown {
  const path = (rawPath || "").trim();
  if (!path) return "";

  const segments = tokenizePath(path);
  let current: unknown = value;

  for (const segment of segments) {
    if (current == null) return "";

    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return "";
      }
      current = current[index];
      continue;
    }

    if (typeof current === "object") {
      current = (current as Record<string, unknown>)[segment];
      continue;
    }

    return "";
  }

  return current;
}

function tokenizePath(path: string): string[] {
  const normalized = path.replace(/\[(\d+)\]/g, ".$1");
  return normalized
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function stringifyPathValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => stringifyPathValue(item))
      .filter(Boolean)
      .join("; ");
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return "";
}
