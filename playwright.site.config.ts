import { defineConfig, devices } from "@playwright/test";

const localChromium = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: "./site-e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:4174/panefold/",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(localChromium === undefined
          ? {}
          : {
              launchOptions: {
                executablePath: localChromium,
                args: ["--no-sandbox", "--disable-webgl"],
              },
            }),
      },
    },
    {
      name: "mobile-chromium",
      use: {
        ...devices["Pixel 7"],
        ...(localChromium === undefined
          ? {}
          : {
              launchOptions: {
                executablePath: localChromium,
                args: ["--no-sandbox", "--disable-webgl"],
              },
            }),
      },
    },
  ],
  webServer: {
    command: "pnpm build:site && pnpm --filter @panefold/site preview --host 127.0.0.1 --port 4174",
    url: "http://127.0.0.1:4174/panefold/",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
