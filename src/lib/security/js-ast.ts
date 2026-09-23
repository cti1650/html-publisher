// JavaScript の AST 解析（Phase 2 / #10）。
//
// Phase 1 の正規表現は「コード片が文字列としてそこに書かれているか」しか見られないため、
//   - 文字列連結・atob・String.fromCharCode で組み立てられた識別子
//   - 変数に退避してからの間接アクセス
//   - 実行時に組み立てられるURL
// を取りこぼし、逆にコメントや文字列リテラル内のコード片を誤検知する。
//
// acorn でパースできたソースはこのモジュールが担当し、
// パースできなかったソースだけ Phase 1 の正規表現にフォールバックする。
// Semgrep 等の外部エンジンは Vercel の Node ランタイムで実行できないため採用していない。

import * as acorn from "acorn";
import type { StorageKind, UrlRef } from "./types";

type Node = Record<string, unknown> & { type: string };

/** 定数畳み込み・メンバパス解決の再帰上限 */
const MAX_DEPTH = 12;
/** Blob 等に埋め込まれたコードを再帰解析する深さの上限 */
const MAX_NESTED = 2;
const EVIDENCE_LIMIT = 3;

export interface AstSignals {
  dynamicCode: number;
  frameAccess: number;
  cookieAccess: number;
  storage: StorageKind[];
  mediaDevices: number;
  camera: boolean;
  microphone: boolean;
  geolocation: number;
  clipboard: number;
  serviceWorker: number;
  redirect: number;
  topLevelNavigation: number;
  embeddedFrame: number;
  dynamicNetworkSink: number;
  evidence: Record<string, string[]>;
}

export interface JsAnalysis {
  /** acorn でパースできたか。false の場合は正規表現へフォールバックする */
  parsed: boolean;
  signals: AstSignals;
  /** 畳み込みで判明したURL参照（sink 由来） */
  urls: Omit<UrlRef, "kind" | "host">[];
}

function emptySignals(): AstSignals {
  return {
    dynamicCode: 0,
    frameAccess: 0,
    cookieAccess: 0,
    storage: [],
    mediaDevices: 0,
    camera: false,
    microphone: false,
    geolocation: 0,
    clipboard: 0,
    serviceWorker: 0,
    redirect: 0,
    topLevelNavigation: 0,
    embeddedFrame: 0,
    dynamicNetworkSink: 0,
    evidence: {},
  };
}

/** acorn-walk を使わない汎用ウォーカー（依存を増やさないため） */
function walk(node: unknown, visit: (n: Node) => void): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  const n = node as Node;
  if (typeof n.type === "string") visit(n);
  for (const key of Object.keys(n)) {
    if (key === "type" || key === "start" || key === "end" || key === "loc" || key === "range") continue;
    walk(n[key], visit);
  }
}

type Binding = { str?: string; alias?: string; element?: string };
type Env = Map<string, Binding>;

const GLOBALS = new Set(["window", "self", "globalThis", "document", "navigator", "top", "parent"]);

/** 文字列連結 / atob / String.fromCharCode を解決して静的な文字列を得る */
function fold(node: Node | undefined, env: Env, depth = 0): string | null {
  if (!node || depth > MAX_DEPTH) return null;

  switch (node.type) {
    case "Literal":
      return typeof node.value === "string" ? node.value : null;

    case "TemplateLiteral": {
      const quasis = node.quasis as Node[];
      const exprs = (node.expressions as Node[]) ?? [];
      let out = "";
      for (let i = 0; i < quasis.length; i++) {
        out += (quasis[i].value as Record<string, string>).cooked ?? "";
        // 解決できない埋め込み式は空白にする（URLのホスト部分が未確定でも前半は評価したい）
        if (i < exprs.length) out += fold(exprs[i], env, depth + 1) ?? " ";
      }
      return out;
    }

    case "BinaryExpression": {
      if (node.operator !== "+") return null;
      const left = fold(node.left as Node, env, depth + 1);
      const right = fold(node.right as Node, env, depth + 1);
      return left !== null && right !== null ? left + right : null;
    }

    case "Identifier":
      return env.get(node.name as string)?.str ?? null;

    case "CallExpression": {
      const path = memberPath(node.callee as Node, env, depth + 1);
      const args = (node.arguments as Node[]) ?? [];

      if (path === "atob" || path === "window.atob") {
        const encoded = fold(args[0], env, depth + 1);
        if (encoded === null) return null;
        try {
          return Buffer.from(encoded, "base64").toString("utf8");
        } catch {
          return null;
        }
      }

      if (path === "String.fromCharCode") {
        const codes = args.map((a) => (a.type === "Literal" ? Number(a.value) : Number.NaN));
        if (codes.length === 0 || codes.some((c) => Number.isNaN(c))) return null;
        return String.fromCharCode(...codes);
      }

      return null;
    }

    default:
      return null;
  }
}

