// Who has contributed, what each submission changed, and where a submission stands. There are no scores: a person decides
// each IIP's outcome and says it in words (the vocabulary is the website's, src/data/contributions.ts, carried in the bundle).
import { type Answer, type Config, md, problem } from './answer';
import type { Bundle } from './bundle';
import { longDate } from './text';
import type { LedgerFile, LedgerRecord } from './types';

/** Where an IIP stands before a person has decided its outcome. */
const WAITING: Record<string, string> = {
  queued: 'Waiting for review',
  reviewed: 'Waiting for review',
  'needs-work': 'Needs work',
  withdrawn: 'Withdrawn',
  'closed-triage': 'Set aside',
  // Records from before outcomes were recorded.
  merged: 'Merged',
  declined: 'Not taken up',
};

/** An IIP's standing in words: its outcome once a person has decided, otherwise where it stands. */
function standingOf(r: LedgerRecord, outcomes: LedgerFile['outcomes']): string {
  if (r.founding) return 'Founding blueprint';
  if (r.outcome) return outcomes?.[r.outcome.kind]?.label ?? r.outcome.kind.replace(/_/g, ' ');
  return WAITING[r.status] ?? 'Waiting for review';
}
const versionName = (id: string) => id.replace(/^islet-/, 'Islet-');

/**
 * How far past the newest number in the record a real IIP can be. The record is updated weekly, and the queue takes at most 30
 * IIPs an hour by default (about 5,000 a week); the public repository's issues and pull requests share the numbering, so this leaves room.
 */
export const MAX_SINCE_RECORD = 10_000;

const visible = (r: LedgerRecord, cfg: Config, outcomes: LedgerFile['outcomes']) => ({
  id: r.id,
  title: r.title,
  type: r.type,
  status: r.status,
  standing: standingOf(r, outcomes),
  outcome: r.outcome ? { ...r.outcome, label: standingOf(r, outcomes) } : null,
  follow_ups: r.follow_ups ?? [],
  submitted_at: r.submitted_at,
  decided_at: r.decided_at,
  target_version: r.target_version,
  landed_in: r.landed_in,
  founding: Boolean(r.founding),
  contributor: r.contributor.handle,
  verified_through: [r.contributor.verified.github ? 'GitHub' : null, r.contributor.verified.orcid ? 'ORCID' : null].filter(Boolean),
  ai_tools_reported_by_contributor: r.models ?? (r.ai_tools ? Object.values(r.ai_tools) : []),
  public_issue: cfg.submissionsOpen ? r.issue.url : null,
});

export async function getContributions(bundle: Bundle, cfg: Config, opts: { version?: string; contributor?: string; status?: string; limit?: number }): Promise<Answer> {
  const ledger = await bundle.ledger();
  const outcomes = ledger.outcomes;
  let records = ledger.records;
  if (opts.version) records = records.filter((r) => r.target_version === opts.version || r.landed_in === opts.version);
  if (opts.contributor) records = records.filter((r) => r.contributor.handle.toLowerCase() === opts.contributor!.toLowerCase().replace(/^@/, ''));
  if (opts.status) {
    const wanted = opts.status.trim().toLowerCase();
    records = records.filter((r) => standingOf(r, outcomes).toLowerCase() === wanted || r.status === wanted || r.outcome?.kind === wanted.replace(/ /g, '_'));
  }
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const shown = [...records].sort((a, b) => b.submitted_at.localeCompare(a.submitted_at) || b.id.localeCompare(a.id)).slice(0, limit);

  // What each person's IIPs did, in words. No score, and no ranking: the newest work comes first.
  const by = new Map<string, LedgerRecord[]>();
  for (const r of records) by.set(r.contributor.handle, [...(by.get(r.contributor.handle) ?? []), r]);
  const people = [...by].map(([handle, list]) => {
    const did = new Map<string, number>();
    for (const r of list) did.set(standingOf(r, outcomes), (did.get(standingOf(r, outcomes)) ?? 0) + 1);
    return {
      handle,
      kind: list[0].contributor.kind,
      contributions: list.length,
      did: [...did].map(([what, n]) => ({ what, n })),
      latest: list.map((r) => r.submitted_at).sort().at(-1) ?? '',
      founding: list.some((r) => r.founding),
    };
  });
  people.sort((a, b) => b.latest.localeCompare(a.latest) || a.handle.localeCompare(b.handle));

  const real = records.length;
  const summary = real
    ? `${real} ${real === 1 ? 'contribution is' : 'contributions are'} on the public record${opts.version ? ` for ${opts.version}` : ''}, from ${people.length} ${people.length === 1 ? 'contributor' : 'contributors'}. ${records.some((r) => r.founding) ? 'The first is the founding blueprint itself.' : ''}`.trim()
    : 'Nothing matches yet. Contributions appear here once Islet Improvement Proposals (IIPs) are submitted and decided.';
  const body =
    md.h(1, 'Contributions') +
    '\n' +
    (shown.length
      ? md.table(
          ['Record', 'What', 'By', 'Outcome', 'Date', 'Named in'],
          shown.map((r) => [
            r.id,
            `${r.title} (${r.type})`,
            r.contributor.handle,
            standingOf(r, outcomes) + (r.outcome ? `: ${r.outcome.note}` : ''),
            longDate(r.submitted_at),
            r.landed_in ? versionName(r.landed_in) : 'not yet',
          ]),
        )
      : 'No records.\n') +
    '\n' +
    md.h(2, 'Contributors') +
    (people.length
      ? md.table(
          ['Contributor', 'Type', 'Contributions', 'What their IIPs did'],
          people.map((p) => [p.handle + (p.founding ? ' (founding)' : ''), p.kind, String(p.contributions), p.did.map((d) => (d.n > 1 ? `${d.what} × ${d.n}` : d.what)).join(', ')]),
        )
      : 'None yet.\n');
  const notes = [
    'There are no scores or rankings. In the weekly review a person decides what each IIP did and says why. IIPs that changed the blueprint, ruled out a dead end, added evidence or raised an open question are named in the next locked version.',
    'AI model names are reported by contributors and are never shown as verified.',
  ];
  if (!cfg.submissionsOpen) notes.push('Links to the public issues appear when the public queue opens.');
  return { summary, body, data: { total: real, contributors: people, records: shown.map((r) => visible(r, cfg, outcomes)), outcomes: outcomes ?? null }, notes };
}

