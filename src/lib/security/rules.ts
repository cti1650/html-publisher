// 検出ルール。severity は「分類」ではなく
// 「リスクの受け手 / データが外へ出るか」で決める。
//
//   HIGH   ... 公開した時点で被害が確定する（秘密情報の露出、オリジンの掌握、入力の外部送信）
//   MEDIUM ... 内容次第で被害になりうる（外部通信、動的コード実行、リダイレクト）
//   INFO   ... 機能を使っているだけ（storage / camera / CDN取得）
//
// INFO を「危険」として扱わないこと。Camera を使うHTMLは detected であって dangerous ではない。

import type { ScanContext, SecurityFinding, Severity, Signals, UrlRef } from "./types";
import { isNetworkSink, isSelfApiRequest } from "./external-resources";

// ---------------------------------------------------------------------------
// Secret検出
// ---------------------------------------------------------------------------

interface SecretPattern {
  provider: string;
  re: RegExp;
  severity: Severity;
  note?: string;
}

/**
 * Phase 1 の secret 検出はプロバイダ既知のプレフィックスに限定する。
 * エントロピーベースの汎用検出は誤検知が多く、#13 のenforcementに進めなくなるため、
 * HIGH は「誤検知したら公開を止めてよい」精度のものだけに絞る（精度向上は #11）。
 */
const SECRET_PATTERNS: SecretPattern[] = [
  { provider: "OpenAI / Anthropic APIキー", re: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{24,}/g, severity: "high" },
  { provider: "GitHub トークン", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g, severity: "high" },
  { provider: "GitHub fine-grained PAT", re: /\bgithub_pat_[A-Za-z0-9_]{30,}\b/g, severity: "high" },
  { provider: "Slack トークン", re: /\bxox[baprs]-[A-Za-z0-9-]{12,}/g, severity: "high" },
  { provider: "Slack app-level トークン", re: /\bxapp-\d-[A-Za-z0-9-]{12,}/g, severity: "high" },
  { provider: "AWS アクセスキーID", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, severity: "high" },
  { provider: "Stripe シークレットキー", re: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/g, severity: "high" },
  { provider: "GitLab PAT", re: /\bglpat-[A-Za-z0-9_-]{18,}\b/g, severity: "high" },
  {
    provider: "SendGrid APIキー",
    re: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g,
    severity: "high",
  },
  {
    provider: "秘密鍵ブロック",
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
    severity: "high",
  },
  {
    provider: "Stripe テストキー",
    re: /\b(?:sk|rk)_test_[A-Za-z0-9]{16,}\b/g,
    severity: "medium",
    note: "テスト環境用キーのため実害は限定的だが、公開前に意図を確認すること",
  },
  {
    provider: "Google APIキー",
    re: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    severity: "medium",
    note: "Firebase Web APIキー等の公開前提のキーである可能性がある。リファラ制限の有無を確認すること",
  },
];

/** サンプル・プレースホルダとして書かれた値を除外する */
const PLACEHOLDER_RE = /example|dummy|placeholder|your[_-]?|sample|xxxx+|0000+|replace[_-]?me|<[^>]+>/i;

function isPlaceholder(value: string): boolean {
  if (PLACEHOLDER_RE.test(value)) return true;
  // 同一文字の繰り返しだけで構成されている
  const body = value.replace(/^[A-Za-z_-]+[-_]/, "");
  return /^(.)\1+$/.test(body);
}

function maskSecret(value: string): string {
  const head = value.slice(0, 6);
  return `${head}…（${value.length}文字）`;
}

