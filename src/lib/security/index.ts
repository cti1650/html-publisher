// 公開前HTML静的解析のエントリポイント。
//
// MCP側（src/app/api/mcp/[transport]/route.ts）は scanHtml() を呼ぶだけにする。
// 解析エンジンを Semgrep / Gitleaks 等へ差し替える場合（#10 / #11）も、
// 差し替えはこのモジュールの内側に閉じ込め、SecurityReport の形は変えない。

import { deriveRecommendation, detectSignals, toCapabilities } from "./capability";
import { classifyUrl, collectExternalDomains, extractUrlRefs } from "./external-resources";
import { analyzeJsSources, extractEmbeddedHtml } from "./js-ast";
import { evaluateRules } from "./rules";
import type { RiskLevel, ScanContext, SecurityFinding, SecurityReport, Severity } from "./types";

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
/** data: URI / srcdoc に埋め込まれたHTMLを再帰的に追う深さの上限 */
const MAX_EMBED_DEPTH = 2;

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, info: 2 };

const SCRIPT_RE = /<script\b([^>]*)>([\s\S]{0,200000}?)<\/script\s*>/gi;
const INLINE_HANDLER_RE = /\son[a-z]{3,20}\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const JAVASCRIPT_URI_RE = /(?:href|src|action|formaction)\s*=\s*(?:"javascript:([^"]*)"|'javascript:([^']*)')/gi;

const DISCLAIMER =
  "この結果は公開前の可視化であり、安全性の保証ではありません。検出0件であっても安全とは限りません。";

/**
 * この静的解析が原理的に検出できない範囲。
 * advisory方式は「検出0件＝安全」と解釈された時点で価値がマイナスになるため、
 * 出力に必ず含める。
 */
const LIMITATIONS = [
  "外部Script（CDN）の中身は取得・解析していません",
  "実行時にしか値が決まらないURL（ユーザー入力・APIレスポンス由来など）の宛先は特定できません",
  "スコープを跨いだ変数の再代入や、関数の戻り値を経由した間接参照は追跡していません",
  "Secret検出はプロバイダ既知のプレフィックスのみが対象で、汎用的なトークンは検出できません",
  "source（保存データ）から sink（外部通信）へのデータフロー解析は行っていません",
  "構文エラーで解析できないスクリプトは、精度の低い正規表現での検出に切り替わります",
];

export interface ScanOptions {
  /**
   * HTML Publisher自身のオリジン。指定すると、自オリジンを指す絶対URLも
   * 同一オリジンリクエストとして分類する。
   */
  selfOrigin?: string;
  /** 埋め込みHTMLを再帰解析する際の深さ（内部利用） */
  depth?: number;
}

function buildContext(rawHtml: string, unparsed: string[] = []): ScanContext {
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
  // on*属性 / javascript: URI もJSとして実行されるため、コード解析の対象に含める
  const jsSources = [...scripts, ...handlers].filter((source) => source.trim().length > 0);

  return {
    html,
    scriptCode,
    code: [scriptCode, ...handlers].join("\n"),
    jsSources,
    unparsedCode: unparsed.join("\n"),
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
  // 1回目は AST 解析でパース可否を判定するためだけに組み立てる
  const probe = buildContext(html);
  const analysis = analyzeJsSources(probe.jsSources);
  // 2回目はパースできなかった断片だけを正規表現の対象として組み立て直す
  const ctx = buildContext(html, analysis.unparsed);

  const refs = [...extractUrlRefs(ctx, options.selfOrigin)];
  // AST が畳み込んだURL（実行時に組み立てられるURLを含む）を合流させる
  for (const seed of analysis.urls) {
    const { kind, host } = classifyUrl(seed.raw, options.selfOrigin);
    refs.push({ ...seed, kind, host });
  }

  // data: URI / srcdoc に埋め込まれたHTMLも解析対象にする（Phase 1 の限界だった項目）
  const depth = options.depth ?? 0;
  const embeddedFindings: SecurityFinding[] = [];
  const embeddedDomains: string[] = [];
  if (depth < MAX_EMBED_DEPTH) {
    for (const embedded of extractEmbeddedHtml(ctx.html)) {
      const inner = scanHtml(embedded, { ...options, depth: depth + 1 });
      for (const finding of inner.findings) {
        embeddedFindings.push({
          ...finding,
          message: `${finding.message}（埋め込みHTML内で検出）`,
        });
      }
      embeddedDomains.push(...inner.externalDomains);
    }
  }

  const signals = detectSignals(ctx, refs, analysis.signals);
  const capabilities = toCapabilities(signals);
  const own = evaluateRules(ctx, signals, refs);
  // 埋め込みHTML由来の finding は、同じ id が外側に無い場合だけ足す
  const findings = [
    ...own,
    ...embeddedFindings.filter((f) => !own.some((o) => o.id === f.id)),
  ].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

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
    externalDomains: [...new Set([...collectExternalDomains(refs), ...embeddedDomains])].sort(),
    recommendation: deriveRecommendation(capabilities),
    limitations,
    disclaimer: DISCLAIMER,
  };
}
