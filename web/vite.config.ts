import { defineConfig } from "vite-plus";

export default defineConfig({
  base: "/labatar/",
  build: {
    outDir: "../web-dist",
    emptyOutDir: true,
  },
});
