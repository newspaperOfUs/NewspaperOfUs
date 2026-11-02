import { defineConfig, devices } from '@playwright/test';

const API = 'http://localhost:4599';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    acceptDownloads: true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['iPhone 14'] } },
  ],
  webServer: [
    { command: 'node tests/e2e/mock-github.mjs', url: `${API}/__test/state`, reuseExistingServer: false },
    {
      // Testler production build üzerinde koşar: CSP gibi sadece build'de olan şeyler de sınanır.
      command: 'npm run fonts && npx vite build --outDir dist-e2e && npx vite preview --outDir dist-e2e --port 4173 --strictPort',
      url: 'http://localhost:4173',
      reuseExistingServer: false,
      timeout: 120_000,
      env: { VITE_GITHUB_API: API, VITE_DATA_OWNER: 'test', VITE_DATA_REPO: 'test-data', VITE_SITE_URL: 'http://localhost:4173/' },
    },
  ],
});
