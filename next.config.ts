import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // get_template が実行時に src/templates/*.html を読むため、MCPルートのバンドルに同梱する
  outputFileTracingIncludes: {
    "/api/mcp/[transport]": ["./src/templates/**/*.html"],
  },
};

export default nextConfig;
