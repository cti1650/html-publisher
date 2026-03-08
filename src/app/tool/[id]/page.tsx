import { notFound } from "next/navigation";
import { getGist } from "@/lib/gist";

interface PageProps {
  params: Promise<{ id: string }>;
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
    <main className="w-full h-screen">
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
