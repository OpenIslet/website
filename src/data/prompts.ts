// The prompts people copy and paste on the Start here page. They are shown in full so nobody pastes anything they cannot read.
// The review prompt is the public reviewer template [OPENISLET-REVIEW-v1]. Changing it here changes it everywhere.
//
// There are two routes. With MCP, the AI reads OpenIslet itself. With copy and paste, the person gives
// the AI the OpenIslet starter pack (public/openislet-starter-pack.md, built by src/pages/openislet-starter-pack.md.ts) and the same
// prompts point at it instead. The reviewer template works for both.
//
// Scope: reviewers test the blueprint itself, not how later lab or clinical stages would be run. The one exception is an IIP about a
// roadmap stage (Stages 1 to 5, or a missing stage): it is judged as a change to that stage.

export type Route = 'mcp' | 'paste';

export const checkPrompt =
  'Using the OpenIslet MCP tools, tell me in two sentences what the OpenIslet blueprint is, then list its five tests in plain English.';

/** Step 1, the one-line way: pasted into a chat, the AI reads the starter pack on the website itself. */
export const packLine =
  'Read all of https://openislet.org/openislet-starter-pack.md (the OpenIslet starter pack), then help me with the OpenIslet blueprint.';

/** The copy-and-paste version of the check: paste the starter pack first, then ask this. */
export const checkPromptPaste =
  'Using the OpenIslet starter pack I pasted at the start of this chat, tell me in two sentences what the OpenIslet blueprint is, then list its five tests in plain English.';

export interface ExplorePrompt {
  id: string;
  title: string;
  why: string;
  /** With MCP. */
  text: string;
  /** With the starter pack pasted into the chat instead. */
  pasteText: string;
}

const scope = 'Focus on the blueprint itself (the gene edits, the DNA, the proteins, oxygen, immune biology and the Idea Graveyard), not on how later lab or clinical stages would be run.';
const packNote = 'The pack has the blueprint, the Idea Graveyard, the open questions and the roadmap, but not the studies themselves: if you cannot check a paper, say so, and never invent a quote or a PubMed ID.';

