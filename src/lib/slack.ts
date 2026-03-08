type NotificationType = "create" | "update";

interface NotifyOptions {
  type: NotificationType;
  id: string;
  url: string;
}

export async function notifySlack({ type, id, url }: NotifyOptions): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;

  if (!webhookUrl) {
    return;
  }

  const emoji = type === "create" ? ":new:" : ":pencil2:";
  const action = type === "create" ? "新規ツール作成" : "ツール更新";

  const payload = {
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${emoji} *${action}*\nID: \`${id}\`\n<${url}|ツールを開く>`,
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
