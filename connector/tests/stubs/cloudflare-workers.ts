// Stands in for Cloudflare's runtime module "cloudflare:workers", which does not exist under Node.
// The sign-in library imports it only to recognise handler classes; the connector passes plain objects, so an empty class is enough.
export class WorkerEntrypoint {}
export class DurableObject {}
export const env = {};
