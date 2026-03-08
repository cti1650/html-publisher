import { NextRequest, NextResponse } from "next/server";
import { getGist, updateGist } from "@/lib/gist";

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

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const body = await request.json();
    const { html } = body;

    if (!html || typeof html !== "string") {
      return NextResponse.json(
        { error: "html is required and must be a string" },
        { status: 400 }
      );
    }

    const { rawUrl } = await updateGist(id, html);

    const baseUrl = request.nextUrl.origin;
    const url = `${baseUrl}/tool/${id}`;

    return NextResponse.json({ id, url, rawUrl }, { status: 200 });
  } catch (error) {
    console.error("Error updating tool:", error);

    if (error instanceof Error && error.message === "Gist not found") {
      return NextResponse.json({ error: "Tool not found" }, { status: 404 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
