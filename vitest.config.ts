import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // tsconfig.json の paths（@/* → src/*）と揃える
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    include: ["src/**/*.test.ts"],
    // 各テストで stubEnv した環境変数を自動で元に戻す
    unstubEnvs: true,
    unstubGlobals: true,
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/**/*.test.ts", "src/lib/test-env.ts"],
      reporter: ["text", "text-summary"],
      // 閾値は設けない（数値を稼ぐためのテストを誘発しないよう、まずは可視化のみ）
    },
  },
});
