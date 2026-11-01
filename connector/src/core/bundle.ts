// A request-scoped bundle snapshot. Metadata is pinned once; every payload is verified against it.
// Parsed views are reused only inside this snapshot, never indefinitely by a mutable draft ID.
import MiniSearch from 'minisearch';
import searchConfig from './search-config.json';
import type { BundleStore } from './store';
import type {
  Finding,
  GraveyardEntry,
  GraveyardRule,
  LedgerFile,
  Meta,
  BundleFile,
  ModulesFile,
  OpenQuestion,
  PromptStructure,
  StudyIndexRecord,
  TargetGenes,
  Tradeoff,
  VersionsFile,
} from './types';

export class BundleError extends Error {}

// A study file is large and loosely shaped; the tools pick the parts they need.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type StudyFile = Record<string, any>;

export const searchOptions = searchConfig.searchOptions;
const STUDY_CACHE = 24;
const validPath = (path: string) => /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(path)
  && path.split('/').every(part => part !== '' && part !== '.' && part !== '..');
async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

function freezeMetadata<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeMetadata(child);
    Object.freeze(value);
  }
  return value;
}

export class Bundle {
  private readonly memo = new Map<string, Promise<unknown>>();
  private readonly studies = new Map<string, StudyFile>();
  private readonly inventory = new Map<string, BundleFile>();
  private metaText: string | null = null;

  constructor(
    readonly store: BundleStore,
    readonly id: string,
  ) {
    if (!/^[a-z0-9][a-z0-9.-]{0,79}$/.test(id) || id.includes('..')) throw new BundleError('Invalid bundle ID.');
  }

  private async readStore(path: string): Promise<string | null> {
    try { return await this.store.read(this.id, path); }
    catch { throw new BundleError('Unable to read bundle storage. Please retry.'); }
  }

  private once<T>(key: string, load: () => Promise<T>): Promise<T> {
    let promise = this.memo.get(key) as Promise<T> | undefined;
    if (!promise) {
      promise = load();
      this.memo.set(key, promise);
      promise.catch(() => this.memo.delete(key));
    }
    return promise;
  }

  async text(path: string): Promise<string> {
    if (!validPath(path)) throw new BundleError('Invalid bundle file path.');
    await this.meta();
    if (path === 'meta.json') return this.metaText as string;
    const pin = this.inventory.get(path);
    if (!pin) throw new BundleError(`File "${path}" is not listed in the bundle inventory.`);
    const text = await this.readStore(path);
    if (text === null) throw new BundleError(`The data bundle "${this.id}" has no file "${path}".`);
    if (new TextEncoder().encode(text).byteLength !== pin.bytes || await sha256(text) !== pin.sha256) {
      throw new BundleError(`Bundle integrity/hash mismatch for "${path}". The bundle may be updating; retry with a fresh request.`);
    }
    return text;
  }

  json<T>(path: string): Promise<T> {
    return this.once(`json:${path}`, async () => {
      const value = await this.text(path);
      try { return JSON.parse(value) as T; }
      catch { throw new BundleError(`Invalid JSON in bundle file ${path}.`); }
    });
  }

  /** True when the bundle exists in the store. */
  async exists(): Promise<boolean> {
    return (await this.readStore('meta.json')) !== null;
  }

  meta = (): Promise<Meta> => this.once('meta:snapshot', async () => {
    const raw = await this.readStore('meta.json');
    if (raw === null) throw new BundleError(`The data bundle "${this.id}" has no file "meta.json".`);
    let meta: Meta;
    try { meta = JSON.parse(raw) as Meta; }
    catch { throw new BundleError('Invalid bundle metadata JSON.'); }
    if (!meta || meta.schema !== 'openislet-bundle/1' || meta.id !== this.id
      || typeof meta.name !== 'string' || typeof meta.frozen !== 'boolean'
      || typeof meta.blueprint_release !== 'string' || !Array.isArray(meta.files)
      || typeof meta.fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(meta.fingerprint)) {
      throw new BundleError('Invalid bundle metadata identity or inventory.');
    }
    const pins = new Map<string, BundleFile>();
    for (const pin of meta.files) {
      if (!pin || typeof pin.path !== 'string' || !validPath(pin.path) || pin.path === 'meta.json'
        || !Number.isSafeInteger(pin.bytes) || pin.bytes < 0
        || typeof pin.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(pin.sha256)
        || pins.has(pin.path)) throw new BundleError('Invalid or duplicate bundle inventory entry.');
      pins.set(pin.path, Object.freeze({ ...pin }));
    }
    const fingerprint = await sha256([...pins.values()].sort((a,b) => a.path < b.path ? -1 : 1)
      .map(pin => `${pin.path}\t${pin.sha256}`).join('\n'));
    if (fingerprint !== meta.fingerprint) throw new BundleError('Bundle inventory fingerprint mismatch.');
    this.inventory.clear();
    for (const [path, pin] of pins) this.inventory.set(path, pin);
    this.metaText = raw;
    return freezeMetadata(meta);
  });
  studyIndex = () => this.json<StudyIndexRecord[]>('studies/index.json');
  versions = () => this.json<VersionsFile>('versions/versions.json');
  rules = () => this.json<GraveyardRule[]>('graveyard/rules.json');
  entries = () => this.json<GraveyardEntry[]>('graveyard/entries.json');
  modules = () => this.json<ModulesFile>('graveyard/modules.json');
  openQuestions = () => this.json<OpenQuestion[]>('questions/open-questions.json');
  ledger = () => this.json<LedgerFile>('contributions/ledger.json');
  targetGenes = () => this.json<TargetGenes>('graph/target-genes.json');
  tradeoffs = () => this.json<Tradeoff[]>('graph/tradeoffs.json');
  structure = () => this.json<PromptStructure>('prompts/structure.json');
  overview = () => this.json<Record<string, any>>('blueprint/overview.json'); // eslint-disable-line @typescript-eslint/no-explicit-any
  scores = () => this.json<Record<string, any>>('blueprint/scores.json'); // eslint-disable-line @typescript-eslint/no-explicit-any
  sections = () => this.json<{ title: string; sections: { id: string; title: string; markdown: string }[] }>('blueprint/sections.json');
  stages = () => this.json<Record<string, any>[]>('roadmap/stages.json'); // eslint-disable-line @typescript-eslint/no-explicit-any

