// 公開前HTML静的解析（security_check）の型定義。
// MCPツールの入出力はこのファイルの SecurityReport に固定する。
// 解析エンジンを差し替えても（#10 / #11）この形は変えない。

export type Severity = "high" | "medium" | "info";

export type RiskLevel = "high" | "medium" | "low";

/**
 * そのfindingで不利益を被るのが誰かを示す。
 * severityは「分類」ではなく「リスクの受け手 / データが外へ出るか」で決める。
 */
export type Audience =
  /** 公開した本人（秘密情報の露出など） */
  | "publisher"
  /** 公開URLを開く第三者（入力の外部送信・リダイレクトなど） */
  | "viewer"
  /** HTML Publisher自体（オリジンの掌握・同一オリジンAPIの悪用など） */
  | "service";

export interface SecurityFinding {
  id: string;
  severity: Severity;
  audience: Audience[];
  message: string;
  /** 対象ドメイン / URL / 推定プロバイダなど */
  target?: string;
  /** マッチした箇所の抜粋（秘密情報はマスク済み） */
  evidence?: string;
  /** 同一ルールのマッチ数 */
  count: number;
}

export type StorageKind = "localStorage" | "sessionStorage" | "indexedDB" | "cookie";

/**
 * HTMLが要求している機能。危険度ではなく「何を使うか」を中立に表す。
 * INFOレベルのcapability（storage / device等）を危険として扱わないこと。
 */
export interface Capabilities {
  /** 外部ドメインへの通信 */
  network: boolean;
  /** 同一オリジン（相対URL）への通信 */
  sameOriginRequest: boolean;
  storage: StorageKind[];
  camera: boolean;
  microphone: boolean;
  geolocation: boolean;
  clipboard: boolean;
  serviceWorker: boolean;
  /** eval / new Function 等の動的コード実行 */
  dynamicCode: boolean;
  /** parent / top / frameElement へのアクセス */
  frameAccess: boolean;
  /** 埋め込み元ページ自体の遷移 */
  topLevelNavigation: boolean;
  /** ファイルダウンロードの発生 */
  download: boolean;
}

/**
 * trustRequired は「セキュリティ的にtrustすべき」ではなく
 * 「現在の公開ページの実行環境では動作しない可能性がある」という互換性判定。
 * 最終的な trust: true + confirm_trust: true は従来どおりユーザー確認が必須。
 */
export interface Recommendation {
  trustRequired: boolean;
  reasons: string[];
}

export interface SecurityReport {
  risk: RiskLevel;
  summary: { high: number; medium: number; info: number };
  findings: SecurityFinding[];
  capabilities: Capabilities;
  externalDomains: string[];
  recommendation: Recommendation;
  /** Phase 1 の解析で原理的に検出できない範囲 */
  limitations: string[];
  /** 「検出0件＝安全」と解釈させないための但し書き */
  disclaimer: string;
}

export type UrlKind = "external" | "same-origin" | "javascript" | "data" | "blob" | "other";

/** HTML属性・コード中から抽出したURL参照 */
export interface UrlRef {
  raw: string;
  kind: UrlKind;
  /** kind === "external" のときのみ入る */
  host?: string;
  /** script / link / img / iframe / form / fetch など、どこから来たか */
  origin: string;
}

/** 前処理済みの解析対象。regex系ルールはすべてこれを参照する */
export interface ScanContext {
  /** 元のHTML全文 */
  html: string;
  /** インラインscriptの中身を連結したもの */
  scriptCode: string;
  /** インラインscript + on*属性 + javascript: URI を連結した「JSとして解釈される全文」 */
  code: string;
  /** JSとして解釈される断片を個別に保持したもの（AST解析の入力） */
  jsSources: string[];
  /**
   * AST解析でパースできなかった断片だけを連結したもの。
   * パースできた断片は js-ast.ts が担当するため、正規表現はここだけを見る。
   * これによりコメントや文字列リテラル内のコード片を誤検知しなくなる。
   */
  unparsedCode: string;
  /** 解析対象を打ち切った場合に true */
  truncated: boolean;
}

/**
 * 低レベルの検出シグナル。capabilities と findings の両方がこれを参照するため、
 * 正規表現の定義箇所を1つにまとめている。
 */
export interface Signals {
  externalNetworkSink: number;
  sameOriginRequest: number;
  sameOriginApiRequest: number;
  dynamicCode: number;
  frameAccess: number;
  cookieAccess: number;
  storage: StorageKind[];
  camera: boolean;
  microphone: boolean;
  mediaDevices: number;
  geolocation: number;
  clipboard: number;
  serviceWorker: number;
  redirect: number;
  topLevelNavigation: number;
  download: number;
  inlineEventHandler: number;
  javascriptUri: number;
  svgScript: number;
  embeddedFrame: number;
  /** 宛先を静的に特定できないネットワークリクエストの数 */
  dynamicNetworkSink: number;
  metaRefresh: number;
  passwordInput: number;
  /** 検出根拠の抜粋（先頭数件のみ） */
  evidence: Record<string, string[]>;
}
