import { defineConfig } from "vite-plus";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// UI-only edits do not change this signature.
const detectorSources = [
  "recording-processor.ts",
  "processing-config.ts",
  "framebar-detector.ts",
  "framebar-color-map.ts",
  "input-display.ts",
  "input-display-config.ts",
  "recording-input-association.ts",
  "training-meter.ts",
  "hitbox-detector.ts",
];
const processorHash = createHash("sha256");
for (const file of detectorSources) {
  processorHash.update(file);
  processorHash.update(
    readFileSync(new URL(`./src/${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n"),
  );
}

export default defineConfig({
  base: "./",
  server: {
    watch: {
      // Electron writes transient session files here; Windows can lock them while Vite scans.
      ignored: ["**/.dev/**"],
    },
  },
  define: {
    __RECORDING_PROCESSOR_FINGERPRINT__: JSON.stringify(processorHash.digest("hex")),
  },
  plugins: [
    {
      name: "processing-code-signature",
      configureServer(server) {
        const files = new Set(
          detectorSources.map((file) =>
            fileURLToPath(new URL(`./src/${file}`, import.meta.url)).replace(/\\/g, "/"),
          ),
        );
        server.watcher.add([...files]);
        const onChange = (file: string) => {
          if (files.has(file.replace(/\\/g, "/"))) void server.restart();
        };
        server.watcher.on("change", onChange);
        server.httpServer?.once("close", () => server.watcher.off("change", onChange));
      },
    },
  ],
  staged: {
    "*": "vp check --fix",
  },
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
});
