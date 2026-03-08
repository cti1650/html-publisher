import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";

interface OpenApiSpec {
  servers?: { url: string; description: string }[];
  [key: string]: unknown;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const format = url.searchParams.get("format") || "yaml";

  // リクエストのオリジンを取得
  const origin = url.origin;

  const filePath = join(process.cwd(), "openapi.yaml");
  const yamlContent = readFileSync(filePath, "utf-8");
  const spec = yaml.load(yamlContent) as OpenApiSpec;

  // serversを動的に設定
  spec.servers = [
    {
      url: origin,
      description: "現在のサーバー",
    },
  ];

  if (format === "json") {
    return NextResponse.json(spec);
  }

  return new NextResponse(yaml.dump(spec), {
    headers: {
      "Content-Type": "text/yaml; charset=utf-8",
    },
  });
}
