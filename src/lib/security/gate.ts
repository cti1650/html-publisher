// create_tool / update_tool の公開前チェック（#13）。
//
// security_check は独立したツールのため、AIが呼ばずに create_tool へ進むことを防げない。
// そこで HIGH の findings がある場合のみ、confirm_security: true を要求する。
// confirm_trust と同じパターンで、ユーザー確認を挟ませるのが目的。
//
// MEDIUM / INFO はブロックしない。誤検知で正当なHTMLが公開できなくなる体験を避けるため、
// 止めるのは「公開した時点で被害が確定する」HIGH だけに限定する。

import { scanHtml } from "./index";
import type { SecurityReport, Severity } from "./types";

/** レスポンスに添えるコンパクトな要約（HTML全文やevidenceは含めない） */
export interface SecuritySummary {
  risk: SecurityReport["risk"];
  summary: Record<Severity, number>;
  /** HIGH / MEDIUM のみ。INFO は要約に含めない */
  findings: { id: string; severity: Severity; message: string; target?: string }[];
  recommendation: SecurityReport["recommendation"];
}

export interface SecurityGateResult {
  /** true の場合は公開せずエラーを返す */
  blocked: boolean;
  summary: SecuritySummary;
  /** blocked === true のときにAIへ返すメッセージ */
  message?: string;
}

export interface SecurityGateOptions {
  selfOrigin?: string;
  /** 呼び出し側が confirm_security: true を指定したか */
  confirmed?: boolean;
}

function toSummary(report: SecurityReport): SecuritySummary {
  return {
    risk: report.risk,
    summary: report.summary,
    findings: report.findings
      .filter((f) => f.severity !== "info")
      .map((f) => ({ id: f.id, severity: f.severity, message: f.message, target: f.target })),
    recommendation: report.recommendation,
  };
}

/**
 * 公開前にHTMLを解析し、ブロックすべきか判定する。
 *
 * - HIGH が無ければ常に通す（既存クライアントは引数を追加せずに動き続ける）
 * - HIGH があり confirm_security が無ければブロックする
 * - HIGH があっても confirm_security: true なら通す
 */
export function evaluateSecurityGate(
  html: string,
  options: SecurityGateOptions = {}
): SecurityGateResult {
  const report = scanHtml(html, { selfOrigin: options.selfOrigin });
  const summary = toSummary(report);

  if (report.summary.high === 0 || options.confirmed === true) {
    return { blocked: false, summary };
  }

  const highlights = summary.findings
    .filter((f) => f.severity === "high")
    .map((f) => `- ${f.id}${f.target ? `（${f.target}）` : ""}: ${f.message}`)
    .join("\n");

  return {
    blocked: true,
    summary,
    message: [
      `公開前チェックで HIGH の検出が ${report.summary.high} 件ありました。内容をユーザーに説明し、判断を仰いでください。`,
      "",
      highlights,
      "",
      "修正して再実行するか、意図的なものであればユーザーの承認を得たうえで confirm_security: true を指定して再実行してください。",
      `※ ${report.disclaimer}`,
    ].join("\n"),
  };
}
