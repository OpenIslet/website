// The submission queue: staging, sign-in state, posting, and the limits around them.
// The contract is docs/connector/QUEUE-API.md (in the website folder). Every public method here is one endpoint of it, or one
// of the two things `submit_proposal` does. Each returns an ApiResult: the HTTP layer sends it as it is, and the tool turns an
// error into a plain-English answer.
//
// Rules this file keeps:
//   - Nothing is written to KV unless SUBMISSIONS_OPEN is true. (The dry-run check is allowed while closed; it writes nothing.)
//   - Contributor text is data. It never decides a key name, a label, or what the issue says about who submitted it.
//   - Capability ids (staged ids, sign-in state, the browser's binding secret) are never used as KV keys as they are: only their hashes.
//   - No secret, token or full IP address goes into a response, a log line, an issue or a KV key.
import type { Config } from '../answer';
import type { Bundle } from '../bundle';
import { CONTACT_EMAIL } from '../contact';
import { type Check, type DoorCheck, type DraftReport, checkDraft, runChecks } from '../draft';
import { cleanPaste } from '../template';
import { type WetlabEmpiricalReadouts } from '../wetlab-readouts';
import { hmacHex, randomToken, sha256Hex, timingSafeEqual } from './crypto';
import { normaliseContributor } from './contributor';
import { type GitHubPort, GitHubError } from './github';
import { buildIssueBody, checksComment, cleanTitle, estimateBodyLength, issueLabels, recordId, BODY_LIMIT } from './issue';
import { type QueueKV, getJson, putJson } from './kv';
import { type OrcidPort, OrcidError, makeOrcidProof, readOrcidProof } from './orcid';
import type { LimitsPort, Outcome, Reservation, Ticket } from './limits';
import { type Need, type QueueSettings, missingFor } from './settings';
import type {
  AiTools,
  ApiResult,
  BeginOutput,
  OrcidOutput,
  Caller,
  CompleteOutput,
  Contributor,
  Identity,
  QueueForTool,
  StageOutput,
  StagedOutput,
  ToolPosted,
  ToolSubmission,
  Via,
} from './types';

// ---------------------------------------------------------------------------------------------------------------
// Limits and lifetimes (QUEUE-API.md, "Limits that apply everywhere")
// ---------------------------------------------------------------------------------------------------------------

export const STAGED_TTL_SECONDS = 24 * 3600;
export const STATE_TTL_SECONDS = 15 * 60;
export const RESULT_TTL_SECONDS = 24 * 3600;
export const HOUR_SECONDS = 3600;
/**
 * Calls per hour, per hashed address. `authorize`: opening an AI app's approval page, which saves a short-lived record each time.
 * `orcid`: starting "Verify my ORCID iD", which saves a short-lived record each time.
 */
export const IP_LIMITS = { check: 30, begin: 10, register: 20, authorize: 30, orcid: 20, orcidEveryone: 200 } as const;
/** An AI app's server sends everyone's requests from a few addresses, so its share of each hourly limit is this much larger. */
export const SHARED_IP_MULTIPLIER = 10;
export type IpLimit = keyof typeof IP_LIMITS;

export const MESSAGES = {
  notOpen: 'Submissions are not open yet, so nothing was saved. Keep your two files and try again when the queue opens.',
  notConfigured: `Submissions are switched on, but the queue is not fully set up yet, so nothing was saved. Please try again later, or tell us at ${CONTACT_EMAIL}.`,
  consent: 'Please tick the box to agree that your Islet Improvement Proposal (IIP) and its blind review will be published openly under CC BY 4.0.',
  stateUnknown: 'This sign-in has expired or has already been used. Please go back to the form and press the button again.',
  binding: 'This sign-in was started in a different browser or tab, so it was stopped to keep your account safe. Please start again from the form.',
  refused: `GitHub did not accept the sign-in. Please go back to the form and press the button again. If it keeps happening, tell us at ${CONTACT_EMAIL}.`,
  stagedUnknown: 'We could not find that saved draft. Drafts are kept for 24 hours, so it may have expired. Please paste your two files into the form again.',
  filesGone: 'Your files are no longer saved here (they are kept for 24 hours). Please paste them into the form again.',
  // These two are for a failure before anything was sent to GitHub to open the issue (the sign-in, or getting the bot's token).
  webUnavailable: 'GitHub did not answer, so nothing was posted. Your files are still saved here for 24 hours: go back to the form and try again in a few minutes.',
  toolUnavailable: 'GitHub did not answer, so nothing was posted. Nothing is saved on our side either, so keep your draft and your blind review and ask again in a few minutes.',
  // GitHub refused one of our own requests in a way that trying again will not fix (see GitHubError): our set-up is at fault, not the person.
  webBroken: `The queue has a fault on our side, not yours, so nothing was posted. Your files are still saved here for 24 hours: go back to the form and try again later. If it is still broken, tell us at ${CONTACT_EMAIL}.`,
  toolBroken: `The queue has a fault on our side, not yours, so nothing was posted. Nothing is saved on our side either, so keep your draft and your blind review. Please ask again later, and if it is still broken, tell us at ${CONTACT_EMAIL}.`,
  // The posting limits are kept in one place (QUEUE_LIMITS); if it does not answer, nothing is posted.
  webLimitsDown: 'The queue could not check its limits just now, so nothing was posted. Your files are still saved here for 24 hours: go back to the form and try again in a few minutes.',
  toolLimitsDown: 'The queue could not check its limits just now, so nothing was posted. Nothing is saved on our side either, so keep your draft and your blind review and ask again in a few minutes.',
  accountGone: 'GitHub no longer has the account this AI app signed in with, so nothing was posted. Please connect the app to OpenIslet again with your current GitHub account, then ask again.',
  // "Verify my ORCID iD". Nothing here is ever about the submission itself: a failed check leaves the iD as stated.
  orcidNotConfigured: 'Checking an ORCID iD is not switched on yet. You can still add your ORCID iD: it is shown as stated by you.',
  orcidStateUnknown: 'This ORCID check has expired or has already been used. Please go back to the form and press “Verify my ORCID iD” again.',
  orcidBinding: 'This ORCID check was started in a different browser or tab, so it was stopped. Please go back to the form and press “Verify my ORCID iD” again there.',
  orcidRefused: 'ORCID did not confirm your iD. Please go back to the form and press “Verify my ORCID iD” again.',
  orcidUnavailable: 'ORCID did not answer, so your iD could not be checked. Please go back to the form and try again in a few minutes. You can also send your IIP with the iD as stated.',
  orcidBroken: `Checking an ORCID iD has a fault on our side, not yours. You can send your IIP with the iD as stated, or tell us at ${CONTACT_EMAIL}.`,
  orcidProof: 'Your ORCID check has expired (it lasts an hour). Press “Verify my ORCID iD” again, or send your IIP with the iD as stated.',
  orcidMismatch: 'The ORCID iD in the box is not the one you verified. Press “Verify my ORCID iD” again, or put the verified iD back.',
} as const;

