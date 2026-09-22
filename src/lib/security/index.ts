// 公開前HTML静的解析のエントリポイント。
//
// MCP側（src/app/api/mcp/[transport]/route.ts）は scanHtml() を呼ぶだけにする。
// 解析エンジンを Semgrep / Gitleaks 等へ差し替える場合（#10 / #11）も、
// 差し替えはこのモジュールの内側に閉じ込め、SecurityReport の形は変えない。

import { deriveRecommendation, detectSignals, toCapabilities } from "./capability";
import { collectExternalDomains, extractUrlRefs } from "./external-resources";
import { evaluateRules } from "./rules";
import type { RiskLevel, ScanContext, SecurityReport, Severity } from "./types";

export type {
  Audience,
  Capabilities,
  Recommendation,
  RiskLevel,
  SecurityFinding,
  SecurityReport,
  Severity,
  StorageKind,
} from "./types";
export { RUNTIME_MATRIX, listAvailableCapabilities } from "./capability";

/** 解析対象の上限。これを超えた分は切り捨てて truncated を立てる */
const MAX_SCAN_LENGTH = 1_000_000;

const SCRIPT_RE = /<script\b([^>]*)>([\s\S]{0,200000}?)<\/script\s*>/gi;
const INLINE_HANDLER_RE = /\son[a-z]{3,20}\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const JAVASCRIPT_URI_RE = /(?:href|src|action|formaction)\s*=\s*(?:"javascript:([^"]*)"|'javascript:([^']*)')/gi;

const DISCLAIMER =
  "この結果は公開前の可視化であり、安全性の保証ではありません。検出0件であっても安全とは限りません。";

/**
 * Phase 1 の静的解析が原理的に検出できない範囲。
 * advisory方式は「検出0件＝安全」と解釈された時点で価値がマイナスになるため、
 * 出力に必ず含める。
 */
const LIMITATIONS = [
  "文字列連結・間接呼び出し・難読化されたコード（window['fe'+'tch'] 等）は検出できません",
  "実行時に組み立てられるURLや、動的に生成されるAPIリクエストは検出できません",
  "外部Script（CDN）の中身は取得・解析していません",
  "data: / blob: URI に埋め込まれたHTML・スクリプトの中身は解析していません",
  "Secret検出はプロバイダ既知のプレフィックスのみが対象で、汎用的なトークンは検出できません",
  "source（保存データ）から sink（外部通信）へのデータフロー解析は行っていません",
];

export interface ScanOptions {
  /**
   * HTML Publisher自身のオリジン。指定すると、自オリジンを指す絶対URLも
   * 同一オリジンリクエストとして分類する。
   */
  selfOrigin?: string;
}

function buildContext(rawHtml: string): ScanContext {
  const truncated = rawHtml.length > MAX_SCAN_LENGTH;
  const html = truncated ? rawHtml.slice(0, MAX_SCAN_LENGTH) : rawHtml;

  const scripts: string[] = [];
  SCRIPT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SCRIPT_RE.exec(html)) !== null) {
    const attrs = match[1] ?? "";
    // src付きのscriptは中身が無い（外部Script側で別途検出する）
    if (/\bsrc\s*=/i.test(attrs)) continue;
    scripts.push(match[2] ?? "");
  }

  const handlers: string[] = [];
  for (const re of [INLINE_HANDLER_RE, JAVASCRIPT_URI_RE]) {
    re.lastIndex = 0;
    let hit: RegExpExecArray | null;
    while ((hit = re.exec(html)) !== null) {
      handlers.push(hit[1] ?? hit[2] ?? "");
    }
  }

  const scriptCode = scripts.join("\n");
  return {
    html,
    scriptCode,
    // on*属性 / javascript: URI もJSとして実行されるため、コード解析の対象に含める
    code: [scriptCode, ...handlers].join("\n"),
    truncated,
  };
}

function toRiskLevel(summary: Record<Severity, number>): RiskLevel {
  if (summary.high > 0) return "high";
  if (summary.medium > 0) return "medium";
  return "low";
}

/**
 * HTMLを静的解析し、そのHTMLが要求する機能・外部依存・リスクを可視化する。
 * 脆弱性の完全判定は目的ではない。
 */
export function scanHtml(html: string, options: ScanOptions = {}): SecurityReport {
  const ctx = buildContext(html);
  const refs = extractUrlRefs(ctx, options.selfOrigin);
  const signals = detectSignals(ctx, refs);
  const capabilities = toCapabilities(signals);
  const findings = evaluateRules(ctx, signals, refs);

  const summary: Record<Severity, number> = { high: 0, medium: 0, info: 0 };
  for (const finding of findings) summary[finding.severity] += 1;

  const limitations = [...LIMITATIONS];
  if (ctx.truncated) {
    limitations.unshift(
      `HTMLが${MAX_SCAN_LENGTH.toLocaleString()}文字を超えたため、以降は解析していません`
    );
  }

  return {
    risk: toRiskLevel(summary),
    summary,
    findings,
    capabilities,
    externalDomains: collectExternalDomains(refs),
    recommendation: deriveRecommendation(capabilities),
    limitations,
    disclaimer: DISCLAIMER,
  };
}
