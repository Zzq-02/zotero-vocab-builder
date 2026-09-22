/**
 * 短语翻译的响应解析（纯函数，便于单测）。
 * 说明：单个单词仍走原有词典通道；含空格的短语改用支持短语的接口，
 * 以下解析函数分别对应有道 jsonapi / 有道翻译接口 / MyMemory 三种响应。
 */

export interface PhraseResult {
  trans: string;
  def: string;
  pos: string;
  phone: string;
  example: string;
}

const EMPTY: PhraseResult = {
  trans: "",
  def: "",
  pos: "",
  phone: "",
  example: "",
};

function asArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

function deepString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = deepString(item);
      if (text) return text;
    }
    return "";
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["i", "l", "tgt", "text", "value"]) {
      const text = deepString(record[key]);
      if (text) return text;
    }
  }
  return "";
}

/** 解析有道 jsonapi 响应（dict.youdao.com/jsonapi?q=...） */
export function parseYoudaoJsonapi(payload: unknown): PhraseResult {
  const result: PhraseResult = { ...EMPTY };
  if (!payload || typeof payload !== "object") return result;
  const data = payload as Record<string, any>;

  // 释义/翻译：ec.word[].trs[].tr[].l.i[]（中英词典）
  try {
    for (const word of asArray(data.ec?.word)) {
      const lines: string[] = [];
      for (const trs of asArray(word?.trs)) {
        for (const tr of asArray(trs?.tr)) {
          const text = deepString(tr?.l);
          if (text && !lines.includes(text)) lines.push(text);
        }
      }
      if (lines.length && !result.trans) {
        result.trans = lines.slice(0, 2).join("；");
      }
      if (!result.pos && word?.pos) result.pos = String(word.pos).trim();
      if (!result.phone) {
        result.phone = String(word?.usphone || word?.ukphone || "").trim();
      }
    }
  } catch (e) {
    /* 忽略异常结构，按空字段处理 */
  }

  // 短语条目：phrs.phrase[].trs[].tr[].l.i[]
  if (!result.trans) {
    try {
      for (const phrase of asArray(data.phrs?.phrase)) {
        const lines: string[] = [];
        for (const trs of asArray(phrase?.trs)) {
          for (const tr of asArray(trs?.tr)) {
            const text = deepString(tr?.l);
            if (text && !lines.includes(text)) lines.push(text);
          }
        }
        if (lines.length) {
          result.trans = lines.slice(0, 2).join("；");
          break;
        }
      }
    } catch (e) {
      /* 忽略异常结构，按空字段处理 */
    }
  }

  // 英英释义（可选）
  if (!result.def) {
    try {
      for (const word of asArray(data.ee?.word)) {
        const text = deepString(asArray(word?.trs)[0]?.tr);
        if (text) {
          result.def = text;
          break;
        }
      }
    } catch (e) {
      /* 忽略异常结构，按空字段处理 */
    }
  }

  // 音标兜底：simple.word[].usphone/ukphone
  if (!result.phone) {
    try {
      for (const word of asArray(data.simple?.word)) {
        const phone = String(word?.usphone || word?.ukphone || "").trim();
        if (phone) {
          result.phone = phone;
          break;
        }
      }
    } catch (e) {
      /* 忽略异常结构，按空字段处理 */
    }
  }

  // 双语例句（语境）
  if (!result.example) {
    try {
      const pairs = asArray(data.blng_sents_part?.["sentence-pair"]);
      for (const pair of pairs) {
        const sentence = String(pair?.sentence || "").trim();
        if (sentence) {
          result.example = sentence;
          break;
        }
      }
    } catch (e) {
      /* 忽略异常结构，按空字段处理 */
    }
  }

  return result;
}

/** 解析有道翻译接口响应（fanyi.youdao.com/translate?doctype=json&i=...） */
export function parseYoudaoFanyi(payload: unknown): string {
  try {
    const rows = asArray((payload as any)?.translateResult);
    const texts: string[] = [];
    for (const row of rows) {
      for (const item of asArray(row)) {
        const tgt = String(item?.tgt || "").trim();
        if (tgt) texts.push(tgt);
      }
    }
    return texts.join("");
  } catch (e) {
    return "";
  }
}

/** 解析 MyMemory 响应（api.mymemory.translated.net/get?q=...&langpair=en|zh-CN） */
export function parseMyMemory(payload: unknown): string {
  try {
    const data = payload as any;
    const status = Number(data?.responseStatus ?? 200);
    if (status !== 200) return "";
    const text = String(data?.responseData?.translatedText || "").trim();
    // MyMemory 失败时会返回提示性英文句子，过滤掉
    if (!text || /^[A-Z\s]+QUERY LENGTH/i.test(text)) return "";
    return text;
  } catch (e) {
    return "";
  }
}
