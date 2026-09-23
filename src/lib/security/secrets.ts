// Secret 検出（Phase 3 / #11）。
//
// 公開されたら即被害になるため、公開前チェックで最も価値が高いのがここ。
// ただし「すべてのキーらしき値をHIGHにする」と実用性が落ちるため、
//   - プロバイダ判定（何のキーらしいか）
//   - 公開前提キーの許可リスト（Firebase Web APIキー等）
//   - プレースホルダ判定・エントロピー閾値・data URI の除外
// をセットで実装する。
//
// Gitleaks の CLI はランタイムでは使わない（バイナリ 20MB・1回あたり約220ms）。
// 代わりに gitleaks のルール定義（正規表現）を参考に、必要なものだけ Node 実装で持つ。

import type { SecurityFinding, Severity } from "./types";

interface ProviderRule {
  id: string;
  provider: string;
  re: RegExp;
  severity: Severity;
  /** 公開前提のキーなど、扱いに注意が要るものへの補足 */
  note?: string;
  /** マッチした値に要求する最低エントロピー（未指定なら検査しない） */
  minEntropy?: number;
}

/**
 * プロバイダ固有のキー。プレフィックスで一意に判別できるものだけを載せる。
 * severity は「公開された時点で被害が確定するか」で決める。
 */
const PROVIDER_RULES: ProviderRule[] = [
  // --- 秘匿必須（HIGH）---
  { id: "openai", provider: "OpenAI APIキー", re: /\bsk-proj-[A-Za-z0-9_-]{20,}/g, severity: "high", minEntropy: 3.5 },
  { id: "anthropic", provider: "Anthropic APIキー", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g, severity: "high", minEntropy: 3.5 },
  { id: "openai-legacy", provider: "OpenAI 互換APIキー", re: /\bsk-[A-Za-z0-9]{32,}/g, severity: "high", minEntropy: 3.5 },
  { id: "github-pat", provider: "GitHub トークン", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g, severity: "high", minEntropy: 3.5 },
  { id: "github-fine", provider: "GitHub fine-grained PAT", re: /\bgithub_pat_[A-Za-z0-9_]{30,}\b/g, severity: "high", minEntropy: 3.5 },
  { id: "gitlab", provider: "GitLab PAT", re: /\bglpat-[A-Za-z0-9_-]{18,}\b/g, severity: "high", minEntropy: 3.5 },
  { id: "slack-token", provider: "Slack トークン", re: /\bxox[baprs]-[A-Za-z0-9-]{12,}/g, severity: "high", minEntropy: 3 },
  { id: "slack-app", provider: "Slack app-level トークン", re: /\bxapp-\d-[A-Za-z0-9-]{12,}/g, severity: "high", minEntropy: 3 },
  { id: "slack-webhook", provider: "Slack Incoming Webhook URL", re: /https:\/\/hooks\.slack\.com\/services\/T[A-Za-z0-9_-]{6,}\/B[A-Za-z0-9_-]{6,}\/[A-Za-z0-9_-]{16,}/g, severity: "high" },
  { id: "discord-webhook", provider: "Discord Webhook URL", re: /https:\/\/discord(?:app)?\.com\/api\/webhooks\/\d{10,}\/[A-Za-z0-9_-]{20,}/g, severity: "high" },
  { id: "aws-access-key", provider: "AWS アクセスキーID", re: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g, severity: "high" },
  { id: "stripe-secret", provider: "Stripe シークレットキー", re: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/g, severity: "high", minEntropy: 3.5 },
  { id: "sendgrid", provider: "SendGrid APIキー", re: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g, severity: "high", minEntropy: 3.5 },
  { id: "google-oauth-secret", provider: "Google OAuth クライアントシークレット", re: /\bGOCSPX-[A-Za-z0-9_-]{20,}\b/g, severity: "high", minEntropy: 3 },
  { id: "npm-token", provider: "npm トークン", re: /\bnpm_[A-Za-z0-9]{30,}\b/g, severity: "high", minEntropy: 3.5 },
  { id: "telegram-bot", provider: "Telegram Bot トークン", re: /\b\d{8,12}:AA[A-Za-z0-9_-]{30,}\b/g, severity: "high", minEntropy: 3.5 },
  { id: "twilio", provider: "Twilio APIキー", re: /\bSK[0-9a-fA-F]{32}\b/g, severity: "high", minEntropy: 3 },
  { id: "mailgun", provider: "Mailgun APIキー", re: /\bkey-[0-9a-zA-Z]{32}\b/g, severity: "high", minEntropy: 3 },
  { id: "square", provider: "Square アクセストークン", re: /\b(?:sq0atp|sq0csp|EAAA)[A-Za-z0-9_-]{20,}\b/g, severity: "high", minEntropy: 3.5 },
  { id: "private-key", provider: "秘密鍵ブロック", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/g, severity: "high" },

  // --- 公開前提・テスト用（MEDIUM）---
  {
    id: "google-api-key",
    provider: "Google APIキー",
    re: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    severity: "medium",
    note: "Firebase Web APIキーや Maps のキーは公開前提のため、そのままでも問題ない場合がある。リファラ制限やAPI制限の設定を確認すること",
  },
  {
    id: "stripe-publishable",
    provider: "Stripe 公開可能キー",
    re: /\bpk_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
    severity: "medium",
    note: "公開可能キー（publishable key）のため露出自体は想定内。秘密キー（sk_）と取り違えていないかだけ確認すること",
  },
  {
    id: "stripe-test",
    provider: "Stripe テストキー",
    re: /\b(?:sk|rk)_test_[A-Za-z0-9]{16,}\b/g,
    severity: "medium",
    note: "テスト環境用キーのため実害は限定的だが、公開前に意図を確認すること",
  },
];

