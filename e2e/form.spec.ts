import { expect, test } from "@playwright/test";
import { encodeShare } from "../src/share";

const schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  required: ["id", "specversion", "source"],
  properties: {
    id: { type: "string", minLength: 1 },
    specversion: { const: "1.0" },
    source: { type: "string", format: "uri-reference" },
    priority: { enum: ["low", "high"] },
    attempts: { type: "integer", minimum: 1 },
    tags: { type: "array", items: { type: "string" } },
    payload: {
      oneOf: [
        {
          title: "Text",
          type: "object",
          properties: { kind: { const: "text" }, body: { type: "string" } },
          required: ["kind"],
        },
        {
          title: "Binary",
          type: "object",
          properties: { kind: { const: "binary" }, base64: { type: "string" } },
          required: ["kind"],
        },
      ],
    },
  },
};

test("fills a document through the form and keeps YAML comments", async ({ page }) => {
  await page.goto(
    `/#s=${encodeShare({
      mode: "document",
      format: "yaml",
      docText: "# my event\nid: abc\n",
      schemaText: JSON.stringify(schema),
      schema: { kind: "custom" },
    })}`,
  );
  await page.getByRole("button", { name: "Form", exact: true }).click();
  const form = page.getByTestId("form");

  await expect(page.getByTestId("problems")).toContainText(
    "must have required property 'specversion'",
  );
  await form.getByRole("button", { name: "Set" }).click();
  await form.getByRole("textbox", { name: "source", exact: true }).fill("/orders");
  await form.getByRole("textbox", { name: "source", exact: true }).press("Enter");

  await form.getByRole("button", { name: "+ priority" }).click();
  await form.getByRole("combobox", { name: "priority", exact: true }).selectOption("high");
  await form.getByRole("button", { name: "+ attempts" }).click();
  await form.getByRole("textbox", { name: "attempts", exact: true }).fill("0");
  await form.getByRole("textbox", { name: "attempts", exact: true }).press("Enter");
  await expect(form).toContainText("must be >= 1");
  await form.getByRole("textbox", { name: "attempts", exact: true }).fill("3");
  await form.getByRole("textbox", { name: "attempts", exact: true }).press("Enter");

  await form.getByRole("button", { name: "+ tags" }).click();
  await form.getByRole("button", { name: "+ Add item" }).click();
  await form.getByRole("textbox", { name: "#1", exact: true }).fill("urgent");
  await form.getByRole("textbox", { name: "#1", exact: true }).press("Enter");

  await form.getByRole("button", { name: "+ payload" }).click();
  await form
    .getByRole("combobox", { name: "Variant", exact: true })
    .selectOption({ label: "Binary" });
  await form.getByRole("textbox", { name: "base64", exact: true }).fill("Zm9v");
  await form.getByRole("textbox", { name: "base64", exact: true }).press("Enter");

  await expect(page.getByText("No problems.")).toBeVisible();
  await page.getByRole("button", { name: "Code", exact: true }).click();
  const code = page.locator(".view-lines");
  await expect(code).toContainText("# my event");
  await expect(code).toContainText("kind: binary");
  await expect(code).toContainText("attempts: 3");
  await expect(code).toContainText("- urgent");
});
