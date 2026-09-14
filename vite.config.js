import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  preview: {
    proxy: {
      "/v2": { target: "http://127.0.0.1:3100", changeOrigin: false },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
    proxy: {
      "/v2": {
        target: "http://127.0.0.1:3100",
        changeOrigin: false,
      },
    },
  },
});
