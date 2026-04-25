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

    // trustでないツールはメタデータも返さない
    if (!tool.trust) {
      return {
        title: "Not Found",
        robots: {
          index: false,
          follow: false,
        },
      };
    }

    const title = tool.name || "HTML Tool";
    const description = tool.memo || "HTML Publisher で作成されたツール（信頼モード）";

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

export default async function TrustedToolViewerPage({ params }: PageProps) {
  const { id } = await params;

  let html: string;
  let trust: boolean | undefined;

  try {
    const tool = await getTool(id);
    html = tool.html;
    trust = tool.trust;
  } catch {
    notFound();
  }

  // trustフラグがtrueでない場合は通常の/tool/へリダイレクト
  if (!trust) {
    notFound();
  }

  return (
    <>
      <ServiceWorkerRegistration />
      <div
        className="w-full h-dvh"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </>
  );
}
