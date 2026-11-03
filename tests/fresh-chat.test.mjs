// The message for the fresh chat in step 4 of Start here (src/scripts/fresh-chat.ts): made from the draft, so no AI has to copy the
// reviewer template word for word. Neutral sample text: these tests are about the message only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function load(file) {
  const result = await build({ entryPoints: [join(root, file)], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const { freshChatMessage, OPENING, PACK_START, PACK_END } = await load('src/scripts/fresh-chat.ts');
const { reviewTemplate, draftPrompt } = await load('src/data/prompts.ts');

const draft = [
  '# Steps in the other order',
  '**Type:** Improvement',
  '**Claim in one sentence:** Step two should come before step one.',
  '**In plain English:** Doing the steps the other way round saves a day.',
  '**Affects test:** 1, because it changes the order',
  '**Affects design:** Design A',
  '## Evidence',
  '- Example paper, PMID 12345678, "An example quote."',
  '## What I propose changing',
  'Swap steps one and two.',
  '## How this could be wrong',
  'The author reasoning that the reviewer must not see.',
  '## Cheapest way to check it',
  'Time both orders once.',
  '## AI tools used',
  'Example model (High Effort)',
].join('\n');
const claim = 'Step two should come before step one.\n\nEvidence:\n- Example paper, PMID 12345678, "An example quote."\n\nWhat I propose changing:\nSwap steps one and two.';
const prompt = reviewTemplate.replace('[CLAIM]', () => claim);

test('with MCP, the message is the reviewer template with the claim, evidence and proposed change in it', () => {
  assert.deepEqual(freshChatMessage(draft), { ok: true, text: prompt });
  assert.doesNotMatch(prompt, /author reasoning|saves a day|Steps in the other order/);
});

test('with copy and paste, the starter pack comes first, marked off, and the review task comes last', () => {
  const m = freshChatMessage(draft, '\n# Pack title\n\nPack text.\n\n');
  assert.equal(m.ok, true);
  assert.equal(m.text, `${OPENING}\n\n${PACK_START}\n\n# Pack title\n\nPack text.\n\n${PACK_END}\n\n${prompt}`);
  assert.ok(m.text.endsWith(prompt));
});

test('a draft missing what the reviewer needs gives the missing parts, not a message', () => {
  assert.deepEqual(freshChatMessage('# Only a title', 'pack'), { ok: false, missing: ['Claim in one sentence', 'Evidence', 'What I propose changing'] });
});

test('the draft prompt asks for the draft only, ending with its template', () => {
  assert.doesNotMatch(draftPrompt, /CLAIM TO TEST|FRESH-CHAT|PART 2|OPENISLET-REVIEW/);
  assert.match(draftPrompt, /## AI tools used\n\[Your model name[^\n]*\]$/);
});
