// The blueprint in plain English (the default) and in full (the concise specification), by section.
import { type Answer, type Config, md } from './answer';
import type { Bundle } from './bundle';
import { listVersions } from './versions';
import { longDate } from './text';

export const SECTIONS = ['summary', 'tests', 'designs', 'roadmap', 'versions', 'help'] as const;
export type Section = (typeof SECTIONS)[number];

// Which parts of the concise specification belong to each section (used when detail is "full").
const SPEC: Record<Section, string[]> = {
  summary: ['summary', 'background-and-aim', 'the-evidence-behind-it', 'the-idea-graveyard', 'known-risks-and-open-questions'],
  tests: ['the-five-tests'],
  designs: ['three-designs', 'the-edits-one-by-one', 'the-environment-oxygen-and-blood-supply', 'how-the-designs-are-scored'],
  roadmap: ['what-happens-next'],
  versions: [],
  help: ['what-happens-next'],
};

export async function blueprintOverview(bundle: Bundle, cfg: Config, opts: { section?: Section; detail?: 'plain' | 'full'; design?: 'A' | 'B' | 'X' }): Promise<Answer> {
  const section = opts.design ? 'designs' : opts.section ?? 'summary';
  const full = opts.detail === 'full';
  const [overview, scores, specSections, findings, meta] = await Promise.all([bundle.overview(), bundle.scores(), bundle.sections(), bundle.findings(), bundle.meta()]);
  if (opts.design === 'X') {
    const portfolio = overview.champion_challenger_portfolio;
    const grid = portfolio?.slots?.X ?? null;
    const molecular = portfolio?.blueprint_x_stage0_molecular_challenger_spec ?? null;
    const x = overview.designs?.X;
    const proposals: { title: string; text: string }[] = x?.still_on_paper ?? [];
    return {
      summary: 'Design X is the challenger, and the name covers two separate ideas: Design A plus one base edit in the insulin gene (scored, K=4, B=1), and a separate set of proposed upgrades (K=4, B=0) with no built DNA and no score. Neither is experimentally qualified or promoted.',
      body:
        md.h(1, x?.headline ?? 'Design X') +
        (x ? `\n*Who it is for:* ${x.for_whom}\n\n*Main risk:* ${x.main_risk}\n` : '') +
        md.h(2, 'Two things are meant by Design X') +
        md.bullets([
          '**The scored challenger (K=4, B=1).** Design A\'s four edits plus one base edit in the insulin gene, evaluated on the shared baseline 119 µm oxygen layer. The module checker and the scores cover this one only.',
          '**The proposed upgrades (K=4, B=0).** A new switch for the HLA-E and CD47 signals (HLA-E stays unchanged by default; a small change to stop the CD8 helper protein gripping it is an optional side test), a stem-cell line chosen for a protective insulin-gene variant alongside testing a naturally protective TYK2 variant across the virtual-patient sweep, a dedicated outer-ring arrangement for the Fas-ligand gel (tested for post-gel immune rebound and an optional CD55 complement shield while preserving endogenous CD59), and a thinner 100 µm central oxygen layer. They do not include the insulin-gene edit. Across all designs, SLC30A8 (ZnT8) is kept intact and four other candidate edits (TYMS, NLRC5, endogenous CD274 and TXNIP) stay held outside core designs behind written lab pass rules. None of this has built DNA or a score.',
        ]) +
        (proposals.length ? '\n' + md.h(2, 'Still on paper') + md.bullets(proposals.map((p) => `**${p.title}.** ${p.text}`)) : '') +
        '\nA challenger replaces the lead design only if lab results show it is better in a head-to-head comparison whose rules are written down first. Empirical calibration alone cannot authorise promotion. The porosity sweep in the tissue layer is a conditional sensitivity, not a buildable pouch specification.\n' +
        (full && cfg.scenarioScores && grid ? '\n' + md.h(2, 'The scored challenger, as data') + '\n```json\n' + JSON.stringify(grid, null, 2) + '\n```\n' : ''),
      data: { design: 'X', evaluation_scope: 'COMBINATORIAL_GRID_ONLY', grid: cfg.scenarioScores ? grid : null, molecular_hypothesis: molecular, still_on_paper: proposals, promotion_authorized: false },
      notes: ['Exact-product lab qualification is pending. Design X is not a third clinically validated product.', ...(cfg.scenarioScores && grid && !full ? ['Ask for detail "full" to add the scored challenger\'s data as JSON.'] : [])],
    };
  }
  const notes: string[] = [];
  let summary = '';
  let body = '';
  let data: Record<string, unknown> = {};

  const perTest: Record<string, number> = {};
  for (const f of findings) for (const t of f.tests) perTest[t] = (perTest[t] ?? 0) + 1;
  const c = overview.counts;

  switch (section) {
    case 'summary': {
      summary = `${overview.in_one_sentence} The blueprint rests on ${c.studies.toLocaleString('en-GB')} study records and ${c.findings.toLocaleString('en-GB')} findings, and compares three designs: Design A (the lead), Design B and Design X (Islet-X, the challenger).`;
      body =
        md.h(1, 'Islet-1') +
        `\n${overview.in_one_sentence}\n\n**${overview.goal.text}**\n\n` +
        md.h(2, 'The five tests a design must pass') +
        md.numbered(overview.tests.map((t: any) => `**${t.short}.** ${t.question}`)) + // eslint-disable-line @typescript-eslint/no-explicit-any
        '\n' +
        md.h(2, 'The designs') +
        md.bullets([
          ...Object.values(overview.designs).map((d: any) => `**${d.name}** (${d.summary}). ${d.for_whom} Main risk: ${d.main_risk}`), // eslint-disable-line @typescript-eslint/no-explicit-any
        ]) +
        '\nPass design="X" for the challenger on its own.\n' +
        '\n' +
        md.h(2, 'What the evidence is') +
        md.bullets([
          `${c.studies.toLocaleString('en-GB')} study records and ${c.findings.toLocaleString('en-GB')} findings, each tied to the place in the paper it comes from.`,
          `${typeof c.cegStudies === 'number' ? c.cegStudies.toLocaleString('en-GB') : '1,151'} primary empirical studies, ${typeof c.cegArms === 'number' ? c.cegArms.toLocaleString('en-GB') : '7,659'} experimental and control groups, ${typeof c.cegOutcomes === 'number' ? c.cegOutcomes.toLocaleString('en-GB') : '14,105'} structured outcomes and ${typeof c.cegLinks === 'number' ? c.cegLinks.toLocaleString('en-GB') : '2,447'} blueprint links in the Type 1 Diabetes Context–Evidence Graph (screened from ${typeof c.cegScreened === 'number' ? c.cegScreened.toLocaleString('en-GB') : '3,922'} candidate records).`,
          `${c.graveyardRules} Idea Graveyard rules: ideas the evidence argues against, or that carry a risk.`,
          `${c.designs.toLocaleString('en-GB')} designs checked against those rules: ${c.blocked.toLocaleString('en-GB')} were ruled out and ${c.feasible} remained.`,
          'Checks at five layers: the studies, the DNA, the proteins, the graft and body, and patient matching.',
        ]) +
        '\nAsk for another section (tests, designs, roadmap, versions, help) for more.';
      data = { title: overview.title, goal: overview.goal, counts: c, tests: overview.tests.map((t: any) => ({ id: t.id, short: t.short })), designs: Object.keys(overview.designs) }; // eslint-disable-line @typescript-eslint/no-explicit-any
      break;
    }
    case 'tests': {
      summary = 'A design fails if any one of five tests fails. Test 2 has two parts, so the scoring model has six factors.';
      body =
        md.h(1, 'The five tests') +
        overview.tests
          .map((t: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
            const parts: string[] = [`**${t.name}**`, `*Question:* ${t.question}`, ...t.explanation];
            if (t.parts) parts.push(...t.parts.map((p: any) => `- **${p.code}. ${p.title}.** ${p.text}`)); // eslint-disable-line @typescript-eslint/no-explicit-any
            const n = t.parts ? (perTest['2A'] ?? 0) + (perTest['2B'] ?? 0) : (perTest[t.id] ?? 0);
            parts.push(`*In the evidence:* ${n.toLocaleString('en-GB')} findings bear on this test (the project's grouping, for browsing).`);
            return md.h(2, `Test ${t.number} · ${t.short}`) + parts.join('\n\n') + '\n';
          })
          .join('\n');
      data = { tests: overview.tests, findings_per_test: perTest };
      break;
    }
    case 'designs': {
      const showScores = cfg.scenarioScores;
      const named = (Object.values(overview.designs) as any[]).filter((d) => !opts.design || d.id === opts.design); // eslint-disable-line @typescript-eslint/no-explicit-any
      summary = `Islet-1 compares three designs: Design A (the lead), Design B and the challenger Design X (Islet-X). ${named.map((d) => `${d.name} has ${d.summary}`).join('; ')}. Nobody knows yet which way of hiding the cells works best.`;
      const parts: string[] = [md.h(1, 'The designs')];
      for (const d of named) {
        parts.push(md.h(2, d.headline));
        parts.push(`*Who it is for:* ${d.for_whom}\n\n*Main risk:* ${d.main_risk}\n`);
        parts.push(
          md.table(
            ['Edit', 'What it does', 'Main job in', 'Helps', 'Costs'],
            d.edits.map((e: any) => [e.what, e.how, e.main_job.join(', ') || '–', e.helps.join(', ') || '–', e.costs.join(', ') || '–']), // eslint-disable-line @typescript-eslint/no-explicit-any
          ),
        );
        if (full) {
          for (const l of d.loci) parts.push(`**${l.title}** (${l.tests}). ${l.action}.\n${md.bullets(l.notes)}`);
        }
        if (d.still_on_paper) {
          parts.push(md.h(3, 'Still on paper: proposed upgrades, not built, measured or scored') + md.bullets(d.still_on_paper.map((p: any) => `**${p.title}.** ${p.text}`))); // eslint-disable-line @typescript-eslint/no-explicit-any
        }
      }
      parts.push(md.h(2, 'The setting all three designs share'), md.bullets(overview.environment.map((e: any) => `**${e.what}:** ${e.detail}`))); // eslint-disable-line @typescript-eslint/no-explicit-any
      if (showScores) {
        parts.push(md.h(2, 'Model scores, with their caveat'));
        parts.push(`> ${scores.caveat}\n`);
        parts.push(
          md.table(
            ['Design', 'Gene edits', 'Model score (child profile)', 'Weakest test'],
            scores.designs.map((s: any) => [ // eslint-disable-line @typescript-eslint/no-explicit-any
              s.id === 'A' || s.id === 'B' || s.id === 'X' ? `Design ${s.id}` : `${s.id} (reference design from another group)`,
              String(s.gene_edits) + (s.base_edits ? ` and ${s.base_edits} base edit` : ''),
              String(s.score_children),
              `Test ${s.weakest_test}`,
            ]),
          ),
        );
        data = { designs: overview.designs, scores: scores.designs, caveat: scores.caveat, spread: scores.spread };
      } else {
        notes.push('Model scores are switched off in this connector for now.');
        data = { designs: overview.designs };
      }
      body = parts.join('\n');
      break;
    }
    case 'roadmap': {
      summary = 'The roadmap has seven stages. Stage 0, the blueprint, is where the project is now and is shown in full. Stages 1 to 6 are an outline only: they are meant to be carried out with partner organisations, or by any organisation that takes the open blueprint. Stage 3 is animal studies: the exact human product is tested in mice that carry a human immune system, while an optional companion project, Canine Islet-1, runs alongside with the aim of curing an Australian terrier with insulin-dependent diabetes, and never holds up the human trial.';
      const detailed = (s: any) => // eslint-disable-line @typescript-eslint/no-explicit-any
        `${md.h(2, `Stage ${s.id} · ${s.name} (${s.state})`)}${s.summary}\n\n*Why this stage:* ${s.why}\n\n${md.numbered(s.points)}\n` +
        `*A pass looks like:* ${s.a_pass_looks_like}\n\n*We stop or change the plan if:* ${s.we_stop_or_change_the_plan_if}\n\n*Not known yet:* ${s.not_known_yet}\n\n*Where it stands:* ${s.where_it_stands}\n` +
        (s.when ? `\n*When:* ${s.when}\n` : '');
      const outline = (s: any) => // eslint-disable-line @typescript-eslint/no-explicit-any
        `${md.h(2, `Stage ${s.id} · ${s.name} (${s.state})`)}${s.summary}\n\n*Why this stage:* ${s.why}\n\n*Carried out by:* ${s.carried_out_by}.\n` + (s.when ? `\n*When:* ${s.when}\n` : '');
      const after = overview.after_the_blueprint;
      body =
        md.h(1, 'The roadmap') +
        overview.roadmap.map((s: any) => (s.points ? detailed(s) : outline(s))).join('\n') + // eslint-disable-line @typescript-eslint/no-explicit-any
        `\n${md.h(2, after.heading)}${after.summary}\n\n` +
        md.bullets(after.ways.map((w: any) => `**${w.title}.** ${w.text}`)) + // eslint-disable-line @typescript-eslint/no-explicit-any
        `\n${after.note}\n`;
      if (full) body += `\n---\n\n${md.h(2, 'For scientists')}\n` + overview.roadmap.filter((s: any) => s.for_scientists).map((s: any) => `${md.h(3, `Stage ${s.id}`)}${md.bullets(s.for_scientists)}`).join('\n'); // eslint-disable-line @typescript-eslint/no-explicit-any
      data = { stages: overview.roadmap, after_the_blueprint: after };
      break;
    }
    case 'versions': {
      const v = await listVersions(bundle);
      return { ...v, notes: [...(v.notes ?? []), ...(full ? [] : [])] };
    }
    case 'help': {
      const status = cfg.submissionsOpen
        ? 'Sending an Islet Improvement Proposal (IIP) is open.'
        : 'Right now you can connect your AI, explore the blueprint and check a draft. Sending an Islet Improvement Proposal (IIP) opens when the public queue opens.';
      summary = `You can help by finding a weak spot, testing your own idea, or finding a paper that was missed. ${status}`;
      body =
        md.h(1, 'How you can help') +
        md.numbered(overview.how_to_help.steps.map((s: any) => `**${s.title}.** ${s.text}`)) + // eslint-disable-line @typescript-eslint/no-explicit-any
        `\n${status}\n\n${overview.how_to_help.note}\n\nThe full walkthrough is at ${overview.how_to_help.guide}.\n\nQuestions or problems? Write to ${overview.how_to_help.contact.email}, or find ${overview.how_to_help.contact.x} on X.`;
      data = { steps: overview.how_to_help.steps, submissions_open: cfg.submissionsOpen, guide: overview.how_to_help.guide, contact: overview.how_to_help.contact };
      break;
    }
  }

  if (full) {
    const wanted = SPEC[section];
    const parts = wanted.map((id) => specSections.sections.find((s) => s.id === id)?.markdown).filter((m): m is string => Boolean(m));
    if (parts.length) {
      body += `\n\n---\n\n${md.h(1, 'From the concise specification')}\n${parts.join('\n')}`;
      data = { ...data, specification: wanted };
    }
  } else if (SPEC[section].length) {
    notes.push('Ask for detail "full" to add the technical text from the concise specification.');
  }

  data = { section, release: { version: meta.blueprint_release, date: longDate(meta.release_date) }, ...data };
  return { summary, body, data, notes };
}

