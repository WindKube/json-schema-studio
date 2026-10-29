import { expect, test } from "@playwright/test";
import { encodeShare } from "../src/share";

test("builds a schema visually and keeps the source in sync", async ({ page }) => {
  await page.goto(
    `/#s=${encodeShare({
      mode: "schema",
      format: "json",
      docText: "",
      schemaText: JSON.stringify({ type: "object", properties: { name: { type: "string" } } }),
      schema: null,
    })}`,
  );
  const outline = page.getByLabel("Schema outline");
  const inspector = page.getByTestId("inspector");

  await outline.getByRole("button", { name: "+ Property" }).click();
  await inspector.getByLabel("Property name").fill("age");
  await inspector.getByLabel("Property name").press("Enter");
  await inspector.getByRole("button", { name: "integer", exact: true }).click();
  await inspector.getByRole("button", { name: "Required" }).click();
  await inspector.getByLabel("minimum", { exact: true }).fill("0");
  await inspector.getByLabel("minimum", { exact: true }).press("Enter");
  await expect(page.getByTestId("node-json")).toContainText('"minimum": 0');
  await expect(page.getByTestId("outline")).toContainText("age*integer");

  await inspector.getByRole("button", { name: "Add to oneOf" }).click();
  await expect(page.getByTestId("outline")).toContainText("oneOf[0]");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("outline")).not.toContainText("oneOf[0]");

  await outline.getByRole("button", { name: /^\(root\)/ }).click();
  await expect(page.getByTestId("node-json")).toContainText('"required": [\n    "age"\n  ]');

  await page.getByRole("tab", { name: "Test instance" }).click();
  await page.getByRole("button", { name: "Generate sample from schema" }).click();
  await expect(page.getByText("Instance is valid")).toBeVisible();
  await page.getByLabel(/Instance \(JSON or YAML\)/).fill('{ "name": 1 }');
  await expect(page.getByTestId("instance-problems")).toContainText(
    "must have required property 'age'",
  );

  await page.getByRole("button", { name: "Source", exact: true }).click();
  await expect(page.locator(".view-lines")).toContainText('"age"');
});

test("edits composition, definitions and references", async ({ page }) => {
  await page.goto(
    `/#s=${encodeShare({
      mode: "schema",
      format: "json",
      docText: "",
      schemaText: JSON.stringify({ type: "object", properties: { pet: {} } }),
      schema: null,
    })}`,
  );
  const inspector = page.getByTestId("inspector");
  const outline = page.getByTestId("outline");

  await inspector.getByRole("button", { name: "+ Definition" }).click();
  await inspector.getByLabel("Definition name").fill("Cat");
  await inspector.getByLabel("Definition name").press("Enter");
  const defs = page.getByTestId("definitions");
  await expect(defs).toContainText("Catobject");

  await outline.getByRole("button", { name: /^pet/ }).click();
  await inspector.getByRole("button", { name: "Add to anyOf" }).click();
  await inspector.getByLabel("$ref").fill("#/$defs/Cat");
  await inspector.getByLabel("$ref").press("Enter");
  await expect(outline).toContainText("anyOf[0]→ Cat");

  await defs.getByRole("button", { name: /^Cat/ }).click();
  await inspector.getByLabel("Definition name").fill("Feline");
  await inspector.getByLabel("Definition name").press("Enter");
  await expect(outline).toContainText("anyOf[0]→ Feline");

  await outline.getByRole("button", { name: /anyOf\[0\]/ }).click();
  await inspector.getByRole("button", { name: "Go to definition" }).click();
  await expect(inspector.getByLabel("Definition name")).toHaveValue("Feline");
});
