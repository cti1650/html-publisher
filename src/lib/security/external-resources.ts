// HTML属性・JSコードからURL参照を抽出し、外部 / 同一オリジンに分類する。
//
// 「外部通信」だけを見ると、このアプリで最も危険な
// 同一オリジン（publisherオリジン）への通信を見落とす。
// 公開HTMLは /tool/<id> の iframe 内で publisher と同一オリジンで動くため、
// 相対URLへの fetch は HTML Publisher 自身のAPIを叩けてしまう。

import type { ScanContext, UrlKind, UrlRef } from "./types";

/** URLを持ちうる属性 */
const URL_ATTRS = new Set([
  "src",
  "href",
  "action",
  "formaction",
  "poster",
  "data",
  "srcset",
  "content",
]);

const TAG_RE = /<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
const ATTR_RE = /([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
const CSS_URL_RE = /url\(\s*['"]?([^'")\s]{1,2000})/g;

/** 文字列リテラルを第1引数に取るネットワークsink */
const SINK_LITERAL_RE =
  /(?<![.\w$])(fetch|sendBeacon|WebSocket|EventSource|importScripts)\s*\(\s*(["'`])([^"'`\n]{0,2000})\2/g;
/** xhr.open("GET", url) の第2引数 */
const XHR_OPEN_RE =
  /\.open\s*\(\s*["'`][A-Za-z]+["'`]\s*,\s*(["'`])([^"'`\n]{0,2000})\1/g;
/** import("...") / import "..." */
const DYNAMIC_IMPORT_RE = /(?<![.\w$])import\s*\(\s*(["'`])([^"'`\n]{0,2000})\1/g;

export function classifyUrl(raw: string, selfOrigin?: string): { kind: UrlKind; host?: string } {
  const value = raw.trim();
  if (!value) return { kind: "other" };

  const lower = value.toLowerCase();
  // 属性値中の改行・タブはブラウザが無視するため、スキーム判定前に除去する
  const scheme = lower.replace(/[\s\u0000-\u001f]/g, "");

  if (scheme.startsWith("javascript:")) return { kind: "javascript" };
  if (scheme.startsWith("data:")) return { kind: "data" };
  if (scheme.startsWith("blob:")) return { kind: "blob" };
  if (
    scheme.startsWith("mailto:") ||
    scheme.startsWith("tel:") ||
    scheme.startsWith("sms:") ||
    value.startsWith("#")
  ) {
    return { kind: "other" };
  }

  // プロトコル相対URL（//example.com/x）
  const absolute = value.startsWith("//")
    ? `https:${value}`
    : /^https?:\/\//i.test(value)
      ? value
      : /^wss?:\/\//i.test(value)
        ? value.replace(/^ws/i, "http")
        : null;

  if (absolute) {
    try {
      const url = new URL(absolute);
      if (selfOrigin && isSameHost(url, selfOrigin)) {
        return { kind: "same-origin", host: url.hostname };
      }
      return { kind: "external", host: url.hostname };
    } catch {
      return { kind: "other" };
    }
  }

  // スキーム付きだが http/https 以外（chrome-extension: 等）は判定対象外
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return { kind: "other" };

  return { kind: "same-origin" };
}

function isSameHost(url: URL, selfOrigin: string): boolean {
  try {
    return url.hostname === new URL(selfOrigin).hostname;
  } catch {
    return false;
  }
}

function pushRef(
  refs: UrlRef[],
  raw: string,
  origin: string,
  selfOrigin?: string
): void {
  const value = raw.trim();
  if (!value) return;
  const { kind, host } = classifyUrl(value, selfOrigin);
  refs.push({ raw: value.slice(0, 300), kind, host, origin });
}

/** HTML属性から抽出 */
function collectFromAttributes(html: string, refs: UrlRef[], selfOrigin?: string): void {
  TAG_RE.lastIndex = 0;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = TAG_RE.exec(html)) !== null) {
    const tag = tagMatch[1].toLowerCase();
    const attrs = tagMatch[2];
    if (!attrs) continue;

    ATTR_RE.lastIndex = 0;
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = ATTR_RE.exec(attrs)) !== null) {
      const name = attrMatch[1].toLowerCase();
      if (!URL_ATTRS.has(name)) continue;
      const value = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? "";

      // <meta content="..."> は http-equiv=refresh の場合だけURLを含む
      if (name === "content") {
        const refresh = /url\s*=\s*([^;,\s]+)/i.exec(value);
        if (!refresh) continue;
        pushRef(refs, refresh[1], `${tag}[meta-refresh]`, selfOrigin);
        continue;
      }

      if (name === "srcset") {
        for (const candidate of value.split(",")) {
          pushRef(refs, candidate.trim().split(/\s+/)[0] ?? "", `${tag}[srcset]`, selfOrigin);
        }
        continue;
      }

      pushRef(refs, value, `${tag}[${name}]`, selfOrigin);
    }
  }
}

/** style属性・styleタグ内の url(...) から抽出 */
function collectFromCss(html: string, refs: UrlRef[], selfOrigin?: string): void {
  CSS_URL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CSS_URL_RE.exec(html)) !== null) {
    pushRef(refs, match[1], "css[url]", selfOrigin);
  }
}

/** JSコード中のネットワークsinkの引数から抽出 */
function collectFromCode(code: string, refs: UrlRef[], selfOrigin?: string): void {
  const patterns: [RegExp, number, string][] = [
    [SINK_LITERAL_RE, 3, "js"],
    [XHR_OPEN_RE, 2, "js[xhr.open]"],
    [DYNAMIC_IMPORT_RE, 2, "js[import]"],
  ];

  for (const [re, group, label] of patterns) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(code)) !== null) {
      const sink = label === "js" ? `js[${match[1]}]` : label;
      pushRef(refs, match[group], sink, selfOrigin);
    }
  }
}

export function extractUrlRefs(ctx: ScanContext, selfOrigin?: string): UrlRef[] {
  const refs: UrlRef[] = [];
  collectFromAttributes(ctx.html, refs, selfOrigin);
  collectFromCss(ctx.html, refs, selfOrigin);
  collectFromCode(ctx.code, refs, selfOrigin);
  return refs;
}

export function collectExternalDomains(refs: UrlRef[]): string[] {
  const hosts = new Set<string>();
  for (const ref of refs) {
    if (ref.kind === "external" && ref.host) hosts.add(ref.host);
  }
  return [...hosts].sort();
}

/** そのURL参照がネットワークsink（fetch/XHR/WebSocket等）由来か */
export function isNetworkSink(ref: UrlRef): boolean {
  return ref.origin.startsWith("js[");
}

/** publisher自身のAPIを叩いているか（/api/ 配下への同一オリジンリクエスト） */
export function isSelfApiRequest(ref: UrlRef): boolean {
  if (ref.kind !== "same-origin") return false;
  const path = ref.raw.replace(/^https?:\/\/[^/]+/i, "");
  return path.startsWith("/api/");
}
