// @ts-check
import { defineConfig } from 'astro/config';
import securityHeaders from './scripts/security-headers.mjs';

// Local development build. Nothing here deploys the site.
export default defineConfig({
  // The address the site will have. It is used for canonical links, the share picture and the sitemap.
  // Nothing deploys from here.
  site: 'https://openislet.org',
  server: { port: 4321, host: false },
  devToolbar: { enabled: false },
  // After each build, writes the security headers (a strict Content-Security-Policy and friends) next to the pages.
  integrations: [securityHeaders()],
  // The connector, the X pack and the source assets are not part of the site. Keeping them out of the dev
  // server's file watcher stops their builds and test runs from triggering reloads and rescans.
  vite: {
    server: {
      watch: {
        ignored: ['**/node_modules/**', '**/.git/**', '**/connector/**', '**/social/**', '**/assets-src/**', '**/docs/**'],
      },
    },
  },
  // Old addresses keep working: the problem and help content live on the home page,
  // the connector page became the Start here guide, and Impact became Contributions.
  redirects: {
    '/problem': '/#problem',
    '/help': '/#help',
    '/mcp': '/start',
    '/impact': '/contributions',
    // Older names for the board (Contributors) and for the form (/contribute/submit) still lead here.
    '/contributors': '/contributions',
    '/contribute/submit': '/submit',
  },
});
