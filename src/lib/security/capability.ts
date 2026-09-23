// HTMLが要求している機能（capability）の抽出と、
// 「現在の公開ページの実行環境で動くか」という互換性判定。
//
// ここでの判定はセキュリティ判定ではない。
// Cameraを使うHTMLは "detected" であって "dangerous" ではない。

import type {
  Capabilities,
  Recommendation,
  ScanContext,
  Signals,
  StorageKind,
  UrlRef,
} from "./types";
import type { AstSignals } from "./js-ast";
import { isNetworkSink, isSelfApiRequest } from "./external-resources";

// ---------------------------------------------------------------------------
// 実行環境テーブル
// ---------------------------------------------------------------------------

/**
 * 非trustモード（/tool/<id>）の実行環境で各capabilityが動作するかの対応表。
 *
 * 出典: src/app/tool/[id]/page.tsx
 *   sandbox="allow-scripts allow-forms allow-modals allow-popups"
 *   allow="geolocation; accelerometer; gyroscope; magnetometer; camera; microphone;
 *          fullscreen; clipboard-read; clipboard-write; web-share"
 *
 * trustRequired はこの表からのみ導出する（機能名のハードコードで判定しない）。
 * 表を更新したら、対応するページ側の属性も必ず合わせること。
 *
 * 前提: allow-same-origin を指定していないため、iframe は opaque origin になる。
 * allow 属性による権限委譲は opaque origin には及ばないため、
 * allow に列挙されていても camera / microphone / geolocation / clipboard は動作しない。
 * これらを使うツールは trust: true が必要になる（= trustRequired の主な発生源）。
 */
export const RUNTIME_MATRIX: Record<
  keyof Capabilities,
  { availableWithoutTrust: boolean; basis: string }
> = {
  network: { availableWithoutTrust: true, basis: "sandbox属性はネットワーク自体を制限しない" },
  sameOriginRequest: {
    availableWithoutTrust: false,
    basis:
      "opaque origin のため publisher オリジンへのリクエストはクロスオリジン扱いになり、CORS未設定の応答は読み取れない",
  },
  storage: {
    availableWithoutTrust: false,
    basis: "opaque origin では localStorage / sessionStorage / indexedDB へのアクセスが例外になる",
  },
  camera: {
    availableWithoutTrust: false,
    basis: "allow 属性に camera を含むが、opaque origin には権限が委譲されない",
  },
  microphone: {
    availableWithoutTrust: false,
    basis: "allow 属性に microphone を含むが、opaque origin には権限が委譲されない",
  },
  geolocation: {
    availableWithoutTrust: false,
    basis: "allow 属性に geolocation を含むが、opaque origin には権限が委譲されない",
  },
  clipboard: {
    availableWithoutTrust: false,
    basis:
      "allow 属性に clipboard-read / clipboard-write を含むが、opaque origin には権限が委譲されない（document.execCommand('copy') は動作する場合がある）",
  },
  serviceWorker: {
    availableWithoutTrust: false,
    basis: "opaque origin では Service Worker を登録できない",
  },
  dynamicCode: { availableWithoutTrust: true, basis: "allow-scripts によりスクリプト実行が可能" },
  frameAccess: {
    availableWithoutTrust: false,
    basis: "opaque origin のため親フレームとはクロスオリジンになり、DOMへアクセスできない",
  },
  topLevelNavigation: {
    availableWithoutTrust: false,
    basis: "allow-top-navigation が未指定のため埋め込み元ページを遷移させられない",
  },
  download: {
    availableWithoutTrust: false,
    basis: "allow-downloads が未指定のためダウンロードがブロックされる",
  },
};

const CAPABILITY_LABELS: Record<keyof Capabilities, string> = {
  network: "外部ドメインへの通信",
  sameOriginRequest: "同一オリジンへの通信",
  storage: "Storage API の利用",
  camera: "カメラの利用",
  microphone: "マイクの利用",
  geolocation: "位置情報の取得",
  clipboard: "クリップボードの読み書き",
  serviceWorker: "Service Worker の登録",
  dynamicCode: "動的コード実行",
  frameAccess: "親フレームへのアクセス",
  topLevelNavigation: "埋め込み元ページ自体の遷移",
  download: "ファイルのダウンロード",
};

// ---------------------------------------------------------------------------
// シグナル検出
// ---------------------------------------------------------------------------

const EVIDENCE_LIMIT = 3;

/**
 * 正規表現の定義はここに集約する。capabilities と findings の双方がこれを参照するため、
 * 検出ロジックが二重定義にならないようにする。
 */
