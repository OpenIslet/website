// The queue's HTTP API: /api/check, /api/begin, /api/complete, /api/staged/:id, /api/stage, and /api/orcid/begin and /api/orcid/complete.
// The contract is docs/connector/QUEUE-API.md. This file is only the web layer: CORS, reading the body within its limit,
// and sending each ApiResult. The rules themselves are in src/core/queue/service.ts.
import { BundleError, type Bundle } from './core/bundle';
import { CONTACT_EMAIL } from './core/contact';
import { BODY_MAX_BYTES, parseBegin, parseCheck, parseComplete, parseOrcidBegin, parseOrcidComplete, parseStage } from './core/queue/input';
import { type QueueService, fail } from './core/queue/service';
import type { QueueSettings } from './core/queue/settings';
import type { ApiError, ApiResult, Caller } from './core/queue/types';

export interface ApiDeps {
  service: QueueService;
  settings: QueueSettings;
  /** The bundle that answers the checks. Only built when a check is actually run. */
  bundle: () => Bundle;
  log?: (event: string, fields?: Record<string, string | number | boolean | null>) => void;
}

const SECURITY_HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } as const;

function corsHeaders(origin: string): Record<string, string> {
  return {
    'access-control-allow-origin': origin,
    vary: 'Origin',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '600',
  };
}

function send(status: number, body: unknown, cors: Record<string, string>, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...SECURITY_HEADERS, ...cors, ...extra },
  });
}

function sendResult(result: ApiResult<unknown>, cors: Record<string, string>): Response {
  return send(result.status, result.body, cors, result.ok ? {} : result.headers);
}

const errorResult = (status: number, error: string, message: string, extra: Record<string, unknown> = {}, headers?: Record<string, string>): ApiResult<never> => fail(status, error, message, extra, headers);

/** The caller's address, for the hourly limits only. It is never stored or logged as it is. */
export const callerOf = (request: Request): Caller => ({ ip: request.headers.get('cf-connecting-ip') ?? undefined });

type Body = { ok: true; value: Record<string, unknown> } | { ok: false; status: number; error: ApiError };

/** The whole body, or null when it is over `max` bytes. Stops reading as soon as it is, so a huge body is never read to the end. */
export async function readCapped(request: Request, max: number): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return bytes;
}

/** Reads the request body as JSON, refusing anything over the size limit without reading all of it. */
async function readJson(request: Request): Promise<Body> {
  const type = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') return { ok: false, status: 400, error: { error: 'bad_request', message: 'Send the request as JSON (content-type: application/json).' } };
  const bytes = await readCapped(request, BODY_MAX_BYTES);
  if (!bytes) return { ok: false, status: 413, error: { error: 'payload_too_large', message: `The request is too large. The limit is ${BODY_MAX_BYTES / 1024} KB in all.` } };
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    return { ok: false, status: 400, error: { error: 'bad_request', message: 'The request is not valid JSON.' } };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ok: false, status: 400, error: { error: 'bad_request', message: 'The request should be a JSON object.' } };
  return { ok: true, value: parsed as Record<string, unknown> };
}

const POST_ROUTES = new Set(['check', 'begin', 'complete', 'stage', 'orcid/begin', 'orcid/complete']);

export async function handleApi(request: Request, deps: ApiDeps): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get('origin');

  // A web page may call this only from an address on the allow-list. Other callers (curl, servers) send no Origin.
  let cors: Record<string, string> = { vary: 'Origin' };
  if (origin !== null) {
    if (!deps.settings.allowedOrigins.includes(origin)) {
      return send(403, { error: 'origin_not_allowed', message: 'This web address is not allowed to use the OpenIslet submission service from a web page.' }, cors);
    }
    cors = corsHeaders(origin);
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...SECURITY_HEADERS, ...cors } });

  const path = url.pathname.replace(/^\/api\//, '');
  const staged = /^staged\/([^/]+)$/.exec(path);

  try {
    if (staged) {
      if (request.method !== 'GET') return send(405, { error: 'method_not_allowed', message: 'Use GET for this address.' }, cors, { allow: 'GET, OPTIONS' });
      let id = staged[1];
      try {
        id = decodeURIComponent(id);
      } catch {
        /* an undecodable id simply will not be found */
      }
      return sendResult(await deps.service.getStaged(id), cors);
    }
    if (!POST_ROUTES.has(path)) return send(404, { error: 'not_found', message: 'There is nothing at this address. See docs/connector/QUEUE-API.md for the addresses.' }, cors);
    if (request.method !== 'POST') return send(405, { error: 'method_not_allowed', message: 'Use POST for this address.' }, cors, { allow: 'POST, OPTIONS' });

    // Closed or not set up beats everything else, even a request that could not be read: the first check of every submit path.
    // (The dry-run check is not a submit path. It answers either way.)
    if (path !== 'check') {
      const refused = deps.service.gate('web');
      if (refused) return sendResult(refused, cors);
    }

    const body = await readJson(request);
    if (!body.ok) return send(body.status, body.error, cors);
    const caller = callerOf(request);

    switch (path) {
      case 'check': {
        const input = parseCheck(body.value);
        if (!input.ok) return send(400, input.error, cors);
        return sendResult(await deps.service.check(deps.bundle(), input.value, caller), cors);
      }
      case 'stage': {
        const input = parseStage(body.value);
        if (!input.ok) return send(400, input.error, cors);
        return sendResult(await deps.service.stage(deps.bundle(), input.value, caller), cors);
      }
      case 'begin': {
        const input = parseBegin(body.value);
        if (!input.ok) return send(400, input.error, cors);
        return sendResult(await deps.service.begin(deps.bundle(), input.value, caller), cors);
      }
      case 'orcid/begin': {
        const input = parseOrcidBegin(body.value);
        if (!input.ok) return send(400, input.error, cors);
        return sendResult(await deps.service.orcidBegin(input.value, caller), cors);
      }
      case 'orcid/complete': {
        const input = parseOrcidComplete(body.value);
        if (!input.ok) return send(400, input.error, cors);
        return sendResult(await deps.service.orcidComplete(input.value), cors);
      }
      default: {
        const input = parseComplete(body.value);
        if (!input.ok) return send(400, input.error, cors);
        return sendResult(await deps.service.complete(input.value), cors);
      }
    }
  } catch (error) {
    if (error instanceof BundleError) {
      deps.log?.('queue.data_unavailable', { error: error.name });
      return sendResult(errorResult(503, 'queue_not_configured', "The connector's data could not be read right now, so nothing was saved. Please try again in a few minutes."), cors);
    }
    // Never echo the error: it could name internals. The event name and the error type are enough to find it.
    deps.log?.('queue.unexpected_error', { error: error instanceof Error ? error.name : 'unknown' });
    return sendResult(errorResult(500, 'internal_error', `Something went wrong on our side. If you were sending an IIP, check whether it is already on GitHub before you try again, or tell us at ${CONTACT_EMAIL}.`), cors);
  }
}
