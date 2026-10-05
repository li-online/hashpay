import path from "node:path";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import vue from "@vitejs/plugin-vue";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
import type { Plugin } from "vite";

function gitShortHash() {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "dev";
  }
}

function base64AssetPlugin(): Plugin {
  const prefix = "\0base64-asset:";
  return {
    enforce: "pre" as const,
    name: "base64-asset",
    async resolveId(source: string, importer: string | undefined): Promise<string | null> {
      if (!source.endsWith("?base64")) return null;
      const fileSource = source.slice(0, -"?base64".length);
      const resolved = await this.resolve(fileSource, importer, { skipSelf: true });
      return resolved ? `${prefix}${resolved.id}` : null;
    },
    load(id: string) {
      if (!id.startsWith(prefix)) return null;
      const file = id.slice(prefix.length);
      const base64 = readFileSync(file).toString("base64");
      return `export default ${JSON.stringify(base64)};`;
    },
  };
}

export default defineConfig({
  define: {
    __GIT_SHORT_HASH__: JSON.stringify(gitShortHash()),
  },
  plugins: [base64AssetPlugin(), vue(), cloudflare()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    allowedHosts: ["hashpay.outti.me"],
    host: "0.0.0.0",
    port: 8183,
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
