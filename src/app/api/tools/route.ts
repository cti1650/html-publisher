import { NextRequest, NextResponse } from "next/server";
import { createGist } from "@/lib/gist";
import { verifyApiKey, unauthorizedResponse } from "@/lib/auth";
import { notifySlack } from "@/lib/slack";

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