/** Many accounts together have used up this hour's posts. */
const everyoneMessage = (minutes: number, retry: 'form' | 'ask'): string =>
  `A lot of Islet Improvement Proposals (IIPs) have arrived in the last hour, so the queue is pausing new ones for about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}. Nothing was posted. ` +
  (retry === 'form' ? 'Your files are still saved here for 24 hours: go back to the form and try again then.' : 'Keep your draft and your blind review and ask again then.');

/** The same IIP is being posted right now (another tab, a double press, or a retry while the first was still going). */
const busyMessage = (queueUrl: string): string =>
  `This Islet Improvement Proposal (IIP) is being posted right now, from another tab or an earlier try. Please wait a minute, then look at the public queue: ${queueUrl}. If it is not there, try again.`;

/**
 * When the request to open the issue was sent and no clear answer came back, GitHub may have made the issue, so this never says that
 * nothing was posted. It sends the person to look at the public queue before trying again.
 */
export const unsureMessage = (queueUrl: string, retry: 'form' | 'ask'): string =>
  `GitHub did not answer in time, so we can’t be sure whether your Islet Improvement Proposal (IIP) was posted. Please look at the public queue before you try again: ${queueUrl}. ` +
  (retry === 'form'
    ? 'If it is there, you are done. If it is not, go back to the form and press the button again. Your files are still saved here for 24 hours.'
    : 'If it is there, you are done. If it is not, keep your draft and your blind review and ask again in a few minutes.');

// ---------------------------------------------------------------------------------------------------------------
// What is stored
// ---------------------------------------------------------------------------------------------------------------

/** The part of the check report the issue and its first comment need, kept so they say what the person saw. */
interface StoredReport {
  door: DoorCheck[];
  checks: Check[];
  labels: string[];
  title: string | null;
  claim: string | null;
  pmids: string[];
  ai_tools: { draft: string; review: string };
}

/** An IIP waiting for its author to sign in. Kept for 24 hours. */
interface StagedRecord {
  v: 1;
  draft: string;
  review: string;
  ai_tools: AiTools;
  contributor: Contributor;
  via: 'web_form' | 'mcp_link';
  idempotency_key: string | null;
  wetlab: WetlabEmpiricalReadouts | null;
  written_against: string;
  report: StoredReport;
  created_at: number;
  expires_at: number;
}

/** An ORCID check in progress. Single use, and nothing is kept once it has been used. */
interface OrcidStateRecord {
  v: 1;
  binding_hash: string;
  status: 'open' | 'used';
  expires_at: number;
}

/** A sign-in in progress. Single use: once used it stays as a marker, so a repeated call can be answered the same way. */
interface StateRecord {
  v: 1;
  staged_id: string;
  binding_hash: string;
  submission_sha256: string;
  status: 'open' | 'used';
  expires_at: number;
  /** The posted answer, kept here as well as in the result record, so a repeat of this sign-in finds it if either was saved. */
  result?: CompleteOutput;
}

// Lifetimes may change independently; all approved content, provenance and checks are bound to the sign-in.
const submissionContent = ({ created_at: _created, expires_at: _expires, ...content }: StagedRecord): string => JSON.stringify(content);

const toStored = (r: DraftReport): StoredReport => ({
  door: r.door,
  checks: r.checks,
  labels: r.labels,
  title: r.title,
  claim: r.claim,
  pmids: r.pmids.map((p) => p.pmid),
  ai_tools: r.ai_tools,
});

// ---------------------------------------------------------------------------------------------------------------
// Inputs (already checked for type by the HTTP layer)
// ---------------------------------------------------------------------------------------------------------------

export interface CheckInput {
  draft: string;
  review: string;
  ai_tools?: AiTools;
  consent?: boolean;
}
export interface StageInput {
  draft: string;
  review: string;
  ai_tools?: AiTools;
  consent: unknown;
  contributor?: unknown;
  idempotency_key?: string;
}
export interface BeginInput {
  staged_id?: string;
  draft?: string;
  review?: string;
  ai_tools?: AiTools;
  consent: unknown;
  contributor?: unknown;
  binding_hash: string;
  /** From /api/orcid/complete, when the person verified their ORCID iD on the form. */
  orcid_proof?: string;
}
export interface CompleteInput {
  code: string;
  state: string;
  binding: string;
}
export interface OrcidBeginInput {
  binding_hash: string;
}
export type OrcidCompleteInput = CompleteInput;

export interface QueueDeps {
  /** Absent when the KV binding is not set up; every path that needs it then answers `queue_not_configured`. */
  kv?: QueueKV;
  /** The exact posting limits (the QUEUE_LIMITS Durable Object). Absent means every posting path answers `queue_not_configured`. */
  limits?: LimitsPort;
  settings: QueueSettings;
  config: Config;
  github: GitHubPort;
  /** "Verify my ORCID iD". Absent until ORCID's client id and secret are set: /api/orcid/* then answer `orcid_not_configured`. */
  orcid?: OrcidPort;
  now?: () => number;
  /** Run something after the response is sent (the Worker's waitUntil). Used to let go of the GitHub user token. */
  defer?: (work: Promise<unknown>) => void;
  /** Names and counts only. Never pass a token, a key, an address or any contributor text. */
  log?: (event: string, fields?: Record<string, string | number | boolean | null>) => void;
}

export const fail = (status: number, error: string, message: string, extra: Record<string, unknown> = {}, headers?: Record<string, string>): ApiResult<never> => ({
  ok: false,
  status,
  body: { error, message, ...extra },
  ...(headers ? { headers } : {}),
});
const ok = <T>(body: T): ApiResult<T> => ({ ok: true, status: 200, body });

const isStagedId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{22}$/.test(id);
const iso = (ms: number): string => new Date(ms).toISOString();
/** JSON with every object's keys in order, so the same values always give the same text. */
const stableJson = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v));
const utcDate = (ms: number): string => iso(ms).slice(0, 10);
const secondsToNextHour = (ms: number): number => Math.max(1, Math.ceil((HOUR_SECONDS * 1000 - (ms % (HOUR_SECONDS * 1000))) / 1000));

