import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development, /api and /media are proxied to the Python server on port 8000.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/media": "http://127.0.0.1:8000",
    },
  },
});
