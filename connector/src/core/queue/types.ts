// The shapes the submission queue shares with the rest of the connector. Types only, so any module can import it.
// The contract these follow is docs/connector/QUEUE-API.md (in the website folder).
import type { Bundle } from '../bundle';
import type { DraftReport } from '../draft';
import type { WetlabEmpiricalReadouts } from '../wetlab-readouts';

/** A GitHub account that signed in. The numeric ID never changes; the login can. */
export interface Identity {
  id: number;
  login: string;
}

/** What a contributor may say about themselves. It is shown as "stated by the contributor", except a verified ORCID iD (below). */
export interface Contributor {
  name?: string;
  orcid?: string;
  x?: string;
  /**
   * Set by /api/begin alone, and only after an ORCID proof for this very iD checked out (core/queue/orcid.ts). Never read from what
   * anyone sends: normaliseContributor copies only the three fields above.
   */
  orcid_verified?: true;
}

/** How an IIP (Islet Improvement Proposal) reached the queue. */
export type Via = 'web_form' | 'mcp_signed_in' | 'mcp_link';

export interface AiTools {
  draft?: string;
  review?: string;
}

/** Every error the API sends has this shape. `message` is plain English for a person. */
export interface ApiError {
  error: string;
  message: string;
  [extra: string]: unknown;
}

export type ApiResult<T> =
  | { ok: true; status: 200; body: T }
  | { ok: false; status: number; body: ApiError; headers?: Record<string, string> };

export interface StageOutput {
  staged_id: string;
  form_url: string;
  expires_at: string;
}

export interface BeginOutput {
  authorize_url: string;
  expires_at: string;
  /** The staged submission this sign-in is for (new, or the one the request named), so the page can send someone back to it. */
  staged_id: string;
}

export interface ContributorOutput extends Contributor {
  github: string;
}

/** What /api/orcid/complete sends back: the iD ORCID confirmed, and the proof for /api/begin. */
export interface OrcidOutput {
  orcid: string;
  proof: string;
  expires_at: string;
}

export interface CompleteOutput {
  submitted: true;
  issue: { number: number; url: string };
  record_id: string;
  contributor: ContributorOutput;
}

/** What `submit_proposal` gets back for a signed-in caller. `replayed` marks a retry that was answered from the first attempt. */
export type ToolPosted = CompleteOutput & { replayed?: boolean };

export interface StagedOutput {
  draft: string;
  review: string;
  ai_tools: AiTools;
  contributor: Contributor;
  expires_at: string;
}

/** Who is asking, as far as rate limits are concerned. The address is held in memory only, never stored or logged. */
export interface Caller {
  ip?: string;
  /** True for /mcp and /register, where the address is an AI app's server speaking for many people, not one person. */
  shared?: boolean;
}

/** What `submit_proposal` hands to the queue once it has run the basic rules itself. */
export interface ToolSubmission {
  bundle: Bundle;
  report: DraftReport;
  draft: string;
  review: string;
  ai_tools?: AiTools;
  contributor?: unknown;
  idempotency_key?: string;
  wetlab_empirical_readouts?: WetlabEmpiricalReadouts | null;
  caller?: Caller;
}

/** The part of the queue that `submit_proposal` uses. The real one is QueueService; tests can supply a small fake. */
export interface QueueForTool {
  /** "post": can it open an issue for a signed-in caller. "link": can it save a draft and hand back the form link. */
  ready(kind: 'post' | 'link'): boolean;
  postSignedIn(args: ToolSubmission & { identity: Identity }): Promise<ApiResult<ToolPosted>>;
  stageForLink(args: ToolSubmission): Promise<ApiResult<StageOutput>>;
}

/** What `submit_proposal` knows about the request it is answering. */
export interface SubmitContext {
  queue?: QueueForTool;
  /** Set only when the caller presented a valid connector token. */
  identity?: Identity;
  caller?: Caller;
}