export class QueueService implements QueueForTool {
  private readonly now: () => number;

  constructor(private readonly deps: QueueDeps) {
    this.now = deps.now ?? Date.now;
  }

  // ---- Small helpers ----

  private log(event: string, fields?: Record<string, string | number | boolean | null>): void {
    this.deps.log?.(event, fields);
  }

  private get kv(): QueueKV {
    if (!this.deps.kv) throw new Error('QUEUE_KV is not bound');
    return this.deps.kv;
  }

  get open(): boolean {
    return this.deps.config.submissionsOpen;
  }

  /** Names of settings this kind of path is missing. Empty when ready. */
  missing(need: Need): string[] {
    return missingFor(this.deps.settings, { kv: !!this.deps.kv, limits: !!this.deps.limits }, need);
  }

  ready(kind: 'post' | 'link'): boolean {
    return this.open && this.missing(kind === 'post' ? 'post' : 'web').length === 0;
  }

  /** Open? Configured? The first two checks of every submit path. Null means go on. */
  gate(need: Need): ApiResult<never> | null {
    if (!this.open) return fail(503, 'queue_not_open', MESSAGES.notOpen);
    const missing = this.missing(need);
    if (missing.length) {
      this.log('queue.not_configured', { missing: missing.join(',') });
      return fail(503, 'queue_not_configured', MESSAGES.notConfigured);
    }
    return null;
  }

  private signingKey(): string {
    const key = this.deps.settings.signingKey;
    if (!key) throw new Error('STATE_SIGNING_KEY is not set');
    return key;
  }

  /** The caller's address as a short digest that changes every day. The address itself is never kept. */
  private async callerKey(caller?: Caller): Promise<string> {
    return (await hmacHex(this.signingKey(), `ip:${utcDate(this.now())}:${caller?.ip ?? 'unknown'}`)).slice(0, 32);
  }

  /** Counts a call against the hourly limit for this address. Returns a 429 when the limit is used up. */
  async hit(kind: IpLimit, caller?: Caller): Promise<ApiResult<never> | null> {
    const t = this.now();
    const wait = secondsToNextHour(t);
    const key = `rl:ip:${kind}:${Math.floor(t / (HOUR_SECONDS * 1000))}:${await this.callerKey(caller)}`;
    const count = Number(await this.kv.get(key)) || 0;
    if (count >= IP_LIMITS[kind] * this.deps.settings.ipLimitMultiplier * (caller?.shared ? SHARED_IP_MULTIPLIER : 1)) {
      this.log('queue.rate_limited', { kind });
      const minutes = Math.max(1, Math.ceil(wait / 60));
      return fail(429, 'rate_limited', `There have been a lot of requests from this connection. Please wait about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} and try again.`, { retry_after_seconds: wait }, { 'retry-after': String(wait) });
    }
    // KV takes about one write a second per key. When two calls land together the second write can fail; that only undercounts,
    // so it must not turn into an error for the person.
    try {
      await this.kv.put(key, String(count + 1), { expirationTtl: wait + 60 });
    } catch {
      this.log('queue.rate_counter_failed', { kind });
    }
    return null;
  }

  private get limits(): LimitsPort {
    if (!this.deps.limits) throw new Error('QUEUE_LIMITS is not bound');
    return this.deps.limits;
  }

  /** The wet-lab readouts with their keys in order, so the same values always count as the same IIP. Undefined when there are none. */
  private labPart = (wetlab: WetlabEmpiricalReadouts | null): string | undefined => (wetlab ? stableJson(wetlab) : undefined);

  /**
   * The same account sending the same draft, review and wet-lab readouts: one fingerprint, so the second try gets the first answer.
   * Changed readouts under the same prose are a new IIP, never folded into the first one's answer.
   */
  private async fingerprint(account: number, draft: string, review: string, wetlab: WetlabEmpiricalReadouts | null): Promise<string> {
    const lab = this.labPart(wetlab);
    return sha256Hex([String(account), await sha256Hex(draft), await sha256Hex(review), ...(lab === undefined ? [] : [await sha256Hex(lab)])].join('\n'));
  }

  /**
   * Takes a place under the posting limits before anything goes to GitHub. Returns the ticket to finish with, or the answer to
   * give instead: a limit, the same IIP in progress, the earlier answer for the same IIP, or the limits not answering.
   */
  private async reservePost(account: number, draft: string, review: string, wetlab: WetlabEmpiricalReadouts | null, retry: 'form' | 'ask'): Promise<{ ticket: Ticket } | { answer: ApiResult<CompleteOutput> }> {
    const s = this.deps.settings;
    const fingerprint = await this.fingerprint(account, draft, review, wetlab);
    // Posted, but the limits could not record it at the time (finishPost): still the first answer, never a second issue.
    const kept = await getJson<CompleteOutput>(this.kv, this.postedKey(fingerprint));
    if (kept) {
      this.log('queue.duplicate', { issue: kept.issue.number });
      return { answer: ok(kept) };
    }
    let r: Reservation;
    try {
      r = await this.limits.reserve({ account, fingerprint, now: this.now(), dailyLimit: s.dailyLimit, hourlyLimit: s.hourlyLimit });
    } catch {
      this.log('queue.limits_unavailable');
      return { answer: fail(503, 'queue_unavailable', retry === 'form' ? MESSAGES.webLimitsDown : MESSAGES.toolLimitsDown) };
    }
    if (r.ok) return { ticket: r.ticket };
    if (r.reason === 'duplicate') {
      this.log('queue.duplicate', { issue: r.result.issue.number });
      return { answer: ok(r.result) };
    }
    if (r.reason === 'busy') {
      this.log('queue.in_progress');
      return { answer: fail(409, 'in_progress', busyMessage(this.queueUrl()), { retry_after_seconds: r.retry_after_seconds }, { 'retry-after': String(r.retry_after_seconds) }) };
    }
    const wait = r.retry_after_seconds;
    this.log('queue.rate_limited', { kind: r.reason });
    const message =
      r.reason === 'account'
        ? `This GitHub account has already sent ${s.dailyLimit} ${s.dailyLimit === 1 ? 'Islet Improvement Proposal (IIP)' : 'Islet Improvement Proposals (IIPs)'} today, which is the daily limit. Please try again after midnight UTC.`
        : everyoneMessage(Math.max(1, Math.ceil(wait / 60)), retry);
    return { answer: fail(429, 'rate_limited', message, { retry_after_seconds: wait }, { 'retry-after': String(wait) }) };
  }

