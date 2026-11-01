// Contract tests for the data bundle: it must agree with the website, hold to the excerpt policy, and never change once locked.
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { contact, social } from '../../src/data/site';
import * as versions from '../../src/data/versions';
import { CONTACT_EMAIL } from '../src/core/contact';
import type { Finding, GraveyardRule, LedgerFile, Meta, OpenQuestion, PromptStructure, VersionsFile } from '../src/core/types';
import { bundleDir, connectorRoot, readJson, websiteRoot } from './helpers';

const meta = readJson<Meta>('meta.json');
const release = readJson('release.json');
const sha = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');
const studyFiles = fs.readdirSync(path.join(bundleDir, 'studies')).filter((f) => /^\d+\.json$/.test(f));
const findings = fs
  .readFileSync(path.join(bundleDir, 'findings.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Finding);

describe('the bundle agrees with the website', () => {
  it('has the counts the site prints', () => {
    expect(meta.counts.studies).toBe(release.counts.studies);
    expect(meta.counts.arms).toBe(release.counts.arms);
    expect(meta.counts.findings).toBe(release.counts.findings);
    expect(meta.counts.designs).toBe(release.counts.designs);
    expect(meta.counts.feasible).toBe(release.counts.feasible);
    expect(meta.counts.blocked).toBe(release.counts.blocked);
    expect(meta.counts.graveyard_rules).toBe(release.counts.graveyardRules);
    expect(studyFiles).toHaveLength(release.counts.studies);
    expect(findings).toHaveLength(release.counts.findings);
    expect(new Set(findings.map((f) => f.id)).size).toBe(release.counts.findings);
    expect(readJson('graveyard', 'rules.json')).toHaveLength(release.counts.graveyardRules);
    expect(meta.blueprint_release).toBe(release.version);
  });

  it('has the same numbers in the blueprint text, with nothing left unfilled', () => {
    const spec = fs.readFileSync(path.join(bundleDir, 'blueprint', 'spec.md'), 'utf8');
    expect(spec).not.toMatch(/\{\{\w+\}\}/);
    expect(spec).toContain(`${release.counts.studies} study records`);
    expect(spec).toContain(release.counts.findings.toLocaleString('en-US'));
    expect(spec).toContain(release.counts.designs.toLocaleString('en-US'));
    const overview = readJson('blueprint', 'overview.json');
    expect(overview.counts).toEqual(release.counts);
  });

  it('has the version dates the site plans', () => {
    const v = readJson<VersionsFile>('versions', 'versions.json');
    expect(v.draft.id).toBe(versions.draft.id);
    expect(v.draft.release_when_it_opens).toBe(versions.draft.release);
    expect(v.locked).toEqual([]);
    expect(v.planned.map((p) => [p.id, p.freeze_from, p.lock_date])).toEqual(versions.planned.map((p) => [p.id, p.freezeFrom, p.lock]));
    // Quarterly: each lock is three months after the one before.
    const months = v.planned.map((p) => Number(p.lock_date.slice(0, 4)) * 12 + Number(p.lock_date.slice(5, 7)));
    expect(months.slice(1).map((m, i) => m - months[i])).toEqual([3, 3, 3]);
  });

  it('sends people to the address the website shows', () => {
    expect(CONTACT_EMAIL).toBe(contact.email);
    expect(readJson('blueprint', 'overview.json').how_to_help.contact).toEqual({ email: contact.email, x: social.x.handle });
  });

  it('has a founding record that fits the ledger schema', () => {
    const ledger = readJson<LedgerFile>('contributions', 'ledger.json');
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(JSON.parse(fs.readFileSync(path.join(websiteRoot, 'docs', 'connector', 'contribution-ledger.schema.json'), 'utf8')));
    for (const rec of ledger.records) expect(validate(rec), JSON.stringify(validate.errors)).toBe(true);
    expect(ledger.records[0].id).toBe('IIP-0001');
    expect(ledger.records.every((r) => !('example' in r))).toBe(true);
  });

  it('holds open questions that point at real rules and numeric PubMed IDs', () => {
    const questions = readJson<OpenQuestion[]>('questions', 'open-questions.json');
    const rules = new Set(readJson<GraveyardRule[]>('graveyard', 'rules.json').map((r) => r.id));
    expect(questions.length).toBeGreaterThanOrEqual(10);
    for (const q of questions) {
      expect(q.id).toMatch(/^OQ-\d{3}$/);
      q.rules.forEach((r) => expect(rules.has(r), `${q.id} names ${r}`).toBe(true));
      q.pmids.forEach((p) => expect(p).toMatch(/^\d{5,9}$/));
      q.tests.forEach((t) => expect(['1', '2A', '2B', '3', '4', '5']).toContain(t));
      expect(`${q.plain}${q.detail}`).not.toMatch(/\{\{/);
    }
  });

  it('holds drafts and reviews to the templates the website shows', () => {
    const s = readJson<PromptStructure>('prompts', 'structure.json');
    const review = fs.readFileSync(path.join(bundleDir, 'prompts', 'review-template.md'), 'utf8');
    expect(review).toContain('[OPENISLET-REVIEW-v1]');
    expect(s.review.fields.map((f) => f.name)).toEqual(expect.arrayContaining(['Claim reviewed', 'Verdict', 'Confidence', 'Submit to OpenIslet?', 'In plain English']));
    expect(s.draft.fields.map((f) => f.name)).toEqual(['Type', 'Claim in one sentence', 'In plain English', 'Affects test', 'Affects design']);
    expect(s.draft.headings).toEqual(['Evidence', 'What I propose changing', 'How this could be wrong', 'Cheapest way to check it', 'AI tools used']);
    expect(s.accepted_review_verdicts).toEqual(['Supported', 'Partly supported']);
  });
});

describe('the bundle holds to the excerpt policy', () => {
  it('shows at most 240 verbatim characters from any one paper', () => {
    let largest = 0;
    for (const file of studyFiles) {
      const study = JSON.parse(fs.readFileSync(path.join(bundleDir, 'studies', file), 'utf8'));
      const shown = study.atomic_effects.map((e: { verbatim_evidence_quote: string }) => e.verbatim_evidence_quote).filter((q: string) => !q.startsWith('[REDACTED'));
      const total = shown.reduce((n: number, q: string) => n + q.length, 0);
      largest = Math.max(largest, total);
      expect(total, `${file} shows ${total} characters`).toBeLessThanOrEqual(meta.quote_policy.per_paper_verbatim_ceiling_characters);
    }
    expect(meta.quote_policy.per_paper_verbatim_ceiling_characters).toBe(240);
    expect(largest).toBeGreaterThan(0);
  });

  it('keeps the same count of quotes shown and withheld in every file that holds them', () => {
    const shown = findings.filter((f) => f.quote !== null);
    const withheld = findings.filter((f) => f.quote === null);
    expect(shown).toHaveLength(meta.quote_policy.shown_quotes);
    expect(withheld).toHaveLength(meta.quote_policy.withheld_quotes);
    for (const f of shown) expect(f.quote_sha256).toBeNull();
    for (const f of withheld) expect(f.quote_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('withholds the paper wording that the public export still carries in other fields', () => {
    // Where a quote is withheld, the outcome wording would otherwise be the first 140 characters of the same sentence.
    for (const f of findings.filter((x) => x.quote === null)) expect(f.outcome, f.id).toMatch(/^Outcome area: .*\(the study's own wording is withheld\)$/);
    for (const file of studyFiles) {
      const study = JSON.parse(fs.readFileSync(path.join(bundleDir, 'studies', file), 'utf8'));
      for (const e of study.atomic_effects) {
        if (e.verbatim_evidence_quote.startsWith('[REDACTED')) expect(e.outcome_variable_Y, file).toMatch(/^Outcome area: /);
        else expect(e.outcome_variable_Y.startsWith('Outcome area: ') || e.verbatim_evidence_quote.includes(e.outcome_variable_Y), file).toBe(true);
      }
      for (const m of study.effect_modifier_interactions ?? []) {
        for (const [k, v] of Object.entries(m)) if (/condition_and_effect$/.test(k) && typeof v === 'string') expect(v.length < 40 || v.startsWith('[')).toBe(true);
      }
    }
    expect(meta.quote_policy.guard.withheld.outcome_wording).toBeGreaterThan(2000);
  });

  it('was checked against the source texts whenever they are on this machine', () => {
    const repo = process.env.OPENISLET_REPO ?? path.resolve(websiteRoot, '..', 'OpenIslet');
    if (fs.existsSync(path.join(repo, 'data', 'dossiers'))) {
      expect(meta.quote_policy.guard.verified_against_source_texts).toBe(true);
      expect(meta.quote_policy.guard.source_texts_checked).toBeGreaterThanOrEqual(release.counts.studies);
    }
  });

  it('contains no source dossiers and no abstracts', () => {
    expect(meta.files.some((f) => /dossier|abstract/i.test(f.path))).toBe(false);
    for (const file of studyFiles.slice(0, 80)) {
      const study = JSON.parse(fs.readFileSync(path.join(bundleDir, 'studies', file), 'utf8'));
      expect(Object.keys(study)).not.toContain('abstract');
    }
  });
});

describe('a bundle is immutable', () => {
  it('lists every file with its SHA-256, and the fingerprint covers them all', () => {
    const onDisk = new Set<string>();
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else onDisk.add(path.relative(bundleDir, p));
      }
    };
    walk(bundleDir);
    onDisk.delete('meta.json');
    expect([...onDisk].sort()).toEqual(meta.files.map((f) => f.path).sort());
    for (const f of meta.files) {
      const buf = fs.readFileSync(path.join(bundleDir, f.path));
      expect(buf.length, f.path).toBe(f.bytes);
      expect(sha(buf), f.path).toBe(f.sha256);
    }
    const fingerprint = sha(Buffer.from([...meta.files].sort((a, b) => (a.path < b.path ? -1 : 1)).map((f) => `${f.path}\t${f.sha256}`).join('\n')));
    expect(fingerprint).toBe(meta.fingerprint);
  });

  it('builds the same bundle twice', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'oi-bundle-'));
    try {
      execFileSync(process.execPath, [path.join(connectorRoot, 'scripts', 'build-bundle.mjs'), '--out', path.join(out, 'a')], { stdio: 'pipe' });
      const again = JSON.parse(fs.readFileSync(path.join(out, 'a', 'meta.json'), 'utf8')) as Meta;
      expect(again.fingerprint).toBe(meta.fingerprint);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  }, 120_000);

  it('refuses to rebuild a locked version with different content', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'oi-lock-'));
    const dir = path.join(out, 'islet-1.0');
    const run = () => execFileSync(process.execPath, [path.join(connectorRoot, 'scripts', 'build-bundle.mjs'), '--id', 'islet-1.0', '--frozen', '--out', dir], { stdio: 'pipe' });
    try {
      run();
      expect(() => run()).not.toThrow(); // same content: fine
      const metaPath = path.join(dir, 'meta.json');
      const locked = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      locked.fingerprint = 'not-the-same-content';
      fs.writeFileSync(metaPath, JSON.stringify(locked));
      expect(run).toThrowError(/locked/i);
      expect(JSON.parse(fs.readFileSync(metaPath, 'utf8')).fingerprint).toBe('not-the-same-content'); // untouched
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  }, 180_000);
});
