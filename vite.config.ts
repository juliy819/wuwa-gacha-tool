import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig(async () => ({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: process.env.TAURI_DEV_HOST,
    hmr: process.env.TAURI_ENV_FRONTDIR
      ? {
          path: "ws",
          host: process.env.TAURI_DEV_HOST ?? "localhost",
          port: 1421,
          protocol: "ws",
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
