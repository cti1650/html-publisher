import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // 既存の挙動を変えない範囲のセキュリティヘッダー。
  // frame-ancestors / X-Frame-Options は、公開ツールを他サイトに埋め込む使い方を壊すため付けない
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
  // get_template が実行時に src/templates/*.html を読むため、MCPルートのバンドルに同梱する
  outputFileTracingIncludes: {
    "/api/mcp/[transport]": ["./src/templates/**/*.html"],
  },
};

export default nextConfig;
