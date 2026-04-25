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
          sandbox="allow-scripts allow-forms allow-same-origin allow-modals allow-popups"
          allow="geolocation; accelerometer; gyroscope; magnetometer; camera; microphone; fullscreen; clipboard-read; clipboard-write; web-share"
          className="w-full h-full border-0"
          title="HTML Tool"
        />
      </main>
    </>
  );
}
