// What every tool returns, and the switches that change what the connector offers.

export interface Answer {
  /** Two or three plain-English sentences. The first thing a person reads. */
  summary: string;
  /** Markdown with the detail and the sources. */
  body: string;
  /** The same facts as data, for programs. */
  data: Record<string, unknown>;
  /** Short notes the person should see: caveats, cuts, what was assumed. */
  notes?: string[];
  /** True when the question could not be answered (an unknown PMID, a bad module name). The text says how to fix it. */
  isError?: boolean;
}

export interface Config {
  /** The bundle that answers when no version is asked for. */
  activeBundle: string;
  /** Whether `submit_proposal` sends IIPs (Islet Improvement Proposals) to the queue. Closed until the public queue exists. */
  submissionsOpen: boolean;
  /** Whether scenario scores appear (only inside the designs section, always with their caveat). */
  scenarioScores: boolean;
  /**
   * Whether the patient layer shows its simulated "5-year survival" percentages. They come from a scenario simulation,
   * not from patients, and read like clinical figures, so they always appear under the layer's scope note. The project
   * owner chose to show them (24 October 2026). Set SHOW_SIMULATED_SURVIVAL=false to hold them back.
   */
  simulatedSurvival: boolean;
  /** The public queue's issue list (from QUEUE_REPO), so an IIP sent since the last weekly update can be pointed to. */
  queueIssues?: string;
}

export const defaultConfig: Config = { activeBundle: 'islet-1-draft', submissionsOpen: false, scenarioScores: true, simulatedSurvival: true };

export function configFromEnv(env: Partial<Record<string, string>>): Config {
  const on = (v: string | undefined, fallback: boolean) => (v === undefined ? fallback : /^(1|true|yes|on)$/i.test(v.trim()));
  return {
    activeBundle: env.ACTIVE_BUNDLE?.trim() || defaultConfig.activeBundle,
    submissionsOpen: on(env.SUBMISSIONS_OPEN, defaultConfig.submissionsOpen),
    scenarioScores: on(env.UNFREEZE_SCENARIO_SCORES, defaultConfig.scenarioScores),
    simulatedSurvival: on(env.SHOW_SIMULATED_SURVIVAL, defaultConfig.simulatedSurvival),
    ...(queueIssuesFrom(env) ? { queueIssues: queueIssuesFrom(env) } : {}),
  };
}

function queueIssuesFrom(env: Partial<Record<string, string>>): string | undefined {
  const repo = env.QUEUE_REPO?.trim() ?? '';
  const web = (env.GITHUB_WEB_BASE?.trim() || 'https://github.com').replace(/\/+$/, '');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || !/^https?:\/\/[^\s/]+$/.test(web)) return undefined;
  return `${web}/${repo}/issues`;
}

// Small Markdown helpers, so every answer looks the same.
export const md = {
  // One line always: a title that came from a contributor can't start a new heading or section of its own.
  h: (level: number, text: string) => `${'#'.repeat(level)} ${text.replace(/\s+/g, ' ').trim()}\n`,
  bullets: (items: string[]) => items.map((i) => `- ${i}`).join('\n') + '\n',
  numbered: (items: string[]) => items.map((i, n) => `${n + 1}. ${i}`).join('\n') + '\n',
  table: (headers: string[], rows: string[][]) =>
    [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map((c) => c.replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`)].join('\n') + '\n',
  link: (text: string, href: string) => `[${text}](${href})`,
};

/** A person-friendly error answer. */
export function problem(summary: string, help: string[]): Answer {
  return { summary, body: `${summary}\n\n${md.bullets(help)}`, data: { problem: summary, help }, isError: true };
}
