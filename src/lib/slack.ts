type NotificationType = "create" | "update";

interface NotifyOptions {
  type: NotificationType;
  id: string;
  url: string;
  name?: string;
  memo?: string;
  trust?: boolean;
  mode?: "gist" | "cache";
}

export async function notifySlack({ type, id, url, name, memo, trust, mode }: NotifyOptions): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;

  if (!webhookUrl) {
    return;
  }

  // 揮発モード（キャッシュ）はプライバシー保護のためSlack通知を飛ばさない
  if (mode === "cache") {
    return;
  }

  const emoji = type === "create" ? ":new:" : ":pencil2:";
  const action = type === "create" ? "新規ツール作成" : "ツール更新";
  const toolName = name ? `\nツール名: ${name}` : "";
  const memoLine = memo ? `\nメモ: ${memo}` : "";
  const trustLine = trust ? "\n:warning: 信頼モード有効" : "";

  const payload = {
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${emoji} *${action}*\nID: \`${id}\`${toolName}${memoLine}${trustLine}\n<${url}|ツールを開く>`,
        },
      },
    ],
  };

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error("Slack notification failed:", error);
  }
}