  /**
   * Records how the post went. A failure here never changes the answer: the issue is already open, or already refused. A post that
   * went through is tried three times, and if the limits still do not answer it is kept in KV for a day instead, so the same IIP
   * is answered with its issue once its hold in the limits runs out (reservePost), never posted again.
   */
  private async finishPost(ticket: Ticket, outcome: Outcome): Promise<void> {
    const tries = 'posted' in outcome ? 3 : 1;
    for (let attempt = 1; attempt <= tries; attempt++) {
      try {
        await this.limits.finish(ticket, outcome, this.now());
        return;
      } catch {
        this.log('queue.limits_unavailable');
      }
    }
    if ('posted' in outcome) {
      try {
        await putJson(this.kv, this.postedKey(ticket.fingerprint), outcome.posted, RESULT_TTL_SECONDS);
      } catch {
        this.log('queue.posted_unrecorded', { issue: outcome.posted.issue.number });
      }
    }
  }

  /** The fingerprint is already a hash of the account, both files and any wet-lab readouts. */
  private postedKey = (fingerprint: string) => `posted:${fingerprint}`;

  private stagedKey = async (id: string) => `staged:${await sha256Hex(id)}`;
  private stateKey = async (state: string) => `state:${await sha256Hex(state)}`;
  private orcidStateKey = async (state: string) => `orcid-state:${await sha256Hex(state)}`;
  private resultKey = async (stagedId: string) => `result:${await sha256Hex(stagedId)}`;

  /**
   * The key for a retried call: the caller's own key, tied to the exact text, so one person's key can never fetch another's draft.
   * `rest` is everything else a staged record holds, so a retry that changes any of it is a new submission.
   */
  private async idemKey(kind: 'post' | 'stage', who: string, key: string, draft: string, review: string, rest?: string): Promise<string> {
    const parts = [who, key, await sha256Hex(draft), await sha256Hex(review), ...(rest === undefined ? [] : [await sha256Hex(rest)])];
    return `idem:${kind}:${await sha256Hex(parts.join('\n'))}`;
  }

  private async loadStaged(id: unknown): Promise<StagedRecord | null> {
    if (!isStagedId(id)) return null;
    const rec = await getJson<StagedRecord>(this.kv, await this.stagedKey(id));
    if (!rec || rec.v !== 1 || typeof rec.draft !== 'string' || typeof rec.review !== 'string' || rec.expires_at <= this.now()) return null;
    return rec;
  }

  // ---- Checking a submission (shared by stage and begin) ----

  /**
   * The rules in the contract's order: the basic rules of check_draft, then consent, then the contributor's own fields.
   * Consent is judged on its own, so a missing tick is reported as `consent_needed` and not as a failed basic rule.
   */
  private async prepare(
    bundle: Bundle,
    a: {
      draft: string;
      review: string;
      ai_tools: AiTools;
      consent: unknown;
      contributor: unknown;
      wetlab: WetlabEmpiricalReadouts | null;
      via: 'web_form' | 'mcp_link';
      idempotency_key: string | null;
      report?: DraftReport;
    },
  ): Promise<ApiResult<StagedRecord>> {
    const report =
      a.report ??
      (await runChecks(bundle, this.deps.config, {
        draft: a.draft,
        review: a.review,
        ai_tools: a.ai_tools,
        contributor: a.contributor,
        idempotency_key: a.idempotency_key ?? undefined,
        consent: true,
        ...(a.wetlab ? { wetlab_empirical_readouts: a.wetlab } : {}),
      }));
    if (!report.ready) return this.basicRules(report.door, report.fix);
    if (a.consent !== true) return fail(422, 'consent_needed', MESSAGES.consent);
    const contributor = normaliseContributor(a.contributor);
    if (!contributor.ok) return fail(422, 'bad_contributor', contributor.message, { field: contributor.field });
    const meta = await bundle.meta();
    const t = this.now();
    const record: StagedRecord = {
      v: 1,
      // The file inside what was pasted (the checks above read the same), so the public issue never carries the AI's chatter.
      draft: cleanPaste(a.draft, 'draft').text,
      review: cleanPaste(a.review, 'review').text,
      ai_tools: a.ai_tools,
      contributor: contributor.value,
      via: a.via,
      idempotency_key: a.idempotency_key,
      wetlab: a.wetlab,
      written_against: `${meta.id} (blueprint release ${meta.blueprint_release})`,
      report: toStored(report),
      created_at: t,
      expires_at: t + STAGED_TTL_SECONDS * 1000,
    };
    // One issue holds the draft and the review. If they cannot fit, say so now, not when GitHub refuses.
    if (this.tooLarge(record)) return this.sizeFailure(report.door);
    return ok(record);
  }

  private tooLarge(r: StagedRecord): boolean {
    return (
      estimateBodyLength({
        via: 'web_form',
        contributor: r.contributor,
        aiTools: r.report.ai_tools,
        writtenAgainst: r.written_against,
        draft: r.draft,
        review: r.review,
        claim: r.report.claim,
        pmids: r.report.pmids,
        idempotencyKey: r.idempotency_key,
        wetlab: r.wetlab,
      }) > BODY_LIMIT
    );
  }

  /** Both files pass on their own but cannot share one GitHub issue. Reported as a basic rule so it reads like the others. */
  private sizeFailure(door: DoorCheck[]): ApiResult<never> {
    const size: DoorCheck = {
      id: 'size',
      name: 'Not too large',
      status: 'fail',
      detail: 'Together, the draft and the review are too long to be published as one public issue.',
      fix: 'Shorten it. One IIP should be one claim.',
      problem: 'the draft and the review together are too large',
    };
    return this.basicRules([...door.filter((d) => d.id !== 'size'), size], [`${size.name}: ${size.detail} ${size.fix}`]);
  }

  private basicRules(door: DoorCheck[], fix: string[]): ApiResult<never> {
    const fails = door.filter((d) => d.status === 'fail');
    const things = `${fails.length} ${fails.length === 1 ? 'thing needs' : 'things need'}`;
    return fail(422, 'basic_rules', `Not sent. ${things} fixing first: ${fails.slice(0, 3).map((f) => f.problem ?? f.name).join('; ')}.`, { what_to_fix: fix, door });
  }

  // ---- POST /api/check ----

