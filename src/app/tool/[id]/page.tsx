import { notFound } from "next/navigation";
import { Metadata } from "next";
import { getGist } from "@/lib/gist";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;

  try {
    const gist = await getGist(id);
    const title = gist.name || "HTML Tool";
    const description = gist.memo || "HTML Publisher で作成されたツール";

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

export default async function ToolViewerPage({ params }: PageProps) {
  const { id } = await params;

  let html: string;

  try {
    const gist = await getGist(id);
    html = gist.html;
  } catch {
    notFound();
  }

  return (
    <main className="w-full h-dvh">
      <iframe
        srcDoc={html}
        sandbox="allow-scripts allow-forms allow-same-origin allow-modals allow-popups"
        allow="geolocation; accelerometer; gyroscope; magnetometer; camera; microphone; fullscreen; clipboard-read; clipboard-write; web-share"
        className="w-full h-full border-0"
        title="HTML Tool"
      />
    </main>
  );
}
