import { expect, test } from "@playwright/test";
import { encodeShare, type SharePayload } from "../src/share";

const schemaText = JSON.stringify({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: { name: { type: "string" } },
});

const open = (page: import("@playwright/test").Page, payload: Partial<SharePayload>) =>
  page.goto(
    `/#s=${encodeShare({
      mode: "document",
      format: "yaml",
      docText: "",
      schemaText,
      schema: { kind: "custom" },
      ...payload,
    })}`,
  );

for (const [format, docText] of [
  ["yaml", "name: 42\n"],
  ["json", '{ "name": 42 }\n'],
] as const) {
  test(`flags an invalid ${format} document`, async ({ page }) => {
    await open(page, { format, docText });
    await expect(page.getByTestId("problems")).toContainText("must be string");
    await expect(page.locator(".squiggly-error, .squiggly-warning").first()).toBeVisible();
  });
}

test("validates an authored schema against its meta-schema", async ({ page }) => {
  await open(page, { mode: "schema", schemaText: '{ "type": 5 }' });
  await page.getByRole("tab", { name: /Problems/ }).click();
  await expect(page.getByTestId("schema-problems")).toContainText("Error");
  await page.getByRole("button", { name: "Test in Document mode" }).click();
  await expect(page.getByRole("button", { name: "Custom schema" })).toBeVisible();
});

test("closes the schema picker after choosing with Enter", async ({ page }) => {
  await open(page, { schema: null });
  await page.getByRole("button", { name: /No schema/ }).click();
  await page.getByPlaceholder(/Search SchemaStore/).fill("https://example.com/s.json");
  await page.keyboard.press("Enter");
  await expect(page.locator("dialog")).not.toBeVisible();
  await expect(page.getByRole("button", { name: /example\.com/ })).toBeVisible();
});

test("fills an empty document with a sample and opens the schema", async ({ page }) => {
  await open(page, { docText: "" });
  await expect(page.locator(".view-lines")).toContainText("name: string");
  await expect(page.getByText("No problems.")).toBeVisible();
  await page.getByRole("button", { name: "Open schema" }).click();
  await expect(page.getByTestId("outline")).toContainText("name");
});
