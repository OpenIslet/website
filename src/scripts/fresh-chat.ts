// The message for the fresh chat in step 4 of Start here, made from the person's draft instead of by their AI: the public reviewer
// template with the draft's claim, evidence and proposed change in it, word for word (the connector's get_review_prompt makes the
// same prompt). On the copy-and-paste route the starter pack goes first, so the fresh chat can check the claim against the blueprint,
// and the task comes last.
import { reviewPromptFor } from '../../connector/src/core/template';
import { reviewTemplate } from '../data/prompts';

export const PACK_START = '=== START OF THE OPENISLET STARTER PACK ===';
export const PACK_END = '=== END OF THE OPENISLET STARTER PACK ===';
export const OPENING = 'This message holds the OpenIslet starter pack, then a blind review for you to write straight away. Read the pack, then do the review at the end.';

/** The message to paste into the fresh chat: the reviewer prompt alone, or with the starter pack before it. */
export function freshChatMessage(draft: string, pack?: string): { ok: true; text: string } | { ok: false; missing: string[] } {
  const p = reviewPromptFor(reviewTemplate, draft);
  if (!p.ok || pack === undefined) return p;
  return { ok: true, text: `${OPENING}\n\n${PACK_START}\n\n${pack.trim()}\n\n${PACK_END}\n\n${p.text}` };
}
