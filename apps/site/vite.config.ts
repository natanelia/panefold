import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.PANEFOLD_SITE_BASE ?? "/panefold/",
  plugins: [react(), tailwindcss()],
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
