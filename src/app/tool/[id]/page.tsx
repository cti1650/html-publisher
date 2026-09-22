import { notFound } from "next/navigation";
import { Metadata } from "next";
import { getTool } from "@/lib/storage";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;

  try {
    const tool = await getTool(id);
    const title = tool.name || "HTML Tool";
    const description = tool.memo || "HTML Publisher で作成されたツール";

    return {
      title,
      description,
      robots: {
        index: false,
        follow: false,
      },
      openGraph: {
        title,
        description,
        type: "website",
      },
      twitter: {
        card: "summary",
        title,
        description,
      },
      manifest: `/api/manifest/${id}`,
      appleWebApp: {
        capable: true,
        statusBarStyle: "black-translucent",
        title,
      },
      other: {
        "mobile-web-app-capable": "yes",
        "apple-mobile-web-app-capable": "yes",
      },
    };
  } catch {
    return {
      title: "HTML Tool",
      robots: {
        index: false,
        follow: false,
      },
    };
  }
}

function ServiceWorkerRegistration() {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js').catch(function() {});
          }
        `,
      }}
    />
  );
}

export default async function ToolViewerPage({ params }: PageProps) {
  const { id } = await params;

  let html: string;

  try {
    const tool = await getTool(id);
    html = tool.html;
  } catch {
    notFound();
  }

  return (
    <>
      <ServiceWorkerRegistration />
      <main className="w-full h-dvh">
        <iframe
          srcDoc={html}
          // allow-same-origin は付けない。srcDoc の iframe は親のオリジンを継承するため、
          // allow-scripts と併用すると iframe が publisher と同一オリジンになり、
          // storage / Cookie / 同一オリジンAPI / 親フレームのDOM に到達できてしまう
          // （sandbox属性を自分で外して再読込することも可能になる）。
          // opaque origin にすることで初めて隔離が成立する。
          // この設定を変更する場合は src/lib/security/capability.ts の RUNTIME_MATRIX も更新すること。
          sandbox="allow-scripts allow-forms allow-modals allow-popups"
          allow="geolocation; accelerometer; gyroscope; magnetometer; camera; microphone; fullscreen; clipboard-read; clipboard-write; web-share"
          className="w-full h-full border-0"
          title="HTML Tool"
        />
      </main>
    </>
  );
}
