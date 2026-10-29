import { describe, expect, it } from "vitest";
import {
  addDefinition,
  addProperty,
  appendSubschema,
  moveNode,
  removeNode,
  renameNode,
  setRequired,
  setType,
} from "./ops";
import { generateSample } from "./sample";
import { flatten, getAt } from "./tree";

const schema = {
  type: "object",
  properties: {
    a: { type: "string", minLength: 1 },
    b: { $ref: "#/$defs/Thing" },
    c: { oneOf: [{ type: "string" }, { type: "integer" }] },
  },
  required: ["a", "b"],
  $defs: { Thing: { type: "object", properties: { x: { type: "boolean" } } } },
};

describe("tree", () => {
  it("flattens properties, branches and definitions", () => {
    const all = new Map(["properties/c", "$defs/Thing"].map((k) => [k, true]));
    const nodes = flatten(schema, all);
    expect(nodes.map((n) => n.label)).toEqual([
      "(root)",
      "a",
      "b",
      "c",
      "oneOf[0]",
      "oneOf[1]",
      "$defs/Thing",
      "x",
    ]);
    expect(nodes.find((n) => n.label === "a")?.required).toBe(true);
    expect(nodes.find((n) => n.label === "x")?.path).toEqual(["$defs", "Thing", "properties", "x"]);
  });

  it("filters to matches and their ancestors", () => {
    expect(flatten(schema, new Map(), "x").map((n) => n.label)).toEqual([
      "(root)",
      "$defs/Thing",
      "x",
    ]);
  });
});

describe("ops", () => {
  it("adds uniquely named properties", () => {
    const one = addProperty(schema, []);
    const two = addProperty(one.root, []);
    expect(two.path).toEqual(["properties", "newProperty2"]);
    expect(getAt(two.root, two.path)).toEqual({ type: "string" });
  });

  it("renames properties keeping order and required", () => {
    const r = renameNode(schema, ["properties", "a"], "alpha");
    if (typeof r === "string") throw new Error(r);
    expect(Object.keys(getAt(r.root, ["properties"]) as object)).toEqual(["alpha", "b", "c"]);
    expect(getAt(r.root, ["required"])).toEqual(["alpha", "b"]);
    expect(renameNode(schema, ["properties", "a"], "b")).toBe('"b" already exists.');
  });

  it("renames definitions and rewrites $refs", () => {
    const r = renameNode(schema, ["$defs", "Thing"], "Item");
    if (typeof r === "string") throw new Error(r);
    expect(getAt(r.root, ["properties", "b", "$ref"])).toBe("#/$defs/Item");
  });

  it("removes properties and their required entry", () => {
    const next = removeNode(schema, ["properties", "a"]);
    expect(getAt(next, ["required"])).toEqual(["b"]);
    expect(getAt(next, ["properties", "a"])).toBeUndefined();
  });

  it("removes the last branch together with the keyword", () => {
    const one = removeNode(schema, ["properties", "c", "oneOf", "0"]);
    expect(getAt(one, ["properties", "c", "oneOf"])).toEqual([{ type: "integer" }]);
    const none = removeNode(one, ["properties", "c", "oneOf", "0"]);
    expect(getAt(none, ["properties", "c"])).toEqual({});
  });

  it("moves properties and array items", () => {
    const moved = moveNode(schema, ["properties", "c"], -1);
    expect(Object.keys(getAt(moved.root, ["properties"]) as object)).toEqual(["a", "c", "b"]);
    const branch = moveNode(schema, ["properties", "c", "oneOf", "0"], 1);
    expect(branch.path).toEqual(["properties", "c", "oneOf", "1"]);
    expect(getAt(branch.root, ["properties", "c", "oneOf", "0"])).toEqual({ type: "integer" });
    expect(moveNode(schema, ["properties", "a"], -1).root).toBe(schema);
  });

  it("drops keywords of types that are no longer allowed", () => {
    expect(getAt(setType(schema, ["properties", "a"], ["object"]), ["properties", "a"])).toEqual({
      type: "object",
    });
    expect(
      getAt(setType(schema, ["properties", "a"], ["string", "null"]), ["properties", "a"]),
    ).toEqual({
      type: ["string", "null"],
      minLength: 1,
    });
  });

  it("toggles required", () => {
    expect(getAt(setRequired(schema, ["properties", "c"], true), ["required"])).toEqual([
      "a",
      "b",
      "c",
    ]);
    const none = setRequired(
      setRequired(schema, ["properties", "a"], false),
      ["properties", "b"],
      false,
    );
    expect(getAt(none, ["required"])).toBeUndefined();
  });

  it("adds branches and definitions", () => {
    expect(appendSubschema(schema, ["properties", "c"], "oneOf").path).toEqual([
      "properties",
      "c",
      "oneOf",
      "2",
    ]);
    expect(addDefinition(schema, []).path).toEqual(["$defs", "NewDefinition"]);
  });

  it("does not mutate its input", () => {
    const before = JSON.stringify(schema);
    addProperty(schema, ["properties", "c"]);
    removeNode(schema, ["properties", "a"]);
    setType(schema, [], ["array"]);
    expect(JSON.stringify(schema)).toBe(before);
  });
});

describe("sample", () => {
  it("generates instances that follow the schema", () => {
    expect(generateSample(schema)).toEqual({ a: "string", b: { x: false }, c: "string" });
    expect(
      generateSample({
        type: "object",
        properties: {
          when: { type: "string", format: "date-time" },
          n: { type: "integer", minimum: 3 },
          kind: { enum: ["x", "y"] },
          list: { type: "array", items: { type: "number" } },
        },
        allOf: [{ properties: { extra: { const: 1 } } }],
      }),
    ).toEqual({ extra: 1, when: "2026-01-01T00:00:00Z", n: 3, kind: "x", list: [0] });
  });
});