export const explorePrompts: ExplorePrompt[] = [
  {
    id: 'weak',
    title: 'Find a weak spot',
    why: 'Ask your AI to play the sceptic.',
    text: `Read the OpenIslet blueprint using the OpenIslet MCP tools. Act as a sceptical scientist. Compare Design A, Design B and Design X (Islet-X): what is the single weakest point across the three designs, and why? Check it against the studies, and tell me which papers support or contradict your view. Explain it in plain English first, then give the detail. ${scope}`,
    pasteText: `Read the OpenIslet starter pack I pasted at the start of this chat. Act as a sceptical scientist. Compare Design A, Design B and Design X (Islet-X): what is the single weakest point across the three designs, and why? Check it against the Idea Graveyard in the pack, and tell me which papers support or contradict your view. Explain it in plain English first, then give the detail. ${scope} ${packNote}`,
  },
  {
    id: 'improve',
    title: 'Look for an improvement',
    why: 'Ask for one specific change that would help.',
    text: `Look for one specific way to improve the OpenIslet blueprint across Design A, Design B or Design X (Islet-X). Tell me which of the five tests it helps, check it against the Idea Graveyard to make sure it has not already been tried and failed, and show the evidence for it. ${scope}`,
    pasteText: `Using the OpenIslet starter pack I pasted at the start of this chat, look for one specific way to improve the blueprint across Design A, Design B or Design X (Islet-X). Tell me which of the five tests it helps, check it against the Idea Graveyard in the pack to make sure it has not already been tried and failed, and show the evidence for it. ${scope} ${packNote}`,
  },
  {
    id: 'idea',
    title: 'Test my own idea',
    why: 'Have an idea? Ask your AI to test it honestly.',
    text: 'I have an idea to improve the OpenIslet blueprint (Design A, Design B or Design X / Islet-X). I think [describe your idea in your own words]. Can you test it? Check it against the studies and the Idea Graveyard, and tell me honestly whether it holds up. Do not just agree with me.',
    pasteText: `I have an idea to improve the OpenIslet blueprint (Design A, Design B or Design X / Islet-X). I think [describe your idea in your own words]. Using the OpenIslet starter pack I pasted at the start of this chat, can you test it? Check it against the Idea Graveyard in the pack, and tell me honestly whether it holds up. Do not just agree with me. ${packNote}`,
  },
  {
    id: 'paper',
    title: 'Find a paper we missed',
    why: 'Works best if your AI can search the web.',
    text: 'If you can search the web, look for published research that the OpenIslet blueprint may have missed and that could change one of the five tests. Give me the title, authors and PubMed ID, and explain in plain English what it would change.',
    pasteText: 'If you can search the web, look for published research that the OpenIslet blueprint (the starter pack I pasted at the start of this chat) may have missed and that could change one of the five tests. Give me the title, authors and PubMed ID, and explain in plain English what it would change.',
  },
  {
    id: 'evidence',
    title: 'Check the evidence',
    why: 'Spot-check the sources behind the claims.',
    text: 'Pick five findings from the OpenIslet studies at random. For each one, check that the paper exists and that the quoted sentence really says what the blueprint relies on. Tell me about any that do not match, and quote the sentence you checked.',
    pasteText: 'Pick five papers cited in the OpenIslet starter pack I pasted at the start of this chat. For each one, check that the paper exists (give its PubMed ID) and that it really says what the blueprint relies on. Tell me about any that do not match. If you cannot look a paper up, say so instead of guessing.',
  },
  {
    id: 'roadmap',
    title: 'Improve the roadmap',
    why: 'Spot a missing step between the blueprint and the first human trial.',
    text: `Read the OpenIslet roadmap with the OpenIslet MCP tools, then find one concrete gap or improvement in Stages 1 to 5, backed by published evidence. For each claim, give a PubMed ID, or the document's title, publisher and link, and quote the exact sentence. Never invent a source or a quote. Explain it in plain English first, then help me prepare it as an IIP.`,
    pasteText: `Using the OpenIslet starter pack I pasted at the start of this chat, read the roadmap (Part 4), then find one concrete gap or improvement in Stages 1 to 5, backed by published evidence. For each claim, give a PubMed ID, or the document's title, publisher and link, and quote the exact sentence. Explain it in plain English first, then help me prepare it as an IIP. ${packNote}`,
  },
];

/** The public reviewer template. [CLAIM] is replaced by the claim. */
export const reviewTemplate = `You are a blind reviewer for OpenIslet, an open project to design a personalised, drug-free cure for type 1 diabetes. [OPENISLET-REVIEW-v1]

You have not seen how this claim was reached. Do not assume it is right. Your job is to try to prove it wrong, honestly and fairly. If it survives, say so.

Use the OpenIslet blueprint to check the claim: through the OpenIslet connector if you have it, or from the OpenIslet starter pack if it has been pasted into this chat. If you have neither, say so at the top of your review, say that you could not check the claim against the blueprint, and review from your own knowledge.

CLAIM TO TEST
[CLAIM]

How to review:
1. Restate the claim in one plain-English sentence. This goes on the "Claim reviewed" line.
2. Check it against the OpenIslet blueprint. Which of the five tests does it affect, and does it conflict with the current design (Design A, Design B or Design X)? If it is about a roadmap stage, check it against the roadmap instead.
3. Check it against the Idea Graveyard. Has this idea, or one very like it, already been ruled out or flagged as risky?
4. Check the evidence. Do the cited papers exist, and do the quotes say what the claim needs them to say? Do not trust any quote or number you have not checked. Look for evidence against the claim as hard as you look for evidence for it.
5. Look for other ways it could fail in the design itself: biology, maths, physics, engineering and safety. Judge the blueprint, not how later lab or clinical stages would be run, unless the claim is about a roadmap stage: then judge it as a change to that stage.
6. Say which single experiment or analysis would settle it most cheaply.

Write your review as a Markdown document with exactly these headings:
# Review: [short title]
**Claim reviewed:** [The claim, restated in one plain-English sentence]
**Verdict:** [Supported | Partly supported | Not supported | Cannot tell]
**Confidence:** [Low | Medium | High]
**Submit to OpenIslet?** [Yes, only if the verdict is Supported or Partly supported. Otherwise No]
**In plain English:** [3 to 5 sentences a person with type 1 diabetes could follow]
## What I checked
## Evidence for
## Evidence against
## Idea Graveyard check
## Other ways it could fail
## Cheapest way to settle it
## AI tools used
[Your model name and effort setting. Write "Unreleased model" if you cannot say.]

Be strict. Only a claim that survives your attempt to disprove it should get Supported or Partly supported.

Then do both of these, so I can use the review:
(a) If you can create files, save the review as openislet-review-[short-title].md so I can download it.
(b) Also show the whole review inside one code block, so I can press Copy.`;

