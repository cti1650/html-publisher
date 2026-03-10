import { NextRequest, NextResponse } from "next/server";
import { getGist } from "@/lib/gist";
import QRCode from "qrcode";

function getBaseUrl(request: NextRequest): string {
  if (process.env.BASE_URL) {
    return process.env.BASE_URL;
  }
  return request.nextUrl.origin;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const gist = await getGist(id);
    const baseUrl = getBaseUrl(request);
    const toolPath = gist.trust ? "tool-trust" : "tool";
    const toolUrl = `${baseUrl}/${toolPath}/${id}`;

    const sizeParam = request.nextUrl.searchParams.get("size");
    const size = sizeParam ? Math.min(Math.max(parseInt(sizeParam, 10), 100), 500) : 300;

    const qrBuffer = await QRCode.toBuffer(toolUrl, {
      width: size,
      margin: 2,
      color: {
        dark: "#000000",
        light: "#ffffff",
      },
    });

    return new NextResponse(new Uint8Array(qrBuffer), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (error) {
    console.error("Error generating QR code:", error);

    if (error instanceof Error && error.message === "Gist not found") {
      return NextResponse.json({ error: "Tool not found" }, { status: 404 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
