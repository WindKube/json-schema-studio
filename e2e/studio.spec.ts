import { type Browser, expect, type Page, test } from "@playwright/test";

const run = Date.now().toString(36);
const alice = `alice-${run}`;
const bob = `bob-${run}`;

const SCHEMA = `$schema: https://json-schema.org/draft/2020-12/schema
title: Order created event
# emitted once per order
type: object
required: [orderId]
properties:
  orderId:
    type: string
  email:
    type: string
  status:
    enum: [pending, paid]
`;

async function signIn(browser: Browser, login: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  const res = await page.request.post(`/auth/dev-login?login=${login}`, { data: {} });
  expect(res.ok()).toBe(true);
  return page;
}

const json = (data: unknown) => ({ data, headers: { "content-type": "application/json" } });

test("author, share, suggest, review and publish a schema", async ({ browser }) => {
  const a = await signIn(browser, alice);
  const anon = (await browser.newContext()).request;
  const stableUrl = `/s/${alice}/order-created-event/1.0.0.json`;

  await test.step("create from pasted YAML", async () => {
    await a.goto("/");
    await expect(a.getByRole("tab", { name: "My schemas · 0" })).toBeVisible();
    await a.getByRole("link", { name: /Paste JSON or YAML/ }).click();
    await a.getByLabel("Schema source").fill(SCHEMA);
    await expect(a.getByRole("status")).toContainText("Valid YAML · valid JSON Schema");
    await expect(a.getByRole("status")).toContainText("3 properties · 1 required");
    await a.getByRole("button", { name: "Open in editor" }).click();
    await expect(a).toHaveURL(/\/schemas\/\d+$/);
    await expect(a.getByLabel("Schema title")).toHaveValue("Order created event");
  });
  const id = Number(a.url().split("/").pop());

  await test.step("graph view and resizable side panel", async () => {
    await a.getByRole("button", { name: "Graph" }).click();
    const graph = a.getByTestId("schema-graph");
    await expect(graph.getByText("orderId")).toBeVisible();
    await graph.getByText("email").click();
    await expect(a.getByLabel("JSON pointer")).toHaveText("#/properties/email");
    await a.getByRole("button", { name: "Details" }).click();

    const panel = a.getByRole("complementary", { name: "Source, comments and suggestions" });
    const before = (await panel.boundingBox())?.width ?? 0;
    await a.getByRole("separator", { name: "Resize side panel" }).focus();
    await a.keyboard.press("Shift+ArrowLeft");
    await expect.poll(async () => (await panel.boundingBox())?.width ?? 0).toBeGreaterThan(before);
  });

  await test.step("examples act as contract tests", async () => {
    await a.request.post(
      `/api/schemas/${id}/examples`,
      json({
        name: "guest.yaml",
        format: "yaml",
        text: "orderId: o-1\nstatus: paid\n",
        expect: "valid",
      }),
    );
    await a.request.post(
      `/api/schemas/${id}/examples`,
      json({ name: "no-id.yaml", format: "yaml", text: "status: paid\n", expect: "invalid" }),
    );
    await a.reload();
    await a.getByRole("tab", { name: "Examples · 2" }).click();
    await a.getByRole("link", { name: /guest\.yaml/ }).click();
    await expect(a.getByRole("status")).toContainText("Meets expectation in the draft");
  });

  await test.step("publish v1.0.0", async () => {
    await a.goto(`/schemas/${id}/versions`);
    await a.getByRole("button", { name: "Publish v1.0.0" }).click();
    await expect(a.getByRole("button", { name: /v1\.0\.0\s*Latest/ })).toBeVisible();
    expect((await anon.get(stableUrl)).status()).toBe(404);
    expect((await a.request.get(stableUrl)).status()).toBe(200);
  });

  await test.step("a breaking draft is flagged and suggests a major version", async () => {
    await a.goto(`/schemas/${id}`);
    await a.getByRole("button", { name: "Edit" }).click();
    await a
      .getByLabel("Schema outline")
      .getByRole("button", { name: /^email/ })
      .click();
    await a.getByTestId("inspector").getByRole("button", { name: "Required" }).click();
    await expect
      .poll(async () => (await (await a.request.get(`/api/schemas/${id}`)).json()).draft.text)
      .toMatch(/required:.*email/);
    await a.getByRole("button", { name: "Done" }).click();
    await a.getByRole("tab", { name: /Problems/ }).click();
    await expect(a.getByText("“email” added to required")).toBeVisible();

    const draft = await (await a.request.get(`/api/schemas/${id}`)).json();
    expect(draft.draft.text).toContain("# emitted once per order");

    await a.goto(`/schemas/${id}/versions`);
    await expect(a.getByText("Breaking change detected")).toBeVisible();
    await expect(a.getByRole("button", { name: "Publish v2.0.0" })).toBeVisible();
  });

  let invite = "";
  await test.step("share with an invite link and make versions public", async () => {
    await a.goto(`/schemas/${id}/share`);
    const dialog = a.getByRole("dialog");
    await dialog.getByRole("button", { name: "Create link" }).click();
    invite = await dialog.getByLabel("Invite link", { exact: true }).inputValue();
    expect(invite).toContain("/invite/");
    await dialog.getByLabel("General access").selectOption("public");
    await expect
      .poll(async () =>
        (await a.request.get(`/s/${alice}/order-created-event/1.0.0.json`)).status(),
      )
      .toBe(200);
  });

  const b = await signIn(browser, bob);
  await test.step("a commenter joins, comments and suggests", async () => {
    await b.goto(new URL(invite).pathname);
    await expect(b).toHaveURL(new RegExp(`/schemas/${id}$`));
    await expect(b.getByRole("button", { name: "Suggest changes" })).toBeVisible();
    await expect(b.getByRole("link", { name: "Versions" })).toBeVisible();

    await b.getByRole("tab", { name: /Comments/ }).click();
    await b.getByPlaceholder(/Write a comment/).fill(`@${alice} should refunded be a status?`);
    await b.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(b.getByText("should refunded be a status?")).toBeVisible();

    await b.getByRole("button", { name: "Suggest changes" }).click();
    await b
      .getByLabel("Schema outline")
      .getByRole("button", { name: /^\(root\)/ })
      .click();
    await b.getByTestId("inspector").getByLabel("Description").fill("Emitted once per order.");
    await b.getByTestId("inspector").getByLabel("Description").blur();
    await expect(b.getByText("1 change so far")).toBeVisible();
    await b.getByPlaceholder("What does this change?").fill("Describe the event");
    await b.getByRole("button", { name: "Submit suggestion" }).click();
    await expect(b).toHaveURL(new RegExp(`/schemas/${id}/suggestions/1$`));
    await expect(b.getByText("Waiting for an owner or editor.")).toBeVisible();
  });

  await test.step("the owner is notified and approves", async () => {
    await a.goto("/");
    await expect(a.getByRole("button", { name: /Notifications, \d+ new/ })).toBeVisible();
    await a.goto(`/schemas/${id}/suggestions/1`);
    await expect(a.getByText("Applies cleanly to the current draft")).toBeVisible();
    await a.getByRole("button", { name: "Approve and apply" }).click();
    await expect(a.getByText(/Applied to the draft/)).toBeVisible();
    const after = await (await a.request.get(`/api/schemas/${id}`)).json();
    expect(after.draft.text).toContain("Emitted once per order.");
    expect(after.draft.text).toContain("# emitted once per order");
  });

  await test.step("the commenter sees the shared schema and can't publish", async () => {
    await b.goto("/");
    await b.getByRole("tab", { name: "Shared with me · 1" }).click();
    await expect(b.getByRole("link", { name: /Order created event/ })).toBeVisible();
    const res = await b.request.post(`/api/schemas/${id}/versions`, json({ semver: "9.0.0" }));
    expect(res.status()).toBe(403);
  });
});

test("redirects to sign in and back", async ({ page }) => {
  await page.goto("/catalog");
  await expect(page).toHaveURL(/\/login\?next=%2Fcatalog/);
  await expect(page.getByRole("link", { name: "Continue with GitHub" })).toHaveAttribute(
    "href",
    "/auth/github?next=%2Fcatalog",
  );
});
