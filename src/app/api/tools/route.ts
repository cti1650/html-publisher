import { NextRequest, NextResponse } from "next/server";
import { createGist, listRecentGists } from "@/lib/gist";
import { verifyApiKey, unauthorizedResponse } from "@/lib/auth";
import { notifySlack } from "@/lib/slack";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const limitParam = searchParams.get("limit");
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 10, 1), 10) : 10;

    const baseUrl = request.nextUrl.origin;
    const tools = await listRecentGists(limit, baseUrl);

    return NextResponse.json(tools, { status: 200 });
  } catch (error) {
    console.error("Error listing tools:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!verifyApiKey(request)) {
    return unauthorizedResponse();
  }

  try {
    const body = await request.json();
    const { html, name, memo, trust } = body;

    if (!html || typeof html !== "string") {
      return NextResponse.json(
        { error: "html is required and must be a string" },
        { status: 400 }
      );
    }

    const result = await createGist(html, { name, memo, trust });

    const baseUrl = request.nextUrl.origin;
    const toolPath = result.trust ? "tool-trust" : "tool";
    const url = `${baseUrl}/${toolPath}/${result.id}`;

    notifySlack({ type: "create", id: result.id, url, name: result.name, memo: result.memo, trust: result.trust });

    return NextResponse.json({ id: result.id, url, rawUrl: result.rawUrl, trust: result.trust }, { status: 201 });
  } catch (error) {
    console.error("Error creating tool:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
