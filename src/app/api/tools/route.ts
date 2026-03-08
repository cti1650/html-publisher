import { NextRequest, NextResponse } from "next/server";
import { createGist } from "@/lib/gist";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { html } = body;

    if (!html || typeof html !== "string") {
      return NextResponse.json(
        { error: "html is required and must be a string" },
        { status: 400 }
      );
    }

    const { id, rawUrl } = await createGist(html);

    const baseUrl = request.nextUrl.origin;
    const url = `${baseUrl}/tool/${id}`;

    return NextResponse.json({ id, url, rawUrl }, { status: 201 });
  } catch (error) {
    console.error("Error creating tool:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
