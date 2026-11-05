// What the bundle builder reads from the website. It is compiled in memory by build-bundle.mjs, so the connector
// and the website always use the same numbers, wording and dates and nothing is typed twice.
export { release, longDate, goal, repo, mcpEndpoint, contact, social } from '../../src/data/site';
export { rules, testNames } from '../../src/data/graveyard';
export { stages, canine, afterBlueprint } from '../../src/data/roadmap';
export { gates, testLabels, testShort } from '../../src/data/gates';
export { scenarios, gateColumns, niche } from '../../src/data/blueprint';
export { designScore, indices, scoresTableMarkdown } from '../../src/data/scenarios';
export { specTokens, fillTokens } from '../../src/data/specTokens';
export { outcomes } from '../../src/data/contributions';
export { reviewTemplate, draftPrompt, submitPrompt, explorePrompts, checkPrompt } from '../../src/data/prompts';
export { paths as helpPaths, stepNames } from '../../src/data/guide';
export * as versions from '../../src/data/versions';
