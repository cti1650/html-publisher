import { NextRequest, NextResponse } from "next/server";
import { getTool } from "@/lib/storage";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const tool = await getTool(id);
    const baseUrl = request.nextUrl.origin;
    const toolPath = tool.trust ? "tool-trust" : "tool";
    const startUrl = `${baseUrl}/${toolPath}/${id}`;

    const manifest = {
      name: tool.name || "HTML Tool",
      short_name: tool.name ? tool.name.slice(0, 12) : "Tool",
      description: tool.memo || "HTML Publisher で作成されたツール",
      start_url: startUrl,
      scope: startUrl,
      display: "standalone",
      background_color: "#000000",
      theme_color: "#000000",
      orientation: "any",
      icons: [
        {
          src: `${baseUrl}/icon.svg`,
          sizes: "any",
          type: "image/svg+xml",
          purpose: "any",
        },
        {
          src: `${baseUrl}/icon.svg`,
          sizes: "512x512",
          type: "image/svg+xml",
          purpose: "maskable",
        },
      ],
    };

    return NextResponse.json(manifest, {
      headers: {
        "Content-Type": "application/manifest+json",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    console.error("Error generating manifest:", error);

    if (
      error instanceof Error &&
      (error.message === "Gist not found" || error.message === "Tool not found")
    ) {
      return NextResponse.json({ error: "Tool not found" }, { status: 404 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
