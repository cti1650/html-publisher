import { notFound } from "next/navigation";
import { getGist } from "@/lib/gist";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ToolViewerPage({ params }: PageProps) {
  const { id } = await params;

  let rawUrl: string;

  try {
    const gist = await getGist(id);
    rawUrl = gist.rawUrl;
  } catch {
    notFound();
  }

  return (
    <main className="w-full h-screen">
      <iframe
        src={rawUrl}
        sandbox="allow-scripts allow-forms"
        className="w-full h-full border-0"
        title="HTML Tool"
      />
    </main>
  );
}
