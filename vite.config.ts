import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  root: "src/desktop/renderer",
  plugins: [react()],
  build: {
    emptyOutDir: false,
    outDir: "../../../dist/renderer",
  },
});
