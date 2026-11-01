// Generated metadata comes from the Python ingestor's versioned endpoint contract.
import contract from './wetlab-endpoint-contract.json';

export type WetlabReadoutValue = number | string;
export interface WetlabEmpiricalReadouts { batch_id?: string; assay_id?: string; [key: string]: WetlabReadoutValue | undefined }
export const WETLAB_CANONICAL_ENDPOINTS = contract.endpoints;
const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function numeric(value: unknown, key: string): number {
  if (typeof value !== 'number' && typeof value !== 'string') throw new Error(`${key} must be a finite decimal number`);
  if (typeof value === 'string' && !decimal.test(value.trim())) throw new Error(`${key} must be a nonempty decimal/scientific number`);
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${key} must be finite`);
  return n;
}

export function normalizeWetlabReadouts(input: WetlabEmpiricalReadouts) {
  const errors: string[] = [], validated: string[] = [], defaulted: string[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)) {
    return { payload: null, errors: ['Wet-lab readouts must be a plain object'], validated, defaulted };
  }
  const payload: WetlabEmpiricalReadouts = {};
  const allowed = new Set([...contract.metadata_keys, ...contract.endpoints.flatMap((e) => [e.meanKey, e.seKey])]);
  for (const key of Object.keys(input)) if (!allowed.has(key)) errors.push(`Unknown measurement key: ${key}`);
  for (const key of contract.metadata_keys) {
    if (input[key] !== undefined) {
      const v = input[key];
      if (typeof v !== 'string' || !v.trim() || v.length > 120) errors.push(`${key} must be a nonempty string of at most 120 characters`);
      else payload[key] = v.trim();
    }
  }
  for (const spec of contract.endpoints) {
    const value = input[spec.meanKey] === undefined ? 'UNAVAILABLE' : input[spec.meanKey];
    const se = input[spec.seKey] === undefined ? 'UNAVAILABLE' : input[spec.seKey];
    if (value === 'UNAVAILABLE') {
      if (se !== 'UNAVAILABLE') errors.push(`${spec.seKey} has no observed ${spec.meanKey}`);
      payload[spec.meanKey] = 'UNAVAILABLE';
      continue;
    }
    try {
      const n = numeric(value, spec.meanKey);
      if (n < spec.min || n > spec.max) throw new Error(`${spec.meanKey} must be within [${spec.min}, ${spec.max}]`);
      const usesDefault = input[spec.seKey] === undefined && !spec.se_required;
      const error = numeric(usesDefault ? spec.default_se : se, spec.seKey);
      if (error < contract.minimum_se) throw new Error(`${spec.seKey} must be >= ${contract.minimum_se}`);
      payload[spec.meanKey] = n; payload[spec.seKey] = error; validated.push(spec.meanKey);
      if (usesDefault) defaulted.push(spec.seKey);
    } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  }
  if (!errors.length && !validated.length) errors.push('At least one endpoint must be observed');
  return { payload: errors.length ? null : payload, errors, validated, defaulted };
}