/** Step 3: the prompt that writes the draft. The prompt for the fresh chat is made from the draft in step 4 (and by get_review_prompt). */
export const draftPrompt = `I want to save an Islet Improvement Proposal (IIP) for OpenIslet, the open project to design a personalised, drug-free cure for type 1 diabetes.

Write my IIP as a Markdown file called openislet-iip-[short-title].md. If you can create files, save it so I can download it. Also show the whole file inside one code block, so I can press Copy. Use exactly this structure and fill every section from our conversation. If something is missing, write "Not known". Never invent evidence, quotes or PubMed IDs.

# [Short title]
**Type:** [Problem found | Improvement | Missing evidence]
**Claim in one sentence:** [What I am claiming]
**In plain English:** [3 to 5 sentences a person with type 1 diabetes could follow]
**Affects test:** [1 | 2A | 2B | 3 | 4 | 5 | None (a roadmap IIP), and why]
**Affects design:** [Design A | Design B | Design X | Two of them (say which) | All three | A roadmap stage (say which)]
## Evidence
- [Paper title, PubMed ID, and the exact quote, copied word for word]
## What I propose changing
[The specific change to the blueprint or a roadmap stage, or the new Idea Graveyard entry]
## How this could be wrong
[The strongest reason I might be mistaken]
## Cheapest way to check it
[The simplest analysis or lab test that would settle it]
## AI tools used
[Your model name and effort setting. Write "Unreleased model" if you cannot say.]`;

/** Step 4 by hand: the reviewer prompt on its own, for anyone who fills in [CLAIM] themselves. */
export const reviewPrompt = reviewTemplate;

/** Step 5 with MCP: the AI sends the two files. */
export const submitPrompt = `Please submit my Islet Improvement Proposal (IIP) to OpenIslet using the OpenIslet MCP tools.

DRAFT
[Paste your draft here, or attach the file]

BLIND REVIEW
[Paste the review here, or attach the file]

AI tools used (skip this if my files already say): draft [model and effort]; review [model and effort].

Optional credit details (leave blank to skip): display name [ ]; ORCID iD [ ]; X handle [ ].

First check my review. Only submit if its verdict is Supported or Partly supported. If it is not, tell me why and do not submit.

I agree that my IIP and its review will be published openly under CC BY 4.0, credited to the GitHub account I sign in with.

Lead me through it: tell me what you are doing at each step, ask me for anything that is missing one question at a time, and tell me what to expect when GitHub asks me to sign in (I may need to create a free GitHub account there).

When it is done, give me the link to my public submission. If I am not signed in to GitHub through you, give me the link to the pre-filled OpenIslet form instead.`;

/** Example opening line of the drafted file, shown as a picture of what to expect. */
export const draftPreview = [
  { k: 'h1', t: 'Too little CD47 at hour zero?' },
  { k: 'meta', t: 'Type: Problem found' },
  { k: 'meta', t: 'Claim in one sentence: …' },
  { k: 'meta', t: 'In plain English: …' },
  { k: 'meta', t: 'Affects test: 3 · Affects design: A (or a roadmap stage)' },
  { k: 'h2', t: 'Evidence' },
  { k: 'li', t: 'Paper title, PubMed ID, exact quote' },
  { k: 'h2', t: 'What I propose changing' },
  { k: 'h2', t: 'How this could be wrong' },
  { k: 'h2', t: 'Cheapest way to check it' },
  { k: 'h2', t: 'AI tools used' },
];