/** シークレットらしさを示す変数名・キー名 */
const SECRET_KEYWORD =
  /(?:api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token|secret[_-]?key|client[_-]?secret|private[_-]?key|password|passwd|credential|secret|token|bearer)/i;

/** `apiKey: "..."` / `const secret = '...'` 形式の汎用検出 */
const ASSIGNMENT_RE =
  /([A-Za-z_][A-Za-z0-9_-]{2,40})\s*[:=]\s*(["'`])([^"'`\n]{16,200})\2/g;

/** 接続文字列やURLに埋め込まれた認証情報 */
const CONNECTION_STRING_RE =
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|rediss|amqps?|ftp|https?):\/\/[^:@\s/"'`]{1,64}:([^@\s/"'`]{8,})@/gi;

/** JWT（ヘッダが base64url の `eyJ` で始まる3パート） */
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,}\b/g;

/** サンプル・プレースホルダとして書かれた値 */
const PLACEHOLDER_RE =
  /example|dummy|placeholder|your[_-]?|sample|test[_-]?key|xxxx+|0000+|replace[_-]?me|changeme|<[^>]+>|\{\{.*\}\}|\$\{/i;

/** ハッシュ値・UUID・16進の羅列は秘密情報ではない */
const HASH_LIKE_RE = /^[0-9a-f]{32,128}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** data URI / SRI integrity 属性は Base64 の塊なので汎用検出の対象から外す */
const NOISE_BLOCKS_RE =
  /data:[a-z-]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+|integrity\s*=\s*["'][^"']*["']/gi;

/** Shannon エントロピー（bit/文字）。base62のランダム列はおよそ 5.0 前後になる */
export function shannonEntropy(value: string): number {
  if (!value) return 0;
  const freq = new Map<string, number>();
  for (const ch of value) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/** 12345678… のように値全体が連番になっているもの */
function isSequential(value: string): boolean {
  if (value.length < 8) return false;
  for (let i = 1; i < value.length; i++) {
    if (value.charCodeAt(i) !== value.charCodeAt(i - 1) + 1) return false;
  }
  return true;
}

function isPlaceholder(value: string): boolean {
  if (PLACEHOLDER_RE.test(value)) return true;
  if (isSequential(value)) return true;
  // プレフィックスを除いた本体が同一文字の繰り返し
  const body = value.replace(/^[A-Za-z_-]+[-_]/, "");
  return /^(.)\1+$/.test(body);
}

/** 秘密情報ではないと分かっている形式 */
function isKnownNonSecret(value: string): boolean {
  return HASH_LIKE_RE.test(value) || UUID_RE.test(value) || /^#?[0-9a-f]{3,8}$/i.test(value);
}

function mask(value: string): string {
  return `${value.slice(0, 6)}…（${value.length}文字）`;
}

/** 汎用検出の対象から除外するブロック（Base64画像・フォント・SRI）を空白で潰す */
function stripNoiseBlocks(html: string): string {
  return html.replace(NOISE_BLOCKS_RE, (match) => " ".repeat(Math.min(match.length, 4)));
}

interface Hit {
  provider: string;
  severity: Severity;
  value: string;
  note?: string;
}

function scanProviderRules(html: string, hits: Hit[]): void {
  for (const rule of PROVIDER_RULES) {
    rule.re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rule.re.exec(html)) !== null) {
      const value = match[0];
      if (isPlaceholder(value)) continue;
      if (rule.minEntropy !== undefined && shannonEntropy(value) < rule.minEntropy) continue;
      hits.push({ provider: rule.provider, severity: rule.severity, value, note: rule.note });
    }
  }
}

function scanConnectionStrings(html: string, hits: Hit[]): void {
  CONNECTION_STRING_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CONNECTION_STRING_RE.exec(html)) !== null) {
    const password = match[1];
    if (isPlaceholder(password)) continue;
    hits.push({
      provider: "接続文字列に埋め込まれた認証情報",
      severity: "high",
      value: match[0],
      note: "URLに含まれるパスワードは公開HTMLからそのまま読み取れる",
    });
  }
}