  /**
   * Every finding. Whatever the bundle holds, no paper shows more exact wording than the per-paper ceiling (240 characters at most),
   * so every tool keeps to it. A sentence past the ceiling is withheld like the others, with its fingerprint, so a contributor's
   * quote of it can still be checked.
   */
  findings(): Promise<Finding[]> {
    return this.once('findings', async () => {
      const ceiling = (await this.meta()).quote_policy?.per_paper_verbatim_ceiling_characters;
      const allowed = typeof ceiling === 'number' && Number.isSafeInteger(ceiling) && ceiling >= 0 ? Math.min(ceiling, 240) : 0;
      const used = new Map<string, number>();
      const all: Finding[] = [];
      for (const line of (await this.text('findings.jsonl')).split('\n')) {
        if (!line) continue;
        const f = JSON.parse(line) as Finding;
        if (typeof f.quote === 'string') {
          const total = (used.get(f.pmid) ?? 0) + f.quote.length;
          if (total > allowed) {
            all.push({ ...f, quote: null, quote_sha256: f.quote_sha256 ?? (await sha256(f.quote)) });
            continue;
          }
          used.set(f.pmid, total);
        }
        all.push(f);
      }
      return all;
    });
  }

  findingsByPmid(): Promise<Map<string, Finding[]>> {
    return this.once('findingsByPmid', async () => {
      const by = new Map<string, Finding[]>();
      for (const f of await this.findings()) {
        const list = by.get(f.pmid);
        if (list) list.push(f);
        else by.set(f.pmid, [f]);
      }
      return by;
    });
  }

  findingsById(): Promise<Map<string, Finding>> {
    return this.once('findingsById', async () => new Map((await this.findings()).map((f) => [f.id, f] as const)));
  }

  studyByPmid(): Promise<Map<string, StudyIndexRecord>> {
    return this.once('studyByPmid', async () => new Map((await this.studyIndex()).map((s) => [s.pmid, s] as const)));
  }

  /** The full-text search index over studies and findings, loaded from the bundle (built by the bundle script). */
  search(): Promise<MiniSearch> {
    return this.once('search', async () =>
      MiniSearch.loadJSON(await this.text('search/index.json'), { fields: searchConfig.fields, idField: searchConfig.idField }),
    );
  }

  /** One study's full record, or null if the bundle has no such study. Recently used studies stay in memory. */
  async study(pmid: string): Promise<StudyFile | null> {
    const cached = this.studies.get(pmid);
    if (cached) return cached;
    if (!/^\d{1,9}$/.test(pmid)) return null;
    await this.meta();
    const path = `studies/${pmid}.json`;
    if (!this.inventory.has(path)) return null;
    const text = await this.text(path);
    const record = JSON.parse(text) as StudyFile;
    this.studies.set(pmid, record);
    if (this.studies.size > STUDY_CACHE) this.studies.delete(this.studies.keys().next().value as string);
    return record;
  }

  /** Withheld quotes, found by the fingerprint of the original sentence. Used to check a contributor's quote. */
  quoteFingerprints(): Promise<Map<string, Finding[]>> {
    return this.once('quoteFingerprints', async () => {
      const by = new Map<string, Finding[]>();
      for (const f of await this.findings()) if (f.quote_sha256) by.set(f.quote_sha256, [...(by.get(f.quote_sha256) ?? []), f]);
      return by;
    });
  }
}