  async check(bundle: Bundle, input: CheckInput, caller?: Caller): Promise<ApiResult<Record<string, unknown>>> {
    // The dry run works while the queue is closed, and then it touches nothing. Once open, it is rate limited.
    if (this.open) {
      const missing = this.missing('check');
      if (missing.length) {
        this.log('queue.not_configured', { missing: missing.join(',') });
        return fail(503, 'queue_not_configured', MESSAGES.notConfigured);
      }
      const limited = await this.hit('check', caller);
      if (limited) return limited;
    }
    const answer = await checkDraft(bundle, this.deps.config, { draft: input.draft, review: input.review, ai_tools: input.ai_tools, consent: input.consent });
    return ok({ ...answer.data, summary: answer.summary });
  }

  // ---- POST /api/stage, and submit_proposal without a token ----

  async stage(bundle: Bundle, input: StageInput, caller?: Caller): Promise<ApiResult<StageOutput>> {
    return this.stageCore(bundle, {
      draft: input.draft,
      review: input.review,
      ai_tools: input.ai_tools ?? {},
      consent: input.consent,
      contributor: input.contributor,
      idempotency_key: input.idempotency_key ?? null,
      wetlab: null,
      caller,
    });
  }

  async stageForLink(a: ToolSubmission): Promise<ApiResult<StageOutput>> {
    return this.stageCore(a.bundle, {
      draft: a.draft,
      review: a.review,
      ai_tools: a.ai_tools ?? {},
      consent: true, // submit_proposal has already required it
      contributor: a.contributor,
      idempotency_key: a.idempotency_key ?? null,
      wetlab: a.wetlab_empirical_readouts ?? null,
      caller: a.caller,
      report: a.report,
    });
  }

  private async stageCore(
    bundle: Bundle,
    a: { draft: string; review: string; ai_tools: AiTools; consent: unknown; contributor: unknown; idempotency_key: string | null; wetlab: WetlabEmpiricalReadouts | null; caller?: Caller; report?: DraftReport },
  ): Promise<ApiResult<StageOutput>> {
    const closed = this.gate('web');
    if (closed) return closed;
    const limited = await this.hit('begin', a.caller);
    if (limited) return limited;

    // A retry with the same key and the same submission gets the same link while the draft is still saved. Anyone may stage, so
    // the key covers every field of the record and a retry needs the consent tick too: it can only return what its caller sent.
    const rest = stableJson({ ai_tools: a.ai_tools, contributor: a.contributor ?? null, wetlab: a.wetlab });
    const idem = a.idempotency_key && a.consent === true ? await this.idemKey('stage', 'anyone', a.idempotency_key, a.draft, a.review, rest) : null;
    if (idem) {
      const prior = await getJson<{ staged_id: string }>(this.kv, idem);
      const still = prior ? await this.loadStaged(prior.staged_id) : null;
      if (prior && still) return ok(this.stageOutput(prior.staged_id, still.expires_at));
    }

    const prepared = await this.prepare(bundle, {
      draft: a.draft,
      review: a.review,
      ai_tools: a.ai_tools,
      consent: a.consent,
      contributor: a.contributor,
      wetlab: a.wetlab,
      via: 'mcp_link',
      idempotency_key: a.idempotency_key,
      report: a.report,
    });
    if (!prepared.ok) return prepared;
    const id = randomToken();
    await putJson(this.kv, await this.stagedKey(id), prepared.body, STAGED_TTL_SECONDS);
    if (idem) await putJson(this.kv, idem, { staged_id: id }, STAGED_TTL_SECONDS);
    this.log('queue.staged', { via: 'mcp_link' });
    return ok(this.stageOutput(id, prepared.body.expires_at));
  }

  private stageOutput(id: string, expiresAt: number): StageOutput {
    // After a #, so the id never goes to a server: not in the page request, logs or a Referer. The form reads it and clears it.
    return { staged_id: id, form_url: `${this.deps.settings.siteOrigin}/submit#staged=${id}`, expires_at: iso(expiresAt) };
  }

  // ---- GET /api/staged/:id ----

  async getStaged(id: string): Promise<ApiResult<StagedOutput>> {
    const closed = this.gate('web');
    if (closed) return closed;
    const rec = await this.loadStaged(id);
    if (!rec) return fail(404, 'staged_unknown', MESSAGES.stagedUnknown);
    // The form fills its boxes from this. A verified mark never travels with it: only a fresh ORCID check sets one again.
    const { orcid_verified: _verified, ...contributor } = rec.contributor;
    return ok({ draft: rec.draft, review: rec.review, ai_tools: rec.ai_tools, contributor, expires_at: iso(rec.expires_at) });
  }

  // ---- POST /api/begin ----

  async begin(bundle: Bundle, input: BeginInput, caller?: Caller): Promise<ApiResult<BeginOutput>> {
    const closed = this.gate('web');
    if (closed) return closed;
    const limited = await this.hit('begin', caller);
    if (limited) return limited;

    // The files come from the form, from an earlier staging by the connector, or both (typed values win).
    const base = input.staged_id !== undefined ? await this.loadStaged(input.staged_id) : null;
    const typedBoth = input.draft !== undefined && input.review !== undefined;
    if (input.staged_id !== undefined && !base && !typedBoth) return fail(404, 'staged_unknown', MESSAGES.stagedUnknown);

    const prepared = await this.prepare(bundle, {
      draft: input.draft ?? base?.draft ?? '',
      review: input.review ?? base?.review ?? '',
      ai_tools: input.ai_tools ?? base?.ai_tools ?? {},
      consent: input.consent,
      contributor: input.contributor !== undefined ? input.contributor : base?.contributor,
      wetlab: base?.wetlab ?? null,
      via: base?.via ?? 'web_form',
      idempotency_key: base?.idempotency_key ?? null,
    });
    if (!prepared.ok) return prepared;

    // A verified ORCID iD: only from a proof this Worker signed in the last hour, and only for the iD the proof names. This is the one
    // place the flag is ever set (prepare's normaliseContributor drops anything but the three typed fields).
    if (input.orcid_proof !== undefined) {
      const proven = await readOrcidProof(this.signingKey(), input.orcid_proof, this.deps.settings.orcidBase, this.now());
      if (!proven) return fail(422, 'orcid_proof_invalid', MESSAGES.orcidProof, { field: 'orcid' });
      const c = prepared.body.contributor;
      if (c.orcid !== undefined && c.orcid !== proven) return fail(422, 'orcid_mismatch', MESSAGES.orcidMismatch, { field: 'orcid' });
      prepared.body.contributor = { ...c, orcid: proven, orcid_verified: true };
      if (this.tooLarge(prepared.body)) return this.sizeFailure(prepared.body.report.door);
    }

    // Never replace content that an earlier sign-in approved. Identical retries may reuse the immutable record;
    // edits (including attachments, contributor metadata, source version or the check report) get a separate record.
    const sameContent = base && submissionContent(base) === submissionContent(prepared.body);
    const reuse = sameContent && base.expires_at > this.now() + STATE_TTL_SECONDS * 1000 && isStagedId(input.staged_id);
    const stagedId = reuse ? input.staged_id as string : randomToken();
    if (!reuse) await putJson(this.kv, await this.stagedKey(stagedId), prepared.body, STAGED_TTL_SECONDS);

    const state = randomToken();
    const stateRecord: StateRecord = { v: 1, staged_id: stagedId, binding_hash: input.binding_hash, submission_sha256: await sha256Hex(submissionContent(prepared.body)), status: 'open', expires_at: this.now() + STATE_TTL_SECONDS * 1000 };
    await putJson(this.kv, await this.stateKey(state), stateRecord, STATE_TTL_SECONDS);

    const s = this.deps.settings;
    const url = new URL(`${s.githubWebBase}/login/oauth/authorize`);
    url.searchParams.set('client_id', s.clientId as string);
    url.searchParams.set('redirect_uri', `${s.siteOrigin}/submit/finish`);
    url.searchParams.set('state', state);
    url.searchParams.set('allow_signup', 'true');
    this.log('queue.begin', { via: prepared.body.via });
    return ok({ authorize_url: url.href, expires_at: iso(stateRecord.expires_at), staged_id: stagedId });
  }

