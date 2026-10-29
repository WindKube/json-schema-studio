import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import { createWebWorker } from "monaco-editor/internal/common/workers";
import JsonWorker from "monaco-editor/languages/features/json/json.worker?worker";
import { configureMonacoYaml } from "monaco-yaml";
import YamlWorker from "monaco-yaml/yaml.worker?worker";
import type { ActiveSchema } from "../schemas/useActiveSchema";

self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === "json") return new JsonWorker();
    if (label === "yaml") return new YamlWorker();
    return new EditorWorker();
  },
};

const DRAFT_07 = "http://json-schema.org/draft-07/schema#";

// monaco-yaml (via monaco-worker-manager 2.0.1) still calls createWebWorker({ label, moduleId, createData }),
// which monaco-editor 0.57's public API dropped. The internal implementation keeps that shape.
const monacoYaml = configureMonacoYaml(
  { ...monaco, editor: { ...monaco.editor, createWebWorker } } as typeof monaco,
  { enableSchemaRequest: true, schemas: [] },
);

export function setDocumentSchema(active: ActiveSchema | null) {
  const schemas = active ? [{ uri: active.uri, schema: active.schema }] : [];
  monaco.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    enableSchemaRequest: true,
    schemaValidation: "error",
    schemas: [
      ...schemas.map((s) => ({ ...s, fileMatch: ["document.json"] })),
      // Used when the authored schema has no $schema; otherwise the language service follows $schema.
      { uri: DRAFT_07, fileMatch: ["schema.json"] },
    ],
  });
  monacoYaml.update({
    enableSchemaRequest: true,
    schemas: schemas.map((s) => ({ ...s, fileMatch: ["**/document.yaml"] })),
  });
}

export { monaco };
