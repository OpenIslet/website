// Runs before every test file. The sign-in library looks for this flag on the Cloudflare global; without it, it prints a warning.
(globalThis as { Cloudflare?: unknown }).Cloudflare = { compatibilityFlags: { global_fetch_strictly_public: true } };
