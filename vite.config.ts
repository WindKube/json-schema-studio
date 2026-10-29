import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The Workers runtime only matters for dev/build; unit tests run in plain Node.
  plugins: [react(), tailwindcss(), process.env.VITEST ? [] : cloudflare()],
  resolve: {
    alias: [
      // monaco-yaml's worker deep-imports a path that monaco-editor 0.57's exports map no longer resolves.
      {
        find: /^monaco-editor\/esm\/vs\/(.*)$/,
        replacement: fileURLToPath(
          new URL("./node_modules/monaco-editor/esm/vs/$1", import.meta.url),
        ),
      },
    ],
  },
  // The dev server serves the YAML worker as raw ESM; its CommonJS/UMD deps must be pre-bundled.
  optimizeDeps: {
    include: [
      "monaco-editor/esm/vs/editor/editor.worker.js",
      "monaco-yaml > path-browserify",
      "monaco-yaml > jsonc-parser",
      "monaco-yaml > vscode-languageserver-types",
      "monaco-yaml > vscode-languageserver-textdocument",
      "monaco-yaml > vscode-uri",
      "monaco-yaml > @vscode/l10n",
    ],
  },
  worker: { format: "es" },
  test: {
    include: ["src/**/*.test.ts", "shared/**/*.test.ts"],
    environment: "node",
  },
});
