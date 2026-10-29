import { describe, expect, it } from "vitest";
import { applySuggestion, diffSources } from "../../shared/patch";
import { runContract } from "./contract";
import { bumpFor, classify, nextVersion } from "./diff";

const base = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string", minLength: 1 },
    status: { enum: ["paid", "pending"] },
    qty: { type: "integer", minimum: 1, maximum: 10 },
  },
};
const levels = (after: object) => classify(base, after).map((c) => [c.level, c.path]);

describe("classify", () => {
  it("treats a new required field as breaking", () => {
    expect(levels({ ...base, required: ["id", "status"] })).toEqual([["breaking", "/required"]]);
  });
  it("treats an added enum value as minor and a removed one as breaking", () => {
    const widen = {
      ...base,
      properties: { ...base.properties, status: { enum: ["paid", "pending", "refunded"] } },
    };
    const narrow = { ...base, properties: { ...base.properties, status: { enum: ["paid"] } } };
    expect(levels(widen)).toEqual([["minor", "/properties/status/enum"]]);
    expect(levels(narrow)).toEqual([["breaking", "/properties/status/enum"]]);
  });
  it("compares numeric bounds by direction", () => {
    const tighter = {
      ...base,
      properties: { ...base.properties, qty: { type: "integer", minimum: 2, maximum: 20 } },
    };
    expect(levels(tighter)).toEqual([
      ["breaking", "/properties/qty/minimum"],
      ["minor", "/properties/qty/maximum"],
    ]);
  });
  it("treats type narrowing as breaking and widening as minor", () => {
    const narrowed = { ...base, properties: { ...base.properties, qty: { type: "string" } } };
    expect(
      classify(base, narrowed).some(
        (c) => c.level === "breaking" && c.path === "/properties/qty/type",
      ),
    ).toBe(true);
    const widened = {
      ...base,
      properties: { ...base.properties, id: { type: ["string", "null"], minLength: 1 } },
    };
    expect(levels(widened)).toEqual([["minor", "/properties/id/type"]]);
  });
  it("treats new optional properties as minor and closing the object as breaking", () => {
    expect(
      levels({ ...base, properties: { ...base.properties, note: { type: "string" } } }),
    ).toEqual([["minor", "/properties/note"]]);
    expect(levels({ ...base, additionalProperties: false })).toEqual([
      ["breaking", "/additionalProperties"],
    ]);
  });
  it("treats documentation changes as patch", () => {
    expect(levels({ ...base, description: "Orders" })).toEqual([["patch", "/description"]]);
  });
  it("picks the semver bump", () => {
    expect(nextVersion("1.2.3", bumpFor(classify(base, { ...base, required: [] })))).toBe("1.3.0");
    expect(nextVersion("1.2.3", bumpFor([], 1))).toBe("2.0.0");
    expect(nextVersion(null, "patch")).toBe("1.0.0");
  });
});

describe("runContract", () => {
  it("checks every example against every target", async () => {
    const before = { type: "object", properties: { email: { type: "string" } } };
    const after = { ...before, required: ["email"] };
    const matrix = await runContract(
      [
        { id: 1, text: "{}", format: "json", expect: "valid" },
        { id: 2, text: "email: 3", format: "yaml", expect: "invalid" },
      ],
      [
        { label: "1.0.0", schema: before },
        { label: "draft", schema: after },
      ],
    );
    expect(matrix[1]["1.0.0"]).toMatchObject({ valid: true, meets: true });
    expect(matrix[1].draft).toMatchObject({ valid: false, meets: false });
    expect(matrix[2].draft).toMatchObject({ valid: false, meets: true });
  });
});

describe("applySuggestion", () => {
  it("keeps YAML comments when applying a patch", () => {
    const text = "# order\ntype: object\nproperties:\n  status:\n    enum: [a, b] # states\n";
    const patch = diffSources(
      { type: "object", properties: { status: { enum: ["a", "b"] } } },
      { type: "object", properties: { status: { enum: ["a", "b", "c"] } }, required: ["status"] },
    );
    const out = applySuggestion(text, "yaml", patch);
    expect(out).toContain("# order");
    expect(out).toContain("c");
    expect(out).toContain("required:");
  });
  it("throws when the patch no longer applies", () => {
    expect(() =>
      applySuggestion('{"a": 1}', "json", [{ op: "replace", path: "/missing/x", value: 1 }]),
    ).toThrow();
  });
});
