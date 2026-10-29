import { defineConfig } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: "e2e",
  use: { baseURL: `http://localhost:${port}` },
  webServer: {
    command: `pnpm build && pnpm migrate && pnpm preview --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    timeout: 120_000,
  },
});
