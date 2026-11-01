import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // The sign-in library imports Cloudflare's runtime module, which does not exist under Node. The tests use a stand-in.
      'cloudflare:workers': path.join(here, 'tests/stubs/cloudflare-workers.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60000,
    // Keep the load on the machine light.
    maxWorkers: 2,
    setupFiles: ['tests/stubs/setup.ts'],
    // Let the stand-in above reach the library's own imports.
    server: { deps: { inline: ['@cloudflare/workers-oauth-provider'] } },
  },
});
