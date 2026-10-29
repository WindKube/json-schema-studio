import Ajv, {
  type AnySchema,
  type AnySchemaObject,
  type ErrorObject,
  type Options,
  type ValidateFunction,
} from "ajv";
import Ajv2019 from "ajv/dist/2019";
import Ajv2020 from "ajv/dist/2020";
import draft06 from "ajv/dist/refs/json-schema-draft-06.json";
import AjvDraft04 from "ajv-draft-04";
import addFormats from "ajv-formats";
import { fetchSchema } from "../schemas/loader";
import { pointerToPath } from "./location";

export type Draft = "draft-04" | "draft-06" | "draft-07" | "2019-09" | "2020-12";

export type Problem = { path: string[]; message: string };

export function detectDraft(schema: unknown): Draft {
  const id =
    schema && typeof schema === "object" && "$schema" in schema ? String(schema.$schema) : "";
  if (id.includes("2020-12")) return "2020-12";
  if (id.includes("2019-09")) return "2019-09";
  if (id.includes("draft-04")) return "draft-04";
  if (id.includes("draft-06")) return "draft-06";
  return "draft-07";
}

function createAjv(draft: Draft, options: Options = {}): Ajv {
  const opts: Options = {
    allErrors: true,
    strict: false,
    logger: false,
    loadSchema: (uri) => fetchSchema(uri) as Promise<AnySchemaObject>,
    ...options,
  };
  const ajv =
    draft === "2020-12"
      ? new Ajv2020(opts)
      : draft === "2019-09"
        ? new Ajv2019(opts)
        : draft === "draft-04"
          ? new AjvDraft04(opts)
          : new Ajv(opts);
  if (draft === "draft-06") ajv.addMetaSchema(draft06);
  addFormats(ajv);
  return ajv;
}

const compiled = new WeakMap<object, Promise<ValidateFunction>>();

function compile(schema: object, baseUri?: string): Promise<ValidateFunction> {
  let validate = compiled.get(schema);
  if (!validate) {
    const ajv = createAjv(detectDraft(schema), { validateSchema: false });
    const withId =
      baseUri && !("$id" in schema) && !("id" in schema) ? { ...schema, $id: baseUri } : schema;
    validate = ajv.compileAsync(withId);
    compiled.set(schema, validate);
  }
  return validate;
}

export async function validateDocument(
  schema: object,
  data: unknown,
  baseUri?: string,
): Promise<Problem[]> {
  const validate = await compile(schema, baseUri);
  validate(data);
  return toProblems(validate.errors);
}

const metaValidators = new Map<Draft, Ajv>();

export function validateSchema(schema: unknown): Problem[] {
  const draft = detectDraft(schema);
  let ajv = metaValidators.get(draft);
  if (!ajv) {
    ajv = createAjv(draft);
    metaValidators.set(draft, ajv);
  }
  if (typeof schema !== "object" && typeof schema !== "boolean") {
    return [{ path: [], message: "a schema must be an object or a boolean" }];
  }
  try {
    ajv.validateSchema(schema as AnySchema);
  } catch (e) {
    return [{ path: [], message: (e as Error).message }];
  }
  return toProblems(ajv.errors);
}

function toProblems(errors: ErrorObject[] | null | undefined): Problem[] {
  return (errors ?? []).map((e) => {
    const path = pointerToPath(e.instancePath);
    let message = e.message ?? "is invalid";
    if (e.keyword === "additionalProperties") {
      path.push(e.params.additionalProperty);
      message = "is not allowed (additional property)";
    } else if (e.keyword === "enum") {
      message += `: ${e.params.allowedValues.map((v: unknown) => JSON.stringify(v)).join(", ")}`;
    }
    return { path, message };
  });
}
