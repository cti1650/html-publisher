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

    // trustでないツールはメタデータも返さない
    if (!gist.trust) {
      return {
        title: "Not Found",
        robots: {
          index: false,
          follow: false,
        },
      };
    }

    const title = gist.name || "HTML Tool";
    const description = gist.memo || "HTML Publisher で作成されたツール（信頼モード）";

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

export default async function TrustedToolViewerPage({ params }: PageProps) {
  const { id } = await params;

  let html: string;
  let trust: boolean | undefined;

  try {
    const gist = await getGist(id);
    html = gist.html;
    trust = gist.trust;
  } catch {
    notFound();
  }

  // trustフラグがtrueでない場合は通常の/tool/へリダイレクト
  if (!trust) {
    notFound();
  }

  return (
    <main className="w-full h-dvh">
      <iframe
        srcDoc={html}
        sandbox="allow-scripts allow-forms allow-same-origin allow-modals allow-popups allow-downloads allow-pointer-lock"
        allow="geolocation; accelerometer; gyroscope; magnetometer; camera; microphone; fullscreen; clipboard-read; clipboard-write; web-share; storage-access"
        className="w-full h-full border-0"
        title="Trusted HTML Tool"
      />
    </main>
  );
}
