// Reads the JSON bodies of the queue's API into typed inputs, or says which field is wrong.
// This only checks shape and size (the limits in QUEUE-API.md). The rules about what a draft says belong to check_draft.
import type { AiTools, ApiError } from './types';
import type { BeginInput, CheckInput, CompleteInput, OrcidBeginInput, StageInput } from './service';

export const FIELD_MAX_CHARS = 60_000;
export const AI_TOOLS_MAX_CHARS = 200;
export const IDEMPOTENCY_KEY_MAX_CHARS = 100;
export const BODY_MAX_BYTES = 200 * 1024;

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: ApiError };

const bad = (message: string, field?: string): Parsed<never> => ({ ok: false, error: { error: 'bad_request', message, ...(field ? { field } : {}) } });

type Body = Record<string, unknown>;

/** The file text fields: missing means empty (check_draft then explains what is missing); present must be text of a sane size. */
function fileText(body: Body, field: 'draft' | 'review', required: boolean): Parsed<string | undefined> {
  const v = body[field];
  if (v === undefined || v === null) return { ok: true, value: required ? '' : undefined };
  if (typeof v !== 'string') return bad(`The ${field} should be text.`, field);
  if (v.length > FIELD_MAX_CHARS) return bad(`The ${field} is too long. The limit is ${FIELD_MAX_CHARS.toLocaleString('en-GB')} characters.`, field);
  return { ok: true, value: v };
}

function aiTools(body: Body): Parsed<AiTools | undefined> {
  const v = body.ai_tools;
  if (v === undefined || v === null) return { ok: true, value: undefined };
  if (typeof v !== 'object' || Array.isArray(v)) return bad('The AI tools should be an object with a "draft" and a "review" entry.', 'ai_tools');
  const out: AiTools = {};
  for (const key of ['draft', 'review'] as const) {
    const t = (v as Body)[key];
    if (t === undefined || t === null) continue;
    if (typeof t !== 'string') return bad(`The AI tools for the ${key} should be text.`, `ai_tools.${key}`);
    if (t.length > AI_TOOLS_MAX_CHARS) return bad(`The AI tools for the ${key} are too long. The limit is ${AI_TOOLS_MAX_CHARS} characters.`, `ai_tools.${key}`);
    if (t.trim()) out[key] = t;
  }
  return { ok: true, value: out };
}

function idempotencyKey(body: Body): Parsed<string | undefined> {
  const v = body.idempotency_key;
  if (v === undefined || v === null) return { ok: true, value: undefined };
  if (typeof v !== 'string' || !v.trim() || v.length > IDEMPOTENCY_KEY_MAX_CHARS) return bad(`The idempotency key should be text of 1 to ${IDEMPOTENCY_KEY_MAX_CHARS} characters.`, 'idempotency_key');
  return { ok: true, value: v };
}

function token(body: Body, field: string, max: number): Parsed<string> {
  const v = body[field];
  if (typeof v !== 'string' || !v || v.length > max) return bad(`"${field}" is missing or not valid.`, field);
  return { ok: true, value: v };
}

export function parseCheck(body: Body): Parsed<CheckInput> {
  const draft = fileText(body, 'draft', true);
  if (!draft.ok) return draft;
  const review = fileText(body, 'review', true);
  if (!review.ok) return review;
  const tools = aiTools(body);
  if (!tools.ok) return tools;
  if (body.consent !== undefined && body.consent !== null && typeof body.consent !== 'boolean') return bad('"consent" should be true or false.', 'consent');
  return { ok: true, value: { draft: draft.value as string, review: review.value as string, ai_tools: tools.value, consent: body.consent === true } };
}

export function parseStage(body: Body): Parsed<StageInput> {
  const draft = fileText(body, 'draft', true);
  if (!draft.ok) return draft;
  const review = fileText(body, 'review', true);
  if (!review.ok) return review;
  const tools = aiTools(body);
  if (!tools.ok) return tools;
  const key = idempotencyKey(body);
  if (!key.ok) return key;
  return { ok: true, value: { draft: draft.value as string, review: review.value as string, ai_tools: tools.value, consent: body.consent, contributor: body.contributor, idempotency_key: key.value } };
}

/** The browser's secret, as its lower-case hex SHA-256: the secret itself only comes later, to finish. */
function bindingHash(body: Body): Parsed<string> {
  const hash = body.binding_hash;
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) return bad('"binding_hash" should be the lower-case hex SHA-256 of the secret kept in the browser.', 'binding_hash');
  return { ok: true, value: hash };
}

export function parseBegin(body: Body): Parsed<BeginInput> {
  const draft = fileText(body, 'draft', false);
  if (!draft.ok) return draft;
  const review = fileText(body, 'review', false);
  if (!review.ok) return review;
  const tools = aiTools(body);
  if (!tools.ok) return tools;
  const hash = bindingHash(body);
  if (!hash.ok) return hash;
  let orcidProof: string | undefined;
  if (body.orcid_proof !== undefined && body.orcid_proof !== null) {
    if (typeof body.orcid_proof !== 'string' || !body.orcid_proof || body.orcid_proof.length > 512) return bad('"orcid_proof" is not valid.', 'orcid_proof');
    orcidProof = body.orcid_proof;
  }
  let staged: string | undefined;
  if (body.staged_id !== undefined && body.staged_id !== null) {
    if (typeof body.staged_id !== 'string' || body.staged_id.length > 100) return bad('"staged_id" is not valid.', 'staged_id');
    staged = body.staged_id;
  }
  return {
    ok: true,
    value: {
      staged_id: staged,
      draft: draft.value,
      review: review.value,
      ai_tools: tools.value,
      consent: body.consent,
      contributor: body.contributor,
      binding_hash: hash.value,
      ...(orcidProof !== undefined ? { orcid_proof: orcidProof } : {}),
    },
  };
}

/** ORCID's one-time codes are short letters and digits: anything else is refused here and never sent on to ORCID. */
export function parseOrcidComplete(body: Body): Parsed<CompleteInput> {
  const input = parseComplete(body);
  if (input.ok && !/^[A-Za-z0-9_-]{4,64}$/.test(input.value.code)) return bad('"code" is not valid.', 'code');
  return input;
}

export function parseOrcidBegin(body: Body): Parsed<OrcidBeginInput> {
  const hash = bindingHash(body);
  return hash.ok ? { ok: true, value: { binding_hash: hash.value } } : hash;
}

export function parseComplete(body: Body): Parsed<CompleteInput> {
  const code = token(body, 'code', 512);
  if (!code.ok) return code;
  const state = token(body, 'state', 256);
  if (!state.ok) return state;
  const binding = token(body, 'binding', 512);
  if (!binding.ok) return binding;
  return { ok: true, value: { code: code.value, state: state.value, binding: binding.value } };
}
