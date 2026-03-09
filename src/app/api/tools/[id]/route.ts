import { NextRequest, NextResponse } from "next/server";
import { getGist, updateGist } from "@/lib/gist";
import { verifyApiKey, unauthorizedResponse } from "@/lib/auth";
import { notifySlack } from "@/lib/slack";

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
  if (!verifyApiKey(request)) {
    return unauthorizedResponse();
  }

  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const body = await request.json();
    const { html, name, memo } = body;

    if (!html || typeof html !== "string") {
      return NextResponse.json(
        { error: "html is required and must be a string" },
        { status: 400 }
      );
    }

    const result = await updateGist(id, html, { name, memo });

    const baseUrl = request.nextUrl.origin;
    const url = `${baseUrl}/tool/${id}`;

    // updateGistから返されたname/memoを使用（既存の値がマージされている）
    notifySlack({ type: "update", id, url, name: result.name, memo: result.memo });

    return NextResponse.json({ id, url, rawUrl: result.rawUrl }, { status: 200 });
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