function scanJwt(html: string, hits: Hit[]): void {
  JWT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = JWT_RE.exec(html)) !== null) {
    if (isPlaceholder(match[0])) continue;
    hits.push({
      provider: "JWT",
      severity: "high",
      value: match[0],
      note: "署名付きトークンは有効期限内であればそのまま利用できる。公開前提のトークン（Supabase anon key 等）かどうかを確認すること",
    });
  }
}

/**
 * 変数名がシークレットらしく、値のエントロピーが高いものを検出する。
 * プロバイダ固有のプレフィックスを持たないキーはこの経路で拾う。
 */
function scanGenericAssignments(html: string, hits: Hit[], seen: Set<string>): void {
  const source = stripNoiseBlocks(html);
  ASSIGNMENT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = ASSIGNMENT_RE.exec(source)) !== null) {
    const [, name, , value] = match;
    if (!SECRET_KEYWORD.test(name)) continue;
    if (seen.has(value)) continue;
    if (isPlaceholder(value)) continue;
    if (isKnownNonSecret(value)) continue;
    // URLやパスは秘密情報ではない（接続文字列は専用ルールが扱う）
    if (/^(?:https?:)?\/\//i.test(value) && !CONNECTION_STRING_RE.test(value)) continue;
    if (/\s/.test(value)) continue;
    // base62 相当のランダム列は 5 前後。日本語文や英単語の連なりは 4 未満に収まる
    if (shannonEntropy(value) < 4) continue;

    hits.push({
      provider: `シークレットらしき値（変数名: ${name}）`,
      severity: "high",
      value,
      note: "プロバイダを特定できないが、変数名と値のランダム性からキーの可能性が高い",
    });
  }
}

/**
 * HTML から秘密情報らしき値を検出する。
 * 同じ値が複数のルールに当たった場合は、より重い severity のものだけを残す。
 */
export function scanSecrets(html: string): SecurityFinding[] {
  const hits: Hit[] = [];
  scanProviderRules(html, hits);
  scanConnectionStrings(html, hits);
  scanJwt(html, hits);

  // プロバイダ判定できた値は汎用検出で二重に報告しない
  const identified = new Set(hits.map((h) => h.value));
  scanGenericAssignments(html, hits, identified);

  // プロバイダ単位にまとめる
  const byProvider = new Map<string, { severity: Severity; note?: string; values: Set<string> }>();
  for (const hit of hits) {
    const entry = byProvider.get(hit.provider) ?? {
      severity: hit.severity,
      note: hit.note,
      values: new Set<string>(),
    };
    // 同じプロバイダで severity が割れた場合は重い方を採用する
    if (entry.severity !== "high" && hit.severity === "high") entry.severity = "high";
    entry.values.add(hit.value);
    byProvider.set(hit.provider, entry);
  }

  return [...byProvider.entries()].map(([provider, entry]) => ({
    id: "hardcoded-secret",
    severity: entry.severity,
    audience: ["publisher" as const],
    message: `${provider}らしき値がHTML内に含まれています。公開HTMLは閲覧者が全文を読めるため、値はそのまま露出します${entry.note ? `。${entry.note}` : ""}`,
    target: provider,
    evidence: [...entry.values].slice(0, 3).map(mask).join(", "),
    count: entry.values.size,
  }));
}
