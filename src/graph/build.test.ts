import { describe, expect, it } from "vitest";
import { buildGraph, DEFS_ID, refTarget } from "./build";

const schema = {
  type: "object",
  required: ["owner"],
  properties: {
    owner: { $ref: "#/$defs/Person" },
    tags: { type: "array", items: { type: "string", minLength: 1 } },
  },
  $defs: {
    Person: { type: "object", properties: { name: { type: "string" } } },
    "a/b": { const: 1 },
  },
};

describe("buildGraph", () => {
  const { nodes, edges } = buildGraph(schema);
  const byId = new Map(nodes.map((n) => [n.id, n]));

  it("hangs root-level definitions off a Definitions node, labelled by name", () => {
    expect(byId.get(DEFS_ID)?.kind).toBe("defs");
    expect(byId.get("/$defs/Person")?.label).toBe("Person");
    expect(edges).toContainEqual(expect.objectContaining({ source: "/", target: DEFS_ID }));
    expect(edges).toContainEqual(
      expect.objectContaining({ source: DEFS_ID, target: "/$defs/Person" }),
    );
    expect(edges.some((e) => e.source === "/" && e.target.startsWith("/$defs"))).toBe(false);
  });

  it("links $ref to its local target", () => {
    expect(edges).toContainEqual(
      expect.objectContaining({ source: "/properties/owner", target: "/$defs/Person", ref: true }),
    );
  });

  it("shows required flags and constraint rows", () => {
    expect(byId.get("/properties/owner")?.required).toBe(true);
    expect(byId.get("/properties/tags/items")?.rows).toEqual([["minLength", "1"]]);
  });
});

describe("refTarget", () => {
  it("decodes JSON pointers and ignores remote refs", () => {
    expect(refTarget("#")).toEqual([]);
    expect(refTarget("#/$defs/a~1b")).toEqual(["$defs", "a/b"]);
    expect(refTarget("https://example.com/s.json")).toBeNull();
    expect(refTarget("#anchor")).toBeNull();
  });
});
