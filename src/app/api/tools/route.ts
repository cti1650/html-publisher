import { NextRequest, NextResponse } from "next/server";
import { createTool, listRecentTools } from "@/lib/storage";
import { checkAuth, unauthorizedResponse } from "@/lib/auth";
import { notifySlack } from "@/lib/slack";
import { resolveEphemeral, toolPath } from "@/lib/policy";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const limitParam = searchParams.get("limit");
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 10, 1), 10) : 10;

    const baseUrl = request.nextUrl.origin;
    const tools = await listRecentTools(limit, baseUrl);

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
  const auth = checkAuth(request);
  if (auth === "rejected") {
    return unauthorizedResponse();
  }

  try {
    const body = await request.json();
    const { html, name, memo, trust, ephemeral } = body;

    if (!html || typeof html !== "string") {
      return NextResponse.json(
        { error: "html is required and must be a string" },
        { status: 400 }
      );
    }

    const finalEphemeral = resolveEphemeral(auth, ephemeral);

    const result = await createTool(html, { name, memo, trust, ephemeral: finalEphemeral });

    const baseUrl = request.nextUrl.origin;
    const url = `${baseUrl}/${toolPath(result.trust)}/${result.id}`;

    await notifySlack({
      type: "create",
      id: result.id,
      url,
      name: result.name,
      memo: result.memo,
      trust: result.trust,
      mode: result.mode,
    });

    return NextResponse.json(
      { id: result.id, url, rawUrl: result.rawUrl, trust: result.trust, mode: result.mode },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating tool:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