/** メンバ式を `window.localStorage` のような正規化パスにする（computed キーは畳み込む） */
function memberPath(node: Node | undefined, env: Env, depth = 0): string | null {
  if (!node || depth > MAX_DEPTH) return null;

  if (node.type === "Identifier") {
    const name = node.name as string;
    return env.get(name)?.alias ?? name;
  }
  if (node.type === "ThisExpression") return "this";

  if (node.type === "MemberExpression") {
    const base = memberPath(node.object as Node, env, depth + 1);
    if (base === null) return null;
    const prop = node.computed
      ? fold(node.property as Node, env, depth + 1)
      : ((node.property as Node).name as string | undefined);
    if (!prop) return null;
    return `${base}.${prop}`;
  }

  return null;
}

/**
 * 変数束縛を収集する。スコープは追わない（公開HTMLの規模では過剰なため）。
 * 前方参照にも効くよう2回走査する。
 */
function buildEnv(ast: unknown): Env {
  const env: Env = new Map();

  for (let pass = 0; pass < 2; pass++) {
    walk(ast, (n) => {
      if (n.type !== "VariableDeclarator" && n.type !== "AssignmentExpression") return;

      const target = (n.type === "VariableDeclarator" ? n.id : n.left) as Node | undefined;
      const init = (n.type === "VariableDeclarator" ? n.init : n.right) as Node | undefined;
      if (!target || target.type !== "Identifier" || !init) return;

      const name = target.name as string;
      const current = env.get(name) ?? {};

      const str = fold(init, env);
      // 空白を含む値は文章の可能性が高く、識別子の別名としては扱わない
      if (str !== null && !/\s/.test(str)) {
        env.set(name, { ...current, str });
        return;
      }

      const path = memberPath(init, env);
      if (path && (GLOBALS.has(path) || path.includes("."))) {
        env.set(name, { ...current, alias: path });
        return;
      }

      if (init.type === "CallExpression") {
        const calleePath = memberPath(init.callee as Node, env);
        if (calleePath === "document.createElement") {
          const tag = fold((init.arguments as Node[])?.[0], env);
          if (tag) env.set(name, { ...current, element: tag.toLowerCase() });
        }
      }
    });
  }

  return env;
}

const NETWORK_CALLS = /^(?:.*\.)?(?:fetch|sendBeacon|importScripts)$/;
const NETWORK_CTORS = new Set(["WebSocket", "EventSource", "Worker", "SharedWorker"]);

/** getUserMedia の制約オブジェクトから camera / microphone を切り分ける */
function readMediaConstraints(arg: Node | undefined, env: Env): { video: boolean; audio: boolean } {
  const result = { video: false, audio: false };
  if (!arg || arg.type !== "ObjectExpression") return result;

  for (const prop of (arg.properties as Node[]) ?? []) {
    if (prop.type !== "Property") continue;
    const key = prop.computed
      ? fold(prop.key as Node, env)
      : (((prop.key as Node).name as string) ?? ((prop.key as Node).value as string));
    const value = prop.value as Node;
    const isFalse = value.type === "Literal" && value.value === false;
    if (key === "video" && !isFalse) result.video = true;
    if (key === "audio" && !isFalse) result.audio = true;
  }
  return result;
}

function isAbsoluteUrl(url: string): boolean {
  return /^(?:https?:)?\/\//i.test(url) || /^wss?:\/\//i.test(url);
}

function record(signals: AstSignals, key: string, snippet: string): void {
  const list = (signals.evidence[key] ??= []);
  if (list.length < EVIDENCE_LIMIT) list.push(snippet.replace(/\s+/g, " ").trim().slice(0, 80));
}