  // ---- POST /api/complete ----

  async complete(input: CompleteInput): Promise<ApiResult<CompleteOutput>> {
    const closed = this.gate('web');
    if (closed) return closed;

    const stateKey = await this.stateKey(input.state);
    const rec = await getJson<StateRecord>(this.kv, stateKey);
    // An open sign-in lasts 15 minutes. A used one is kept for a day, only so a repeat can be answered the same way.
    if (!rec || rec.v !== 1 || !isStagedId(rec.staged_id) || !/^[0-9a-f]{64}$/.test(rec.submission_sha256 ?? '')
      || !['open', 'used'].includes(rec.status) || (rec.status === 'open' && rec.expires_at <= this.now())) return fail(400, 'state_unknown', MESSAGES.stateUnknown);
    const bindingOk = timingSafeEqual(await sha256Hex(input.binding), rec.binding_hash);

    if (rec.status === 'used') {
      // A repeated call from the same browser gets the first answer, and never a second issue.
      if (!bindingOk) return fail(400, 'binding_mismatch', MESSAGES.binding);
      const prior = (await getJson<CompleteOutput>(this.kv, await this.resultKey(rec.staged_id))) ?? rec.result;
      return prior ? ok(prior) : fail(400, 'state_unknown', MESSAGES.stateUnknown);
    }

    // Single use: mark it used before anything else can go wrong. It stays for a day so a repeat can be recognised.
    await putJson(this.kv, stateKey, { ...rec, status: 'used' } satisfies StateRecord, RESULT_TTL_SECONDS);
    if (!bindingOk) return fail(400, 'binding_mismatch', MESSAGES.binding);

    const staged = await this.loadStaged(rec.staged_id);
    if (!staged) {
      const prior = await getJson<CompleteOutput>(this.kv, await this.resultKey(rec.staged_id));
      return prior ? ok(prior) : fail(400, 'state_unknown', MESSAGES.filesGone);
    }
    if (!timingSafeEqual(await sha256Hex(submissionContent(staged)), rec.submission_sha256)) {
      return fail(400, 'state_unknown', MESSAGES.stateUnknown);
    }
    const earlier = await getJson<CompleteOutput>(this.kv, await this.resultKey(rec.staged_id));
    if (earlier) return ok(earlier);

    return this.keepAlive(this.signInAndPost(stateKey, rec, staged, input));
  }

  // ---- POST /api/orcid/begin and /api/orcid/complete: "Verify my ORCID iD" ----

  /** Open, set up, and ORCID's client id and secret given. Null means go on. */
  private orcidGate(): ApiResult<never> | null {
    const closed = this.gate('web');
    if (closed) return closed;
    if (!this.deps.orcid || this.missing('orcid').length) {
      this.log('orcid.not_configured');
      return fail(503, 'orcid_not_configured', MESSAGES.orcidNotConfigured);
    }
    return null;
  }

  private orcidRedirect(): string {
    return `${this.deps.settings.siteOrigin}/submit/orcid`;
  }

  /** Starts a check: a single-use record tied to the browser's secret (by its hash), and the address of ORCID's sign-in page. */
  async orcidBegin(input: OrcidBeginInput, caller?: Caller): Promise<ApiResult<{ authorize_url: string; expires_at: string }>> {
    const closed = this.orcidGate();
    if (closed) return closed;
    const limited = await this.hit('orcid', caller);
    if (limited) return limited;
    // And from everyone together, so many addresses cannot spend OpenIslet's standing with ORCID (each check is one code exchange).
    const crowded = await this.hit('orcidEveryone', { ip: 'everyone' });
    if (crowded) return crowded;
    const state = randomToken();
    const rec: OrcidStateRecord = { v: 1, binding_hash: input.binding_hash, status: 'open', expires_at: this.now() + STATE_TTL_SECONDS * 1000 };
    await putJson(this.kv, await this.orcidStateKey(state), rec, STATE_TTL_SECONDS);
    const s = this.deps.settings;
    const url = new URL(`${s.orcidBase}/oauth/authorize`);
    url.searchParams.set('client_id', s.orcidClientId as string);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', '/authenticate');
    url.searchParams.set('redirect_uri', this.orcidRedirect());
    url.searchParams.set('state', state);
    this.log('orcid.begin');
    return ok({ authorize_url: url.href, expires_at: iso(rec.expires_at) });
  }

