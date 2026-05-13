import { defineConfig } from '@playwright/test';
import path from 'path';

export default defineConfig({
  testDir: path.join(__dirname),
  snapshotDir: path.join(__dirname, 'snapshots'),
  use: {
    headless: true,
    viewport: { width: 1000, height: 600 },
    screenshot: 'only-on-failure',
  },
});