function analyze(code: string, depth: number): JsAnalysis {
  const signals = emptySignals();
  const urls: JsAnalysis["urls"] = [];

  let ast: unknown;
  try {
    ast = acorn.parse(code, {
      ecmaVersion: "latest",
      sourceType: "script",
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      allowSuperOutsideMethod: true,
    });
  } catch {
    try {
      // import/export を含むソースは module として解釈し直す
      ast = acorn.parse(code, { ecmaVersion: "latest", sourceType: "module" });
    } catch {
      return { parsed: false, signals, urls };
    }
  }

  const env = buildEnv(ast);
  const addStorage = (kind: StorageKind) => {
    if (!signals.storage.includes(kind)) signals.storage.push(kind);
  };

  walk(ast, (n) => {
    if (n.type === "MemberExpression") {
      const path = memberPath(n, env);
      if (!path) return;

      if (/(?:^|\.)localStorage(?:\.|$)/.test(path)) addStorage("localStorage");
      if (/(?:^|\.)sessionStorage(?:\.|$)/.test(path)) addStorage("sessionStorage");
      if (/(?:^|\.)indexedDB(?:\.|$)/.test(path)) addStorage("indexedDB");

      if (/(?:^|\.)document\.cookie(?:\.|$)/.test(path)) {
        signals.cookieAccess += 1;
        addStorage("cookie");
        record(signals, "cookieAccess", path);
      }

      if (
        /^(?:window|self|globalThis)\.(?:parent|top)(?:\.|$)/.test(path) ||
        /^(?:parent|top)\.(?:document|location|frames|origin|window)(?:\.|$)/.test(path) ||
        /(?:^|\.)frameElement(?:\.|$)/.test(path)
      ) {
        signals.frameAccess += 1;
        record(signals, "frameAccess", path);
      }

      if (/(?:^|\.)navigator\.geolocation(?:\.|$)/.test(path)) signals.geolocation += 1;
      if (/(?:^|\.)navigator\.clipboard(?:\.|$)/.test(path)) signals.clipboard += 1;

      if (/^(?:parent|top)\.location$/.test(path) || /^(?:window|self)\.(?:parent|top)\.location$/.test(path)) {
        signals.topLevelNavigation += 1;
      }
    }

    if (n.type === "CallExpression" || n.type === "NewExpression") {
      const callee = n.callee as Node;
      const path = memberPath(callee, env);
      const args = (n.arguments as Node[]) ?? [];

      if (path && /(?:^|\.)eval$/.test(path)) {
        signals.dynamicCode += 1;
        record(signals, "dynamicCode", path);
      }
      if (path === "Function" || path === "window.Function") {
        signals.dynamicCode += 1;
        record(signals, "dynamicCode", "Function()");
      }
      // setTimeout("...") のように文字列を渡す形も動的コード実行にあたる
      if (path && /(?:^|\.)(?:setTimeout|setInterval)$/.test(path) && args[0]?.type === "Literal") {
        if (typeof args[0].value === "string") signals.dynamicCode += 1;
      }

      if (path && /(?:^|\.)(?:getUserMedia|getDisplayMedia)$/.test(path)) {
        signals.mediaDevices += 1;
        const constraints = readMediaConstraints(args[0], env);
        if (constraints.video) signals.camera = true;
        if (constraints.audio) signals.microphone = true;
        record(signals, "mediaDevices", path);
      }
      if (path && /(?:^|\.)serviceWorker\.register$/.test(path)) {
        signals.serviceWorker += 1;
        record(signals, "serviceWorker", path);
      }
      if (path && /(?:^|\.)clipboard\.(?:writeText|readText|write|read)$/.test(path)) {
        signals.clipboard += 1;
      }
      if (path && /(?:^|\.)location\.(?:assign|replace)$/.test(path)) {
        signals.redirect += 1;
        record(signals, "redirect", path);
      }

      // ネットワーク sink: 第1引数を畳み込んでURLとして登録する
      const isNetworkCall = path !== null && NETWORK_CALLS.test(path);
      const isNetworkCtor = path !== null && NETWORK_CTORS.has(path);
      if (isNetworkCall || isNetworkCtor) {
        const label = path!.split(".").pop() ?? "fetch";
        const url = fold(args[0], env);
        if (url && url.trim()) {
          urls.push({ raw: url.trim().slice(0, 300), origin: `js[${label}]` });
        } else {
          // 宛先を静的に特定できないケース。通信すること自体は事実として残す
          signals.dynamicNetworkSink += 1;
          record(signals, "dynamicNetworkSink", `${label}(...)`);
        }
      }

      // Blob(["...code..."]) / Worker に渡されるコード文字列を再帰解析する
      if ((path === "Blob" || path === "File") && depth < MAX_NESTED) {
        for (const arg of args) {
          if (arg.type !== "ArrayExpression") continue;
          for (const element of ((arg.elements as Node[]) ?? []).filter(Boolean)) {
            const inner = fold(element, env);
            if (!inner) continue;
            const nested = analyze(inner, depth + 1);
            if (nested.parsed) mergeInto(signals, urls, nested);
          }
        }
      }

      // eval("...") の中身も解析対象にする
      if (path && /(?:^|\.)eval$/.test(path) && depth < MAX_NESTED) {
        const inner = fold(args[0], env);
        if (inner) {
          const nested = analyze(inner, depth + 1);
          if (nested.parsed) mergeInto(signals, urls, nested);
        }
      }
    }

    if (n.type === "AssignmentExpression") {
      const path = memberPath(n.left as Node, env);
      if (!path) return;
      const value = fold(n.right as Node, env);

      // 実行時に生成した要素へURLを設定するパターン
      if (/\.(?:src|action|formAction|href)$/.test(path)) {
        const holder = path.replace(/\.[^.]+$/, "");
        const element = env.get(holder.split(".").pop() ?? "")?.element ?? env.get(holder)?.element;
        if (value && isAbsoluteUrl(value)) {
          const label = element ? `js[${element}.${path.split(".").pop()}]` : "js[assign]";
          urls.push({ raw: value.slice(0, 300), origin: label });
        }
      }

      if (/(?:^|\.)location(?:\.href)?$/.test(path) && !path.startsWith("parent.") && !path.startsWith("top.")) {
        signals.redirect += 1;
        record(signals, "redirect", path);
      }
      if (/^(?:parent|top)\.location$/.test(path) || /^(?:window|self)\.(?:parent|top)\.location$/.test(path)) {
        signals.topLevelNavigation += 1;
      }

      // innerHTML / srcdoc に組み立てた文字列を流し込むパターン
      if (/\.(?:innerHTML|outerHTML|srcdoc)$/.test(path) && value) {
        if (/<\s*(?:iframe|embed|object)\b/i.test(value)) {
          signals.embeddedFrame += 1;
          record(signals, "embeddedFrame", value);
        }
        if (/<\s*script\b/i.test(value)) {
          signals.dynamicCode += 1;
          record(signals, "dynamicCode", value);
        }
      }
    }
  });

  return { parsed: true, signals, urls };
}

