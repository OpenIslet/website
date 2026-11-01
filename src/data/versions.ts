// The version plan: one design family (Islet-1), an open draft that anyone can work against, and a locked version
// every three months. The connector's data bundle reads this file too, so the website and the connector always
// agree on the names and dates.
//
// To move a date, change it here and nowhere else: every page, the connector, the changelog picture and the tests read these
// dates (a test fails if a date is typed in anywhere else). A lock never slips silently: if a lock fails its checks it moves by
// days and the new date is written here.
//
// The dates assume the launch checks are done by then. If the launch is not ready, move `opens`
// (and the locks, if they should move too).

export const family = 'Islet-1';

/** The open draft, from the public launch until the first lock. */
export const draft = {
  id: 'islet-1-draft',
  name: 'Islet-1 open draft',
  /** The blueprint release that opens it. */
  release: 'v0.8.0',
  opens: '2026-11-01',
};

export interface PlannedLock {
  id: string;
  name: string;
  /** From this date only fixes and corrections are accepted. */
  freezeFrom: string;
  /** The day the version is locked. */
  lock: string;
}

export const planned: PlannedLock[] = [
  { id: 'islet-1.0', name: 'Islet-1.0', freezeFrom: '2027-01-18', lock: '2027-02-01' },
  { id: 'islet-1.1', name: 'Islet-1.1', freezeFrom: '2027-04-15', lock: '2027-05-01' },
  { id: 'islet-1.2', name: 'Islet-1.2', freezeFrom: '2027-07-15', lock: '2027-08-01' },
  { id: 'islet-1.3', name: 'Islet-1.3', freezeFrom: '2027-10-15', lock: '2027-11-01' },
];

/**
 * Why a new version every three months (Kev, 26 October 2026). Kev's wording choice: just "AI", not "AI and lab robots", because AI is in the driving seat. The Home page, the Blueprint
 * page, the Roadmap, Start here, the starter pack and the connector all use these words, so the message is the same everywhere.
 * No dates in them: the dates are above. Keep the tone: the plan is not set in stone, and nothing here promises a result.
 */
export const cadence = {
  /** The Home page card. */
  kicker: 'Not set in stone',
  title: 'A plan that keeps up',
  short: 'AI keeps getting better, and nobody knows exactly how fast. So every three months we re-check the blueprint, and the steps after it, with the newest AI, and lock a new version.',
  /** The Blueprint page's versions panel, the connector and the starter pack. */
  long: 'The plan is not set in stone. AI is improving quickly, and nobody knows exactly how. So every three months we re-check the whole blueprint with the newest AI models, bring in what contributors have sent, and lock a new version that a lab can test exactly as written. The steps after the blueprint are reviewed on the same schedule: as AI improves, some steps may get faster or cheaper, or change.',
  /** The Roadmap. */
  roadmap: 'This roadmap is today’s best plan, not a fixed one. It is reviewed every three months, together with the blueprint, because AI keeps changing what is possible and how long each step takes.',
  /** Start here, step 6: what an accepted IIP leads to. */
  contributors: 'it goes into the next version (a new one is locked every three months)',
};

/** What the names mean, in plain English. */
export const explainer = {
  family: 'Islet-1 is the design family: the personalised cell therapy, with Design A as the lead and Design B and Design X as the alternatives being compared.',
  draft: 'The draft changes all the time. It is where new IIPs are added and tested.',
  lock: 'A locked version is frozen. It never changes, it has its own DOI so it can be cited, and a lab can take it and test it exactly as written.',
  patch: 'A correction to a locked version (a typo, a wrong citation or a wrong sequence label) is numbered 1.1.1. It never changes the design.',
  next: 'A new family, Islet-2, starts only if the design changes so much that lab results from Islet-1 would not carry over.',
};
