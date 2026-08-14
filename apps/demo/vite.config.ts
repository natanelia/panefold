import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export function isDemoVendorModule(moduleId: string): boolean {
  return /node_modules[\\/]/.test(moduleId);
}

export default defineConfig({
  base: process.env.PANEFOLD_DEMO_BASE ?? "/",
  plugins: [react()],
  build: {
    target: "es2022",
    // Every browser in the demo's modern support profile implements
    // modulepreload natively, so the compatibility shim is unnecessary.
    modulePreload: { polyfill: false },
    sourcemap: true,
    chunkSizeWarningLimit: 300,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              // Keep the framework/interaction runtime cacheable across
              // changes to the workbench fixture. Application code—including
              // synchronous popup creation—remains in the eager entry chunk.
              name: "vendor",
              test: isDemoVendorModule,
            },
          ],
        },
      },
    },
  },
});