function mergeInto(signals: AstSignals, urls: JsAnalysis["urls"], other: JsAnalysis): void {
  const s = other.signals;
  signals.dynamicCode += s.dynamicCode;
  signals.frameAccess += s.frameAccess;
  signals.cookieAccess += s.cookieAccess;
  signals.mediaDevices += s.mediaDevices;
  signals.camera ||= s.camera;
  signals.microphone ||= s.microphone;
  signals.geolocation += s.geolocation;
  signals.clipboard += s.clipboard;
  signals.serviceWorker += s.serviceWorker;
  signals.redirect += s.redirect;
  signals.topLevelNavigation += s.topLevelNavigation;
  signals.embeddedFrame += s.embeddedFrame;
  signals.dynamicNetworkSink += s.dynamicNetworkSink;
  for (const kind of s.storage) if (!signals.storage.includes(kind)) signals.storage.push(kind);
  for (const [key, list] of Object.entries(s.evidence)) {
    const target = (signals.evidence[key] ??= []);
    for (const item of list) if (target.length < EVIDENCE_LIMIT) target.push(item);
  }
  urls.push(...other.urls);
}

/** 単一のJSソースを解析する */
export function analyzeJsSource(code: string): JsAnalysis {
  if (!code.trim()) return { parsed: true, signals: emptySignals(), urls: [] };
  return analyze(code, 0);
}

/** 複数ソースをまとめて解析し、パースできなかったものを返す */
export function analyzeJsSources(sources: string[]): {
  signals: AstSignals;
  urls: JsAnalysis["urls"];
  unparsed: string[];
} {
  const signals = emptySignals();
  const urls: JsAnalysis["urls"] = [];
  const unparsed: string[] = [];

  for (const source of sources) {
    const result = analyzeJsSource(source);
    if (!result.parsed) {
      unparsed.push(source);
      continue;
    }
    mergeInto(signals, urls, result);
  }

  return { signals, urls, unparsed };
}

const DATA_URI_RE = /(?:src|href)\s*=\s*["']data:text\/html(;base64)?,([^"']{1,200000})["']/gi;
const SRCDOC_RE = /srcdoc\s*=\s*(?:"([^"]{1,200000})"|'([^']{1,200000})')/gi;

/**
 * data: URI / srcdoc に埋め込まれたHTMLを取り出す。
 * Phase 1 はこれらの中身を解析対象外にしていた（limitations に明記していた項目）。
 */
export function extractEmbeddedHtml(html: string): string[] {
  const out: string[] = [];

  DATA_URI_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = DATA_URI_RE.exec(html)) !== null) {
    try {
      out.push(match[1] ? Buffer.from(match[2], "base64").toString("utf8") : decodeURIComponent(match[2]));
    } catch {
      /* デコードできないものは対象外 */
    }
  }

  SRCDOC_RE.lastIndex = 0;
  while ((match = SRCDOC_RE.exec(html)) !== null) {
    const raw = match[1] ?? match[2] ?? "";
    out.push(
      raw
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&")
    );
  }

  return out;
}
