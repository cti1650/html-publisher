import { NextRequest, NextResponse } from "next/server";
import { getGist } from "@/lib/gist";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const { html, rawUrl } = await getGist(id);

    return NextResponse.json({ id, html, rawUrl }, { status: 200 });
  } catch (error) {
    console.error("Error getting tool:", error);

    if (error instanceof Error && error.message === "Gist not found") {
      return NextResponse.json({ error: "Tool not found" }, { status: 404 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