  /** Finishes a check: the browser's secret, then ORCID's code for the iD, then a proof for /api/begin. The token is let go at once. */
  async orcidComplete(input: OrcidCompleteInput): Promise<ApiResult<OrcidOutput>> {
    const closed = this.orcidGate();
    if (closed) return closed;
    const key = await this.orcidStateKey(input.state);
    const rec = await getJson<OrcidStateRecord>(this.kv, key);
    if (!rec || rec.v !== 1 || rec.status !== 'open' || !/^[0-9a-f]{64}$/.test(rec.binding_hash ?? '') || rec.expires_at <= this.now()) {
      return fail(400, 'state_unknown', MESSAGES.orcidStateUnknown);
    }
    // Single use, for certain: KV cannot settle two requests that read "open" at the same moment, so the check is spent in the
    // one-at-a-time store first, before the code goes anywhere. It is also marked used in KV, until it would have expired anyway.
    let first: boolean;
    try {
      first = await this.limits.claimOnce(key, this.now(), STATE_TTL_SECONDS * 1000);
    } catch {
      this.log('queue.limits_unavailable');
      return fail(503, 'orcid_unavailable', MESSAGES.orcidUnavailable);
    }
    if (!first) return fail(400, 'state_unknown', MESSAGES.orcidStateUnknown);
    await putJson(this.kv, key, { ...rec, status: 'used' } satisfies OrcidStateRecord, STATE_TTL_SECONDS);
    if (!timingSafeEqual(await sha256Hex(input.binding), rec.binding_hash)) return fail(400, 'binding_mismatch', MESSAGES.orcidBinding);

    // Under keepAlive: a closed tab or a dropped connection cannot stop it between ORCID issuing the token and letting it go.
    return this.keepAlive(this.orcidExchange(input.code));
  }

  private async orcidExchange(code: string): Promise<ApiResult<OrcidOutput>> {
    const port = this.deps.orcid as OrcidPort;
    let orcid: string;
    try {
      const got = await port.exchangeCode({ code, redirectUri: this.orcidRedirect() });
      orcid = got.orcid;
      await port.revoke(got.token).catch(() => undefined);
    } catch (error) {
      const kind = error instanceof OrcidError ? error.kind : 'unavailable';
      this.log('orcid.failed', { kind, error: error instanceof Error ? error.name : 'unknown' });
      if (kind === 'refused') return fail(400, 'orcid_refused', MESSAGES.orcidRefused);
      if (kind === 'broken') return fail(502, 'orcid_broken', MESSAGES.orcidBroken);
      return fail(502, 'orcid_unavailable', MESSAGES.orcidUnavailable);
    }
    const proof = await makeOrcidProof(this.signingKey(), orcid, this.deps.settings.orcidBase, this.now());
    this.log('orcid.verified');
    return ok({ orcid, proof: proof.proof, expires_at: iso(proof.expiresAt) });
  }

  /**
   * Lets work that has begun finish even if the browser or the AI app goes away (a closed tab, a reload, a sleeping phone, a timeout):
   * the Worker's waitUntil keeps it running once the response is gone. The caller still waits for the same work and gets its answer.
   */
  private keepAlive<T>(work: Promise<T>): Promise<T> {
    this.deps.defer?.(work.then(() => undefined, () => undefined));
    return work;
  }

  /** From the GitHub code to the posted issue. Runs under keepAlive, so a closed tab cannot leave it half done. */
  private async signInAndPost(stateKey: string, rec: StateRecord, staged: StagedRecord, input: CompleteInput): Promise<ApiResult<CompleteOutput>> {
    const s = this.deps.settings;
    let user: { id: number; login: string };
    try {
      const token = await this.deps.github.exchangeCode({ code: input.code, redirectUri: `${s.siteOrigin}/submit/finish` });
      try {
        user = await this.deps.github.getUser(token);
      } finally {
        this.letGo(token);
      }
    } catch (error) {
      return this.githubFailure(error, 'sign-in', 'web');
    }
    return this.postFor(stateKey, rec, staged, user);
  }

  /**
   * Takes a place under the limits, opens the issue, records the answer, and only then adds the checks comment, so nothing slow or
   * failing after the issue exists can lose the answer.
   */
  private async postFor(stateKey: string, rec: StateRecord, staged: StagedRecord, user: { id: number; login: string }): Promise<ApiResult<CompleteOutput>> {
    const place = await this.reservePost(user.id, staged.draft, staged.review, staged.wetlab, 'form');
    if ('answer' in place) {
      // The same IIP was already posted (for example, the person started again after a lost answer): this sign-in gets that answer.
      if (place.answer.ok) await this.keepResult(stateKey, rec, place.answer.body);
      return place.answer;
    }

    let posted: { number: number; url: string };
    try {
      posted = await this.createIssueFor(staged, user, staged.via);
    } catch (error) {
      await this.finishPost(place.ticket, { failed: true });
      return this.githubFailure(error, 'issue', 'web');
    }
    const out = this.completeOutput(posted, user, staged.contributor);
    await this.finishPost(place.ticket, { posted: out });
    await this.keepResult(stateKey, rec, out);
    await this.addChecks(posted.number, staged);
    this.log('queue.posted', { via: staged.via, issue: posted.number });
    return ok(out);
  }

  /**
   * Keeps a posted answer for a repeat of the same sign-in, in the result record (tried three times) and in the used sign-in
   * record, then deletes the staged files. The issue already exists, so nothing here may turn its answer into an error.
   */
  private async keepResult(stateKey: string, rec: StateRecord, out: CompleteOutput): Promise<void> {
    const key = await this.resultKey(rec.staged_id);
    let kept = false;
    for (let attempt = 0; attempt < 3 && !kept; attempt++) {
      try {
        await putJson(this.kv, key, out, RESULT_TTL_SECONDS);
        kept = true;
      } catch {
        // tried again below
      }
    }
    try {
      await putJson(this.kv, stateKey, { ...rec, status: 'used', result: out } satisfies StateRecord, RESULT_TTL_SECONDS);
      kept = true;
    } catch {
      // the result record may still hold it
    }
    if (!kept) this.log('queue.result_unrecorded', { issue: out.issue.number });
    try {
      await this.kv.delete(await this.stagedKey(rec.staged_id));
    } catch {
      this.log('queue.staged_not_deleted', { issue: out.issue.number });
    }
  }

  // ---- submit_proposal with a token ----

  async postSignedIn(a: ToolSubmission & { identity: Identity }): Promise<ApiResult<ToolPosted>> {
    return this.keepAlive(this.postSignedInNow(a));
  }

