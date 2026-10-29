import { useEffect, useRef } from "react";
import type { ActiveSchema } from "../schemas/useActiveSchema";
import { monaco, setDocumentSchema } from "./monaco";
import { setRevealHandler } from "./reveal";

type Props = {
  fileName: string;
  language: "json" | "yaml";
  value: string;
  onChange: (value: string) => void;
  dark: boolean;
  schema: ActiveSchema | null;
  readOnly?: boolean;
};

export default function Editor({
  fileName,
  language,
  value,
  onChange,
  dark,
  schema,
  readOnly,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!container.current) return;
    const e = monaco.editor.create(container.current, {
      automaticLayout: true,
      minimap: { enabled: false },
      tabSize: 2,
      fixedOverflowWidgets: true,
    });
    editor.current = e;
    const sub = e.onDidChangeModelContent(() => onChangeRef.current(e.getValue()));
    setRevealHandler((start, end) => {
      const model = e.getModel();
      if (!model) return;
      const range = monaco.Range.fromPositions(
        model.getPositionAt(start),
        model.getPositionAt(end),
      );
      e.setSelection(range);
      e.revealRangeInCenter(range);
      e.focus();
    });
    return () => {
      setRevealHandler(undefined);
      sub.dispose();
      e.dispose();
    };
  }, []);

  useEffect(() => {
    const uri = monaco.Uri.parse(`file:///${fileName}`);
    const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(value, language, uri);
    if (model.getValue() !== value) model.setValue(value);
    if (editor.current?.getModel() !== model) editor.current?.setModel(model);
  }, [fileName, language, value]);

  useEffect(() => {
    monaco.editor.setTheme(dark ? "vs-dark" : "vs");
  }, [dark]);

  useEffect(() => {
    setDocumentSchema(schema);
  }, [schema]);

  useEffect(() => {
    editor.current?.updateOptions({ readOnly: !!readOnly });
  }, [readOnly]);

  return <div ref={container} className="h-full min-h-0 w-full" data-testid="editor" />;
}
