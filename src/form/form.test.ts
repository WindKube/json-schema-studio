import { describe, expect, it } from "vitest";
import { applyEdit } from "./edit";
import { emptyValue, pickBranch, resolve } from "./resolve";

const root = {
  $defs: {
    Base: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    Cat: { type: "object", properties: { kind: { const: "cat" }, meows: { type: "boolean" } } },
    Dog: { type: "object", properties: { kind: { const: "dog" }, barks: { type: "boolean" } } },
  },
};

describe("resolve", () => {
  it("follows local refs and merges allOf", () => {
    const s = resolve(
      {
        allOf: [
          { $ref: "#/$defs/Base" },
          { properties: { name: { type: "string" } }, required: ["name"] },
        ],
      },
      root,
    );
    expect(Object.keys(s.properties as object)).toEqual(["id", "name"]);
    expect(s.required).toEqual(["id", "name"]);
    expect(s.allOf).toBeUndefined();
  });

  it("keeps sibling keywords next to $ref", () => {
    expect(resolve({ $ref: "#/$defs/Base", description: "x" }, root).description).toBe("x");
  });
});

describe("pickBranch", () => {
  const branches = [{ $ref: "#/$defs/Cat" }, { $ref: "#/$defs/Dog" }];
  it("matches on const discriminators and types", () => {
    expect(pickBranch(branches, { kind: "dog" }, root)).toBe(1);
    expect(pickBranch(branches, { kind: "cat" }, root)).toBe(0);
    expect(pickBranch([{ type: "string" }, { type: "array" }], [1], root)).toBe(1);
    expect(pickBranch(branches, undefined, root)).toBe(0);
  });
});

describe("emptyValue", () => {
  it("prefers const/default/enum, then the type's empty value", () => {
    expect(emptyValue({ $ref: "#/$defs/Cat" }, root)).toEqual({});
    expect(emptyValue({ enum: ["a", "b"] }, root)).toBe("a");
    expect(emptyValue({ type: "integer", default: 5 }, root)).toBe(5);
    expect(emptyValue({ oneOf: [{ type: "string" }, { type: "number" }] }, root)).toBe("");
  });
});

describe("applyEdit", () => {
  it("edits YAML in place and keeps comments", () => {
    const text = "# event\nid: a # the id\nlist:\n  - 1\n  - 2\n";
    expect(applyEdit(text, "yaml", ["source"], "/x")).toBe(
      "# event\nid: a # the id\nlist:\n  - 1\n  - 2\nsource: /x\n",
    );
    expect(applyEdit(text, "yaml", ["list", 0], undefined)).toBe(
      "# event\nid: a # the id\nlist:\n  - 2\n",
    );
    expect(applyEdit("", "yaml", ["a", "b"], 1)).toBe("a:\n  b: 1\n");
    expect(applyEdit("tags: []\n", "yaml", ["tags", 0], "x")).toBe("tags:\n  - x\n");
  });

  it("edits JSON, removing array items rather than leaving holes", () => {
    expect(applyEdit('{"a":[1,2,3]}', "json", ["a", 1], undefined)).toBe(
      '{\n  "a": [\n    1,\n    3\n  ]\n}\n',
    );
    expect(applyEdit("", "json", ["a"], { b: true })).toBe('{\n  "a": {\n    "b": true\n  }\n}\n');
    expect(applyEdit('{"a":1}', "json", ["a"], undefined)).toBe("{}\n");
  });
});