const PATTERNS = {
  networkSink:
    /(?<![.\w$])fetch\s*\(|\bnew\s+XMLHttpRequest\b|\bnew\s+WebSocket\s*\(|\bnew\s+EventSource\s*\(|navigator\s*\.\s*sendBeacon\s*\(/g,
  dynamicCode:
    /(?<![.\w$])eval\s*\(|\bnew\s+Function\s*\(|(?<![.\w$])(?:setTimeout|setInterval)\s*\(\s*["'`]/g,
  // parent / top を変数名として使うコード（el.parentNode 等）を拾わないよう、
  // フレーム境界を越えるアクセスに限定する
  frameAccess:
    /(?<![.\w$])(?:window|self)\s*\.\s*(?:parent|top)\b|(?<![.\w$])(?:parent|top)\s*\.\s*(?:document|location|frames|origin|window)\b|(?<![.\w$])frameElement\b/g,
  cookieAccess: /(?<![.\w$])document\s*\.\s*cookie\b/g,
  localStorage: /(?<![.\w$])(?:window\s*\.\s*)?localStorage\b/g,
  sessionStorage: /(?<![.\w$])(?:window\s*\.\s*)?sessionStorage\b/g,
  indexedDB: /(?<![.\w$])(?:window\s*\.\s*)?indexedDB\b/g,
  getUserMedia: /(?:getUserMedia|getDisplayMedia)\s*\(/g,
  geolocation: /navigator\s*\.\s*geolocation\b/g,
  clipboard: /navigator\s*\.\s*clipboard\b|execCommand\s*\(\s*["'`](?:copy|paste)["'`]/g,
  serviceWorker: /navigator\s*\.\s*serviceWorker\s*\.\s*register\s*\(/g,
  redirect:
    /(?<![.\w$])(?:window\s*\.\s*)?location\s*(?:\.\s*(?:href|assign|replace)\s*(?:=|\()|=)/g,
  topLevelNavigationCode: /(?<![.\w$])(?:window\s*\.\s*)?(?:top|parent)\s*\.\s*location\b/g,
  topLevelNavigationMarkup: /target\s*=\s*["']?_(?:top|parent)\b/gi,
  download: /<a\b[^>]*\sdownload[\s=>]|showSaveFilePicker\s*\(|msSaveBlob\s*\(/g,
  metaRefresh: /<meta\b[^>]*http-equiv\s*=\s*["']?refresh\b/gi,
  inlineEventHandler: /\son[a-z]{3,20}\s*=\s*["'][^"']*["']/gi,
  javascriptUri: /(?:href|src|action|formaction)\s*=\s*["']?\s*javascript:/gi,
  embeddedFrame: /<(?:iframe|embed|object)\b/gi,
  passwordInput: /<input\b[^>]*type\s*=\s*["']?password\b/gi,
  mediaConstraint: /\b(audio|video)\s*:\s*([A-Za-z0-9_$.{]+)/g,
} as const;

/**
 * getUserMedia の制約オブジェクトから camera / microphone を切り分ける。
 * `(?!false)` のような否定先読みは `\s*` のバックトラックで素通りするため、
 * 値そのものを取り出して判定する。
 */
function hasTruthyMediaConstraint(code: string, kind: "audio" | "video"): boolean {
  const re = PATTERNS.mediaConstraint;
  re.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(code)) !== null) {
    if (match[1] === kind && match[2] !== "false") return true;
  }
  return false;
}

function countMatches(re: RegExp, source: string, evidence?: string[]): number {
  re.lastIndex = 0;
  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    count += 1;
    if (evidence && evidence.length < EVIDENCE_LIMIT) {
      evidence.push(excerpt(source, match.index, match[0].length));
    }
    // ゼロ幅マッチによる無限ループの防止
    if (match.index === re.lastIndex) re.lastIndex += 1;
  }
  return count;
}

function excerpt(source: string, index: number, length: number): string {
  const start = Math.max(0, index - 20);
  const end = Math.min(source.length, index + length + 20);
  const text = source.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${text}${end < source.length ? "…" : ""}`;
}

/** `<svg>` 内に `<script>` があるか（バックトラッキングを避けるため手続きで探す） */
function countSvgScripts(html: string): number {
  const lower = html.toLowerCase();
  let count = 0;
  let cursor = 0;
  for (;;) {
    const open = lower.indexOf("<svg", cursor);
    if (open === -1) break;
    const close = lower.indexOf("</svg", open);
    const end = close === -1 ? lower.length : close;
    if (lower.slice(open, end).includes("<script")) count += 1;
    cursor = end + 1;
  }
  return count;
}

/**
 * シグナルを検出する。
 *
 * JS由来のシグナルは2系統から集める:
 *   - ast: acorn でパースできた断片（js-ast.ts が担当）
 *   - 正規表現: パースできなかった断片（ctx.unparsedCode）のみ
 *
 * 正規表現をパース失敗分に限定することで、コメントや文字列リテラル内の
 * コード片を誤検知しなくなる。
 */
export function detectSignals(ctx: ScanContext, refs: UrlRef[], ast: AstSignals): Signals {
  const evidence: Record<string, string[]> = { ...ast.evidence };
  const track = (key: string): string[] => (evidence[key] ??= []);

  const storage: StorageKind[] = [...ast.storage];
  const addStorage = (kind: StorageKind) => {
    if (!storage.includes(kind)) storage.push(kind);
  };
  if (countMatches(PATTERNS.localStorage, ctx.unparsedCode) > 0) addStorage("localStorage");
  if (countMatches(PATTERNS.sessionStorage, ctx.unparsedCode) > 0) addStorage("sessionStorage");
  if (countMatches(PATTERNS.indexedDB, ctx.unparsedCode) > 0) addStorage("indexedDB");

  const cookieAccess =
    ast.cookieAccess + countMatches(PATTERNS.cookieAccess, ctx.unparsedCode, track("cookieAccess"));
  if (cookieAccess > 0) addStorage("cookie");

  const networkRefs = refs.filter(isNetworkSink);
  const mediaDevices =
    ast.mediaDevices + countMatches(PATTERNS.getUserMedia, ctx.unparsedCode, track("mediaDevices"));

  return {
    externalNetworkSink: networkRefs.filter((ref) => ref.kind === "external").length,
    sameOriginRequest: networkRefs.filter((ref) => ref.kind === "same-origin").length,
    sameOriginApiRequest: networkRefs.filter(isSelfApiRequest).length,
    dynamicCode:
      ast.dynamicCode + countMatches(PATTERNS.dynamicCode, ctx.unparsedCode, track("dynamicCode")),
    frameAccess:
      ast.frameAccess + countMatches(PATTERNS.frameAccess, ctx.unparsedCode, track("frameAccess")),
    cookieAccess,
    storage,
    camera: ast.camera || (mediaDevices > 0 && hasTruthyMediaConstraint(ctx.unparsedCode, "video")),
    microphone:
      ast.microphone || (mediaDevices > 0 && hasTruthyMediaConstraint(ctx.unparsedCode, "audio")),
    mediaDevices,
    geolocation:
      ast.geolocation + countMatches(PATTERNS.geolocation, ctx.unparsedCode, track("geolocation")),
    clipboard: ast.clipboard + countMatches(PATTERNS.clipboard, ctx.unparsedCode, track("clipboard")),
    serviceWorker:
      ast.serviceWorker +
      countMatches(PATTERNS.serviceWorker, ctx.unparsedCode, track("serviceWorker")),
    redirect: ast.redirect + countMatches(PATTERNS.redirect, ctx.unparsedCode, track("redirect")),
    topLevelNavigation:
      ast.topLevelNavigation +
      countMatches(PATTERNS.topLevelNavigationCode, ctx.unparsedCode, track("topLevelNavigation")) +
      countMatches(PATTERNS.topLevelNavigationMarkup, ctx.html, track("topLevelNavigation")),
    download: countMatches(PATTERNS.download, ctx.html, track("download")),
    inlineEventHandler: countMatches(
      PATTERNS.inlineEventHandler,
      ctx.html,
      track("inlineEventHandler")
    ),
    javascriptUri: countMatches(PATTERNS.javascriptUri, ctx.html, track("javascriptUri")),
    svgScript: countSvgScripts(ctx.html),
    embeddedFrame:
      ast.embeddedFrame + countMatches(PATTERNS.embeddedFrame, ctx.html, track("embeddedFrame")),
    dynamicNetworkSink: ast.dynamicNetworkSink,
    metaRefresh: countMatches(PATTERNS.metaRefresh, ctx.html, track("metaRefresh")),
    passwordInput: countMatches(PATTERNS.passwordInput, ctx.html),
    evidence,
  };
}

export function toCapabilities(signals: Signals): Capabilities {
  return {
    network: signals.externalNetworkSink > 0 || signals.dynamicNetworkSink > 0,
    sameOriginRequest: signals.sameOriginRequest > 0,
    storage: signals.storage,
    camera: signals.camera,
    microphone: signals.microphone,
    geolocation: signals.geolocation > 0,
    clipboard: signals.clipboard > 0,
    serviceWorker: signals.serviceWorker > 0,
    dynamicCode: signals.dynamicCode > 0,
    frameAccess: signals.frameAccess > 0,
    topLevelNavigation: signals.topLevelNavigation > 0,
    download: signals.download > 0,
  };
}

function isRequested(capabilities: Capabilities, key: keyof Capabilities): boolean {
  const value = capabilities[key];
  return Array.isArray(value) ? value.length > 0 : value;
}

/**
 * trustRequired を RUNTIME_MATRIX から導出する。
 *
 * 「セキュリティ的にtrustが推奨」という意味ではなく、
 * 「非trustモードの実行環境では動かない可能性がある」という互換性判定。
 * capabilities から自動で trust を付与することはしない。
 */
export function deriveRecommendation(capabilities: Capabilities): Recommendation {
  const reasons: string[] = [];

  for (const key of Object.keys(RUNTIME_MATRIX) as (keyof Capabilities)[]) {
    if (!isRequested(capabilities, key)) continue;
    const entry = RUNTIME_MATRIX[key];
    if (entry.availableWithoutTrust) continue;
    reasons.push(`${CAPABILITY_LABELS[key]}: ${entry.basis}`);
  }

  return { trustRequired: reasons.length > 0, reasons };
}

/** 非trustモードでも動作する（= trustを付ける理由にならない）要求機能 */
export function listAvailableCapabilities(capabilities: Capabilities): string[] {
  return (Object.keys(RUNTIME_MATRIX) as (keyof Capabilities)[])
    .filter((key) => isRequested(capabilities, key) && RUNTIME_MATRIX[key].availableWithoutTrust)
    .map((key) => CAPABILITY_LABELS[key]);
}
