declare module "monaco-editor/internal/common/workers" {
  export function createWebWorker(opts: {
    label?: string;
    moduleId?: string;
    createData?: unknown;
  }): unknown;
}