function scanSecrets(html: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  for (const pattern of SECRET_PATTERNS) {
    pattern.re.lastIndex = 0;
    const hits = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = pattern.re.exec(html)) !== null) {
      if (!isPlaceholder(match[0])) hits.add(match[0]);
    }
    if (hits.size === 0) continue;

    findings.push({
      id: "hardcoded-secret",
      severity: pattern.severity,
      audience: ["publisher"],
      message: `${pattern.provider}らしき値がHTML内に含まれています。公開HTMLは閲覧者が全文を読めるため、キーは露出します${pattern.note ? `。${pattern.note}` : ""}`,
      target: pattern.provider,
      evidence: [...hits].slice(0, 3).map(maskSecret).join(", "),
      count: hits.size,
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// URL由来のルール
// ---------------------------------------------------------------------------

function uniqueTargets(refs: UrlRef[]): string[] {
  return [...new Set(refs.map((ref) => ref.host ?? ref.raw))];
}

function urlFindings(refs: UrlRef[], signals: Signals): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  // 同一オリジンAPIへのリクエスト
  // 公開HTMLは publisher と同一オリジンで動くため、HTML Publisher自身のAPIを叩ける
  const selfApi = refs.filter((ref) => isNetworkSink(ref) && isSelfApiRequest(ref));
  if (selfApi.length > 0) {
    findings.push({
      id: "same-origin-api-request",
      severity: "high",
      audience: ["service", "publisher"],
      message:
        "HTML Publisher自身のAPI（/api/配下）へのリクエストが含まれています。非trustモードでは opaque origin のためクロスオリジン扱いとなり応答を読めませんが、trustモードで公開した場合は他のツールの取得・作成・更新が可能になります",
      target: uniqueTargets(selfApi).join(", "),
      count: selfApi.length,
    });
  }

  // 同一オリジンへのその他のリクエスト
  const selfOther = refs.filter(
    (ref) => isNetworkSink(ref) && ref.kind === "same-origin" && !isSelfApiRequest(ref)
  );
  if (selfOther.length > 0) {
    findings.push({
      id: "same-origin-request",
      severity: "medium",
      audience: ["service"],
      message:
        "相対URLへのリクエストが含まれています。公開HTMLは単一ファイル完結が前提で、非trustモードでは opaque origin のため同一オリジン扱いにならず失敗します。参照している意図を確認してください",
      target: uniqueTargets(selfOther).join(", "),
      count: selfOther.length,
    });
  }

  // 外部への通信
  const externalSinks = refs.filter((ref) => isNetworkSink(ref) && ref.kind === "external");
  if (externalSinks.length > 0) {
    findings.push({
      id: "external-request",
      severity: "medium",
      audience: ["viewer", "publisher"],
      message: "外部ドメインへのネットワークリクエストが含まれています。送信先と送信内容を確認してください",
      target: uniqueTargets(externalSinks).join(", "),
      count: externalSinks.length,
    });
  }

  // 外部Script（実行コードを外部から取り込む）
  const externalScripts = refs.filter(
    (ref) => ref.kind === "external" && (ref.origin === "script[src]" || ref.origin === "js[import]")
  );
  if (externalScripts.length > 0) {
    findings.push({
      id: "external-script",
      severity: "medium",
      audience: ["viewer", "publisher"],
      message:
        "外部ドメインのスクリプトを読み込んでいます。CDNの内容は解析対象外のため、配信元が信頼できるかを確認してください",
      target: uniqueTargets(externalScripts).join(", "),
      count: externalScripts.length,
    });
  }

  // 外部へのフォーム送信
  const externalForms = refs.filter(
    (ref) =>
      ref.kind === "external" && (ref.origin === "form[action]" || ref.origin.includes("formaction"))
  );
  if (externalForms.length > 0) {
    const hasCredentialInput = signals.passwordInput > 0;
    findings.push({
      id: "external-form",
      severity: hasCredentialInput ? "high" : "medium",
      audience: ["viewer"],
      message: hasCredentialInput
        ? "パスワード入力欄を持つフォームが外部ドメインへ送信されます。閲覧者の資格情報が第三者に渡ります"
        : "フォームの送信先が外部ドメインです。閲覧者の入力内容が第三者へ送信されます",
      target: uniqueTargets(externalForms).join(", "),
      count: externalForms.length,
    });
  }

  // 外部リソース（CSS / フォント / 画像）は機能利用であってリスクではない
  const externalResources = refs.filter(
    (ref) =>
      ref.kind === "external" &&
      !isNetworkSink(ref) &&
      ref.origin !== "script[src]" &&
      ref.origin !== "form[action]" &&
      // meta refresh の遷移先は redirect ルールで扱うため重複させない
      !ref.origin.includes("meta-refresh")
  );
  if (externalResources.length > 0) {
    findings.push({
      id: "external-resource",
      severity: "info",
      audience: ["viewer"],
      message: "外部ドメインのリソース（CSS / フォント / 画像等）を参照しています",
      target: uniqueTargets(externalResources).join(", "),
      count: externalResources.length,
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// コード由来のルール
// ---------------------------------------------------------------------------

function codeFindings(ctx: ScanContext, signals: Signals): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const evidenceOf = (key: string): string | undefined => signals.evidence[key]?.[0];

  if (signals.frameAccess > 0) {
    findings.push({
      id: "frame-access",
      severity: "high",
      audience: ["service"],
      message:
        "親フレーム（parent / top / frameElement）へのアクセスが含まれています。非trustモードでは opaque origin のためブロックされますが、sandboxの外に出ようとするコードは意図を確認してください。trustモードではiframeを経由しないため制限なく成立します",
      evidence: evidenceOf("frameAccess"),
      count: signals.frameAccess,
    });
  }

  if (signals.cookieAccess > 0) {
    findings.push({
      id: "cookie-access",
      severity: "high",
      audience: ["service", "publisher"],
      message:
        "document.cookie へのアクセスが含まれています。非trustモードでは opaque origin のため読み書きできませんが、trustモードで公開した場合は publisherオリジンのCookieに到達します",
      evidence: evidenceOf("cookieAccess"),
      count: signals.cookieAccess,
    });
  }

  if (signals.dynamicCode > 0) {
    findings.push({
      id: "dynamic-code",
      severity: "medium",
      audience: ["viewer"],
      message:
        "eval / new Function 等の動的コード実行が含まれています。Babel standalone や Tailwind browser 版も内部で使うため、それらのCDNを読み込んでいる場合は正常です。実行する文字列が外部入力由来でないかを確認してください",
      evidence: evidenceOf("dynamicCode"),
      count: signals.dynamicCode,
    });
  }

  if (signals.serviceWorker > 0) {
    findings.push({
      id: "service-worker",
      severity: "medium",
      audience: ["service", "viewer"],
      message:
        "Service Worker の登録が含まれています。非trustモードでは opaque origin のため登録できません。trustモードで公開した場合は publisherオリジンに登録され、ページを離れても該当スコープのリクエストに介入し続けます",
      evidence: evidenceOf("serviceWorker"),
      count: signals.serviceWorker,
    });
  }

  if (signals.redirect > 0 || signals.metaRefresh > 0) {
    findings.push({
      id: "redirect",
      severity: "medium",
      audience: ["viewer"],
      message:
        "location の変更または meta refresh によるリダイレクトが含まれています。遷移先が意図したものか確認してください",
      evidence: evidenceOf("redirect") ?? evidenceOf("metaRefresh"),
      count: signals.redirect + signals.metaRefresh,
    });
  }

  if (signals.embeddedFrame > 0) {
    findings.push({
      id: "embedded-frame",
      severity: "medium",
      audience: ["viewer"],
      message:
        "iframe / embed / object による外部コンテンツの埋め込みが含まれています。埋め込み先の内容は解析対象外です",
      evidence: evidenceOf("embeddedFrame"),
      count: signals.embeddedFrame,
    });
  }

  if (signals.javascriptUri > 0) {
    findings.push({
      id: "javascript-uri",
      severity: "medium",
      audience: ["viewer"],
      message:
        "javascript: URI が含まれています。リンク先やsrcが動的に組み立てられている場合、意図しないコードが実行される経路になります",
      evidence: evidenceOf("javascriptUri"),
      count: signals.javascriptUri,
    });
  }

  if (signals.inlineEventHandler > 0) {
    findings.push({
      id: "inline-event-handler",
      severity: "medium",
      audience: ["viewer"],
      message:
        "インラインイベントハンドラ（on*属性）が含まれています。属性値に外部入力が混ざるとそのままコードとして実行されるため、値の組み立て方を確認してください",
      evidence: evidenceOf("inlineEventHandler"),
      count: signals.inlineEventHandler,
    });
  }

  if (signals.svgScript > 0) {
    findings.push({
      id: "svg-script",
      severity: "medium",
      audience: ["viewer"],
      message:
        "SVG内に script が含まれています。通常のscriptタグ検査では見落とされやすい実行経路です",
      count: signals.svgScript,
    });
  }

  // source（storage / cookie）→ sink（外部通信）の組み合わせ。
  // Phase 1 は正規表現ベースのためデータフローは追えない。
  // 「組み合わせが存在する」ことのみを示し、確定扱いしない（データフロー解析は #10）。
  if (signals.storage.length > 0 && signals.externalNetworkSink > 0) {
    findings.push({
      id: "storage-exfiltration-pattern",
      severity: "medium",
      audience: ["viewer", "publisher"],
      message: `保存データ（${signals.storage.join(" / ")}）の利用と外部通信の両方が含まれています。保存内容が外部へ送信されていないか確認してください（Phase 1 はデータフロー解析を行わないため、組み合わせの存在のみを示しています）`,
      count: signals.storage.length,
    });
  }

  if (signals.storage.length > 0) {
    findings.push({
      id: "storage-usage",
      severity: "info",
      audience: ["viewer"],
      message: `Storage API を利用しています（${signals.storage.join(" / ")}）。非trustモードでは opaque origin のため利用できません。trustモードで公開する場合、保存領域は publisherオリジンの他のツールと共有されます`,
      count: signals.storage.length,
    });
  }

  if (signals.mediaDevices > 0 || signals.geolocation > 0) {
    const kinds = [
      signals.camera ? "カメラ" : null,
      signals.microphone ? "マイク" : null,
      signals.mediaDevices > 0 && !signals.camera && !signals.microphone ? "メディアデバイス" : null,
      signals.geolocation > 0 ? "位置情報" : null,
    ].filter(Boolean);
    findings.push({
      id: "device-access",
      severity: "info",
      audience: ["viewer"],
      message: `デバイス機能の利用を検出しました（${kinds.join(" / ")}）。非trustモードでは opaque origin のため権限が下りないため、利用するには trust: true が必要です`,
      count: signals.mediaDevices + signals.geolocation,
    });
  }

  if (signals.clipboard > 0) {
    findings.push({
      id: "clipboard-access",
      severity: "info",
      audience: ["viewer"],
      message: "クリップボードの読み書きを検出しました",
      evidence: evidenceOf("clipboard"),
      count: signals.clipboard,
    });
  }

  return findings;
}

export function evaluateRules(
  ctx: ScanContext,
  signals: Signals,
  refs: UrlRef[]
): SecurityFinding[] {
  const order: Record<Severity, number> = { high: 0, medium: 1, info: 2 };
  return [...scanSecrets(ctx.html), ...urlFindings(refs, signals), ...codeFindings(ctx, signals)].sort(
    (a, b) => order[a.severity] - order[b.severity]
  );
}
