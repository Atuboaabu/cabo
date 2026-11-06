import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { mockPlugin } from "./mock/plugin";
export default defineConfig({
  plugins: [react(), mockPlugin()],
  server: {
    fs: {
      deny: [
        ".env",
        ".env.*",
        "*.{crt,pem}",
        "**/.git/**",
        "**/mock/**",
        "**/tests/**",
      ],
    },
  },
});
