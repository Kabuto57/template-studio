import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { actionTimeout: 8000, baseURL: "http://localhost:4173/", viewport: { width: 1440, height: 900 }, trace: "retain-on-failure" },
  // Tests run against the production build, service worker included.
  webServer: { command: "npm run preview", url: "http://localhost:4173/", reuseExistingServer: !process.env.CI },
});
