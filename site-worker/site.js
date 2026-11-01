// The live site: Cloudflare serves the static files itself. wrangler.site.jsonc sends only /media/* here (run_worker_first),
// for the launch film, which comes from R2 (media.js).
import { isMedia, serveMedia } from './media.js';

export default {
  fetch(request, env) {
    return isMedia(new URL(request.url).pathname) ? serveMedia(request, env) : env.ASSETS.fetch(request);
  },
};
