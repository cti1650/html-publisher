import { NextRequest, NextResponse } from "next/server";
import { getTool, updateTool } from "@/lib/storage";
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

    const result = await getTool(id);

    const baseUrl = request.nextUrl.origin;
    const toolPath = result.trust ? "tool-trust" : "tool";
    const url = `${baseUrl}/${toolPath}/${id}`;

    return NextResponse.json(
      { id, html: result.html, rawUrl: result.rawUrl, url, trust: result.trust, mode: result.mode },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error getting tool:", error);

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
    const { html, name, memo, trust } = body;

    if (!html || typeof html !== "string") {
      return NextResponse.json(
        { error: "html is required and must be a string" },
        { status: 400 }
      );
    }

    const result = await updateTool(id, html, { name, memo, trust });

    const baseUrl = request.nextUrl.origin;
    const toolPath = result.trust ? "tool-trust" : "tool";
    const url = `${baseUrl}/${toolPath}/${id}`;

    await notifySlack({
      type: "update",
      id,
      url,
      name: result.name,
      memo: result.memo,
      trust: result.trust,
      mode: result.mode,
    });

    return NextResponse.json(
      { id, url, rawUrl: result.rawUrl, trust: result.trust, mode: result.mode },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error updating tool:", error);

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