export async function submissionStatus(bundle: Bundle, cfg: Config, idInput: string): Promise<Answer> {
  const match = /^(?:IIP-|#)?([0-9]+)$/i.exec(idInput.trim());
  const n = match ? Number(match[1]) : NaN;
  if (!Number.isSafeInteger(n) || n <= 0) return problem('The submission id is invalid.', ['Use a complete positive issue number or record id, for example 42, #42 or IIP-0042.']);
  const ledger = await bundle.ledger();
  const record = ledger.records.find((r) => r.issue.number === n);
  if (!record) {
    // "Not opened yet" is true only while the founding blueprint is the whole record; a queue closed later falls through to the
    // weekly-update answer below, since an IIP sent before it closed may still be waiting for that update.
    if (!cfg.submissionsOpen && ledger.records.length <= 1) {
      return {
        summary: 'No submissions have been received yet: the public queue has not opened. When it does, every submission gets a public page and this tool shows where it stands.',
        body: 'The public queue has not opened yet, so there is no submission with that number. The only record so far is IIP-0001, the founding blueprint.',
        data: { found: false, queue_open: false },
        notes: ['Submissions are public by design, so this tool needs no sign-in.'],
      };
    }
    const id = `IIP-${String(n).padStart(4, '0')}`;
    const newest = Math.max(0, ...ledger.records.map((r) => r.issue.number));
    if (n > newest + MAX_SINCE_RECORD) {
      const latest = `IIP-${String(newest).padStart(4, '0')}`;
      return {
        summary: `There is no ${id}: numbers that high have not been given out. The newest IIP in OpenIslet's record is ${latest}.`,
        body: `${md.h(1, `${id}: no such IIP`)}\nNumbers that high have not been given out. The newest IIP in OpenIslet's record is ${latest}. Check the number: it is the one in the link you were given when you sent it.\n`,
        data: { found: false, queue_open: cfg.submissionsOpen, id, newest_in_record: latest },
      };
    }
    // OpenIslet's record is updated in the weekly update, so an IIP sent since then is not in it yet: say so, and point to its public page.
    const url = cfg.queueIssues ? `${cfg.queueIssues}/${n}` : null;
    return {
      summary: `${id} is not in OpenIslet's record yet. New IIPs are added in the weekly update; until then, its public page on GitHub shows where it stands${url ? `: ${url}` : ''}.`,
      body:
        md.h(1, `${id}: not in the record yet`) +
        `\nIf ${id} was sent recently, it is waiting for the weekly update, when a person reviews the week's IIPs and they are added to OpenIslet's record. Until then, its public page shows its software checks and any comments${url ? `: [${id} on GitHub](${url})` : ''}.\n\nIf that page does not exist, check the number: it is the one in the link you were given when you sent it.\n`,
      data: { found: false, queue_open: cfg.submissionsOpen, id, issue_url: url },
    };
  }
  const v = visible(record, cfg, ledger.outcomes);
  const standing = standingOf(record, ledger.outcomes);
  const o = record.outcome;
  // The path an IIP takes: queued with its software checks, looked at in the weekly review, then decided.
  const stages = ['queued', 'reviewed', 'decided'];
  const decided = Boolean(o) || record.founding || record.status === 'merged' || record.status === 'declined';
  const at = decided ? 2 : record.status === 'reviewed' || record.status === 'needs-work' ? 1 : record.status === 'queued' ? 0 : -1;
  const why = o ? (ledger.outcomes?.[o.kind]?.why ?? 'Outcome') : '';
  const body =
    md.h(1, `${record.id} · ${record.title}`) +
    `\n**Where it stands:** ${standing}\n\n` +
    (o ? `**${why}:** ${o.note}${o.where ? ` (${o.where})` : ''}\n\n` : '') +
    (at >= 0 ? `Progress: ${stages.map((s, i) => (i <= at ? `**${s}**` : s)).join(' → ')}\n\n` : '') +
    `Submitted ${longDate(record.submitted_at)} by ${record.contributor.handle}. Written against ${record.target_version}.${record.landed_in ? ` Named in ${versionName(record.landed_in)}.` : ''}\n` +
    (record.follow_ups?.length ? `\n${md.h(2, 'Since then')}${record.follow_ups.map((f) => `- ${f.date ? `${longDate(f.date)}: ` : ''}${f.note}`).join('\n')}\n` : '');
  return { summary: o ? `${record.id}: ${standing}. ${o.note}` : `${record.id}: ${standing.toLowerCase()}.`, body, data: { found: true, record: v } };
}
