import { describe, expect, it } from "vitest";
import { convert } from "./format";
import { type CatalogEntry, globToRegExp, matchFileName, searchCatalog } from "./schemas/catalog";
import { decodeShare, encodeShare, type SharePayload } from "./share";
import { detectDraft, validateDocument, validateSchema } from "./validation/ajv";
import { locate, pointerToPath } from "./validation/location";

const catalog: CatalogEntry[] = [
  {
    name: "GitHub Workflow",
    description: "YAML GitHub Workflow",
    url: "gh",
    fileMatch: ["**/.github/workflows/*.yml"],
  },
  {
    name: "package.json",
    description: "NPM configuration file",
    url: "pkg",
    fileMatch: ["package.json"],
  },
  {
    name: "Prettier",
    description: "workflow-free formatter config",
    url: "prettier",
    fileMatch: [".prettierrc", ".prettierrc.{json,yaml}"],
  },
];

describe("catalog", () => {
  it("ranks name matches before description matches", () => {
    expect(searchCatalog(catalog, "workflow").map((e) => e.url)).toEqual(["gh", "prettier"]);
  });

  it("ignores spacing and punctuation and matches words across fields", () => {
    const ids = (q: string) => searchCatalog(catalog, q).map((e) => e.url);
    expect(ids("git hub")).toEqual(["gh"]);
    expect(ids("github-workflow")).toEqual(["gh"]);
    expect(ids("packagejson")).toEqual(["pkg"]);
    expect(ids("npm package")).toEqual(["pkg"]);
    expect(ids("prettierrc")).toEqual(["prettier"]);
    expect(ids("nothing here")).toEqual([]);
  });

  it("converts globs", () => {
    expect(globToRegExp("**/.github/workflows/*.yml").test(".github/workflows/ci.yml")).toBe(true);
    expect(globToRegExp("**/.github/workflows/*.yml").test("a/.github/workflows/ci.yml")).toBe(
      true,
    );
    expect(globToRegExp("*.json").test("dir/x.json")).toBe(false);
    expect(globToRegExp("tsconfig.?.json").test("tsconfig.a.json")).toBe(true);
  });

  it("matches file names", () => {
    expect(matchFileName(catalog, "package.json")?.url).toBe("pkg");
    expect(matchFileName(catalog, ".github/workflows/ci.yml")?.url).toBe("gh");
    expect(matchFileName(catalog, "random.txt")).toBeUndefined();
  });
});

describe("ajv", () => {
  it("detects drafts", () => {
    expect(detectDraft({ $schema: "https://json-schema.org/draft/2020-12/schema" })).toBe(
      "2020-12",
    );
    expect(detectDraft({ $schema: "http://json-schema.org/draft-04/schema#" })).toBe("draft-04");
    expect(detectDraft({})).toBe("draft-07");
  });

  it("validates documents per draft", async () => {
    const draft04 = {
      $schema: "http://json-schema.org/draft-04/schema#",
      properties: { n: { type: "number", maximum: 5, exclusiveMaximum: true } },
    };
    expect(await validateDocument(draft04, { n: 5 })).toHaveLength(1);

    const draft2020 = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      prefixItems: [{ type: "string" }],
      additionalProperties: false,
      properties: { a: { enum: [1, 2] } },
    };
    const problems = await validateDocument(draft2020, { a: 3, b: 1 });
    expect(problems).toHaveLength(2);
    expect(problems).toEqual(
      expect.arrayContaining([
        { path: ["a"], message: "must be equal to one of the allowed values: 1, 2" },
        { path: ["b"], message: "is not allowed (additional property)" },
      ]),
    );
  });

  it("validates schemas against the meta-schema", () => {
    expect(validateSchema({ type: "object" })).toEqual([]);
    expect(validateSchema({ type: 5 })).not.toEqual([]);
    expect(
      validateSchema({ $schema: "https://json-schema.org/draft/2020-12/schema", minLength: -1 }),
    ).not.toEqual([]);
  });
});

describe("location", () => {
  it("parses JSON pointers", () => {
    expect(pointerToPath("")).toEqual([]);
    expect(pointerToPath("/a~1b/0/c~0d")).toEqual(["a/b", "0", "c~d"]);
  });

  it("locates paths in JSON", () => {
    const text = '{\n  "a": {\n    "b": [1, "x"]\n  }\n}';
    const [start, end] = locate(text, ["a", "b", "1"]);
    expect(text.slice(start, end)).toBe('"x"');
    const [ks, ke] = locate(text, ["a", "b"]);
    expect(text.slice(ks, ke)).toBe('"b"');
  });

  it("locates paths in YAML and stops at missing segments", () => {
    const text = "jobs:\n  build:\n    steps:\n      - run: echo\n";
    const [start, end] = locate(text, ["jobs", "build", "steps", "0"]);
    expect(text.slice(start, end)).toContain("run: echo");
    const [ms, me] = locate(text, ["jobs", "missing"]);
    expect(text.slice(ms, me)).toBe("jobs");
  });
});

describe("format", () => {
  it("round-trips between JSON and YAML", () => {
    const yaml = convert('{"a": [1, {"b": true}]}', "json", "yaml");
    expect(yaml).toBe("a:\n  - 1\n  - b: true\n");
    expect(JSON.parse(convert(yaml, "yaml", "json"))).toEqual({ a: [1, { b: true }] });
    expect(convert("", "json", "yaml")).toBe("");
  });
});

describe("share", () => {
  it("round-trips payloads", () => {
    const payload: SharePayload = {
      mode: "document",
      format: "yaml",
      docText: "name: ünïcode ✓\n",
      schemaText: "{}",
      schema: { kind: "remote", name: "x", url: "https://example.com/s.json" },
    };
    expect(decodeShare(encodeShare(payload))).toEqual(payload);
    expect(decodeShare("garbage")).toBeNull();
  });
});