  private async postSignedInNow(a: ToolSubmission & { identity: Identity }): Promise<ApiResult<ToolPosted>> {
    const closed = this.gate('post');
    if (closed) return closed;
    const contributor = normaliseContributor(a.contributor);
    if (!contributor.ok) return fail(422, 'bad_contributor', contributor.message, { field: contributor.field });

    const wetlab = a.wetlab_empirical_readouts ?? null;
    // Covers what the fingerprint covers, so a retry with the same key but changed readouts is a new IIP, not the first answer.
    const idem = a.idempotency_key ? await this.idemKey('post', String(a.identity.id), a.idempotency_key, a.draft, a.review, this.labPart(wetlab)) : null;
    if (idem) {
      const prior = await getJson<CompleteOutput>(this.kv, idem);
      if (prior) return ok({ ...prior, replayed: true });
    }
    const meta = await a.bundle.meta();
    const t = this.now();
    const record: StagedRecord = {
      v: 1,
      draft: a.draft,
      review: a.review,
      ai_tools: a.ai_tools ?? {},
      contributor: contributor.value,
      via: 'web_form', // not used: the way in is passed to createIssueFor below
      idempotency_key: a.idempotency_key ?? null,
      wetlab,
      written_against: `${meta.id} (blueprint release ${meta.blueprint_release})`,
      report: toStored(a.report),
      created_at: t,
      expires_at: t + STAGED_TTL_SECONDS * 1000,
    };
    if (this.tooLarge(record)) return this.sizeFailure(a.report.door);

    const place = await this.reservePost(a.identity.id, a.draft, a.review, wetlab, 'ask');
    if ('answer' in place) {
      if (!place.answer.ok) return place.answer;
      // The same IIP was already posted by this account today (a retry without the same key): give that answer, not a second issue.
      if (idem) await this.keepReplay(idem, place.answer.body);
      return ok({ ...place.answer.body, replayed: true });
    }

    // The app's sign-in can be up to a week old, so the name to @mention is looked up now, by the account's ID.
    let user: Identity;
    try {
      const login = await this.deps.github.loginFor(a.identity.id);
      if (!login) {
        await this.finishPost(place.ticket, { failed: true });
        return fail(401, 'github_account_gone', MESSAGES.accountGone);
      }
      if (login !== a.identity.login) this.log('queue.login_changed');
      user = { id: a.identity.id, login };
    } catch (error) {
      await this.finishPost(place.ticket, { failed: true });
      return this.githubFailure(error, 'login', 'tool');
    }

    let posted: { number: number; url: string };
    try {
      posted = await this.createIssueFor(record, user, 'mcp_signed_in');
    } catch (error) {
      await this.finishPost(place.ticket, { failed: true });
      return this.githubFailure(error, 'issue', 'tool');
    }
    const out = this.completeOutput(posted, user, contributor.value);
    // Recorded before the checks comment, so nothing slow or failing after the issue exists can lose the answer.
    await this.finishPost(place.ticket, { posted: out });
    if (idem) await this.keepReplay(idem, out);
    await this.addChecks(posted.number, record);
    this.log('queue.posted', { via: 'mcp_signed_in', issue: posted.number });
    return ok(out);
  }

  /**
   * Keeps a posted answer under the caller's key, so a retry with that key is answered straight away. The issue already exists,
   * so a failure here never turns its answer into an error: a retry still finds the issue through the limits (reservePost).
   */
  private async keepReplay(idem: string, out: CompleteOutput): Promise<void> {
    try {
      await putJson(this.kv, idem, out, RESULT_TTL_SECONDS);
    } catch {
      this.log('queue.idem_unrecorded', { issue: out.issue.number });
    }
  }

  // ---- Shared by the two ways of posting ----

  private completeOutput(issue: { number: number; url: string }, user: Identity, c: Contributor): CompleteOutput {
    return {
      submitted: true,
      issue: { number: issue.number, url: issue.url },
      record_id: recordId(issue.number),
      contributor: {
        github: user.login,
        ...(c.name ? { name: c.name } : {}),
        ...(c.orcid ? { orcid: c.orcid } : {}),
        ...(c.orcid && c.orcid_verified === true ? { orcid_verified: true as const } : {}),
        ...(c.x ? { x: c.x } : {}),
      },
    };
  }

  /** Opens the public issue as the bot. The first comment is added separately (addChecks), after the answer has been recorded. */
  private async createIssueFor(r: StagedRecord, user: Identity, via: Via): Promise<{ number: number; url: string }> {
    const body = await buildIssueBody(
      {
        login: user.login,
        via,
        contributor: r.contributor,
        aiTools: r.report.ai_tools,
        writtenAgainst: r.written_against,
        draft: r.draft,
        review: r.review,
        claim: r.report.claim,
        pmids: r.report.pmids,
        idempotencyKey: r.idempotency_key,
        wetlab: r.wetlab,
      },
      this.signingKey(),
    );
    return this.deps.github.createIssue({ title: cleanTitle(r.report.title), body, labels: issueLabels(r.report) });
  }

  /** The first comment, the Automatic checks. A missing comment never undoes the issue, so a failure is only logged. */
  private async addChecks(issueNumber: number, r: StagedRecord): Promise<void> {
    try {
      await this.deps.github.createComment(issueNumber, checksComment(r.report));
    } catch {
      this.log('queue.comment_failed', { issue: issueNumber });
    }
  }

  /** Lets go of the contributor's GitHub token as soon as we know who they are. */
  private letGo(token: string): void {
    const work = this.deps.github.revokeUserToken(token).catch(() => undefined);
    if (this.deps.defer) this.deps.defer(work);
  }

  /** The public queue's issue list, so a person can see for themselves whether an IIP made it. */
  private queueUrl(): string {
    const s = this.deps.settings;
    return `${s.githubWebBase}/${s.owner}/${s.repo}/issues`;
  }

  private githubFailure(error: unknown, step: string, via: 'web' | 'tool'): ApiResult<never> {
    if (error instanceof GitHubError) {
      // Only GitHub's short error code or HTTP status (e.g. incorrect_client_credentials, 503), never free text, so logs stay plain facts.
      const code = /\(([a-z_]{3,60})\)|\b(\d{3})\b/.exec(error.message);
      this.log('queue.github_error', { step, kind: error.kind, unsure: error.outcomeUnknown, ...(code ? { code: code[1] ?? code[2] } : {}) });
      if (error.kind === 'refused') return fail(401, 'github_refused', MESSAGES.refused);
      if (error.kind === 'broken') {
        // Our own set-up (the app, its key, the repository) is wrong, so a retry will not help until someone fixes it. Its own log event, so it stands out.
        this.log('queue.broken', { step, ...(code ? { code: code[1] ?? code[2] } : {}) });
        return fail(503, 'queue_broken', via === 'web' ? MESSAGES.webBroken : MESSAGES.toolBroken);
      }
      if (error.outcomeUnknown) {
        const queueUrl = this.queueUrl();
        return fail(502, 'github_unavailable', unsureMessage(queueUrl, via === 'web' ? 'form' : 'ask'), { outcome_unknown: true, queue_url: queueUrl });
      }
      return fail(502, 'github_unavailable', via === 'web' ? MESSAGES.webUnavailable : MESSAGES.toolUnavailable);
    }
    throw error;
  }
}

