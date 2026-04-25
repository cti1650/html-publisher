import { notFound } from "next/navigation";
import { Metadata } from "next";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { getTool } from "@/lib/storage";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ size?: string }>;
}

async function getBaseUrl(): Promise<string> {
  if (process.env.BASE_URL) {
    return process.env.BASE_URL;
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  return `${protocol}://${host}`;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;

  try {
    const tool = await getTool(id);
    const title = tool.name ? `${tool.name} - QRコード` : "QRコード";
    const description = "ツール共有用QRコード";
    return {
      title,
      description,
      robots: { index: false, follow: false },
    };
  } catch {
    return {
      title: "QRコード",
      robots: { index: false, follow: false },
    };
  }
}

export default async function QrPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { size: sizeParam } = await searchParams;

  let toolName = "";
  let toolUrl = "";

  try {
    const tool = await getTool(id);
    toolName = tool.name ?? "";
    const baseUrl = await getBaseUrl();
    const toolPath = tool.trust ? "tool-trust" : "tool";
    toolUrl = `${baseUrl}/${toolPath}/${id}`;
  } catch {
    notFound();
  }

  const size = sizeParam
    ? Math.min(Math.max(parseInt(sizeParam, 10) || 300, 100), 500)
    : 300;

  const qrDataUrl = await QRCode.toDataURL(toolUrl, {
    width: size,
    margin: 2,
    color: { dark: "#000000", light: "#ffffff" },
  });

  return (
    <main className="min-h-dvh w-full flex items-center justify-center bg-neutral-50 p-6">
      <div className="flex flex-col items-center gap-6 rounded-2xl bg-white p-8 shadow-sm">
        {toolName && (
          <h1 className="text-lg font-semibold text-neutral-900 text-center break-all max-w-md">
            {toolName}
          </h1>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={qrDataUrl}
          alt="QRコード"
          width={size}
          height={size}
          className="block"
        />
        <a
          href={toolUrl}
          className="text-sm text-blue-600 hover:underline break-all text-center max-w-md"
        >
          {toolUrl}
        </a>
      </div>
    </main>
  );
}
