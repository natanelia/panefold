import { defineConfig, devices } from "@playwright/test";

const hosted = process.env.PANEFOLD_AUDIT_URL;
export default defineConfig({
  testDir: "./audit-e2e",
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  workers: 2,
  timeout: 30_000,
  reporter: "list",
  use: {
    baseURL: hosted ?? "http://127.0.0.1:4173/",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "phone-chromium", use: { ...devices["iPhone 13"], browserName: "chromium" } },
    { name: "phone-webkit", use: { ...devices["iPhone 13"] } },
    { name: "desktop-firefox", use: { ...devices["Desktop Firefox"] } },
  ],
  ...(hosted
    ? {}
    : {
        webServer: {
          command:
            "pnpm --filter @panefold/demo... build && pnpm --filter @panefold/demo preview --host 127.0.0.1 --port 4173",
          url: "http://127.0.0.1:4173",
          reuseExistingServer: false,
          timeout: 120_000,
        },
      }),
});
