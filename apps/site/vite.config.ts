import { execFileSync } from "node:child_process";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

function sourceRef(): string {
  if (process.env.VITE_SOURCE_REF) return process.env.VITE_SOURCE_REF;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "main";
  }
}
export default defineConfig({
  base: process.env.PANEFOLD_SITE_BASE ?? "/panefold/",
  plugins: [react(), tailwindcss()],
  define: { "import.meta.env.VITE_SOURCE_REF": JSON.stringify(sourceRef()) },
  ...(process.env.PANEFOLD_SITE_DEV_PROXY === "true"
    ? {
        server: {
          proxy: {
            "/panefold/workbench": {
              target: "http://127.0.0.1:4317",
              changeOrigin: true,
              rewrite: (path: string) => path.replace(/^\/panefold\/workbench/, "") || "/",
            },
            "/panefold/atlas": {
              target: "http://127.0.0.1:4317",
              changeOrigin: true,
              rewrite: (path: string) => path.replace(/^\/panefold\/atlas/, "") || "/",
            },
          },
        },
      }
    : {}),
  build: {
    target: "es2022",
    sourcemap: true,
    emptyOutDir: true,
  },
});
