// The versions: one open draft, and a locked version every three months.
import { type Answer, md } from './answer';
import type { Bundle } from './bundle';
import { longDate } from './text';

export async function listVersions(bundle: Bundle): Promise<Answer> {
  const v = await bundle.versions();
  const locked = v.locked;
  const next = v.planned[0];
  const summary = locked.length
    ? `${v.family} has ${locked.length} locked ${locked.length === 1 ? 'version' : 'versions'}, the newest being ${locked[locked.length - 1].name}, and an open draft that keeps changing.`
    : next
      ? `${v.family} is an open draft that keeps changing. No version is locked yet. The first lock, ${next.name}, is planned for ${longDate(next.lock_date)}, with only fixes and corrections from ${longDate(next.freeze_from)}. A new locked version follows every three months.`
      : `${v.family} is an open draft that keeps changing. No version is locked yet. The next lock date has not been scheduled.`;
  const body =
    md.h(1, `${v.family} versions`) +
    `\n${v.explainer.family}\n\n` +
    md.bullets([v.explainer.draft, v.explainer.lock, v.explainer.patch, v.explainer.next]) +
    '\n' +
    md.h(2, 'Why a new version every three months') +
    `${v.cadence}\n\n` +
    md.h(2, 'Where things stand') +
    md.table(
      ['Version', 'Status', 'Date', 'Citable (DOI)'],
      [
        [v.draft.name, 'Open draft', `Opens ${longDate(v.draft.opens)} as ${v.draft.release_when_it_opens}`, 'Not applicable'],
        ...locked.map((l) => [l.name, 'Locked', longDate(l.lock_date), l.doi ?? 'Being minted']),
        ...v.planned.map((p) => [p.name, `Planned. Fixes only from ${longDate(p.freeze_from)}`, longDate(p.lock_date), 'At the lock']),
      ],
    ) +
    '\n' +
    md.h(2, 'The draft so far') +
    (v.history.length
      ? md.table(
          ['Release', 'Date', 'What changed'],
          v.history.map((h) => [h.version, longDate(h.date), `${h.title}. ${h.summary}`]),
        )
      : `Nothing has changed yet. The changelog starts when the open draft opens on ${longDate(v.draft.opens)}, and every change after that is listed here.\n`) +
    `\nThis data bundle holds blueprint release ${v.draft.blueprint_release_in_this_bundle}.`;
  return {
    summary,
    body,
    data: { family: v.family, draft: v.draft, locked: v.locked, planned: v.planned, history: v.history.map((h) => ({ version: h.version, date: h.date, title: h.title })) },
    notes: ['A locked version never changes. Answers say which version they came from.'],
  };
}

export interface Resolved {
  bundleId: string;
  note: string | null;
  /** A version listed as locked must also carry frozen=true in its own metadata. */
  requiresFrozen?: true;
}

/** Turns "draft", "latest" or a name such as "islet-1.0" into the bundle that answers. */
export async function resolveVersion(
  asked: string | undefined,
  active: Bundle,
  exists: (bundleId: string) => Promise<boolean>,
): Promise<Resolved | { error: string }> {
  const want = (asked ?? 'draft').trim().toLowerCase();
  const versions = await active.versions();
  if (want === 'draft' || want === active.id) {
    const indexedAsLocked = versions.locked.some((v) => v.id === active.id);
    return { bundleId: active.id, note: null, ...(indexedAsLocked ? { requiresFrozen: true as const } : {}) };
  }
  if (want === 'latest') {
    const newest = versions.locked[versions.locked.length - 1];
    if (newest) {
      if (await exists(newest.id)) return { bundleId: newest.id, note: null, requiresFrozen: true };
      return { error: `The latest locked version, ${newest.id}, is not loaded. Please retry later or ask explicitly for "draft".` };
    }
    const next = versions.planned[0];
    return { bundleId: active.id, note: 'No version is locked yet, so this answer comes from the open draft.' + (next ? ` ${next.name} is planned for ${longDate(next.lock_date)}.` : ' The next lock date has not been scheduled.') };
  }
  const known = [...versions.locked.map((l) => l.id), ...versions.planned.map((p) => p.id)];
  if (versions.locked.some((l) => l.id === want)) {
    if (await exists(want)) return { bundleId: want, note: null, requiresFrozen: true };
    return { error: `The locked version ${want} is not loaded. Please retry later or ask explicitly for "draft".` };
  }
  if (versions.planned.some((p) => p.id === want)) return { error: `${want} is planned but not locked yet, so there is nothing to read. Ask for "draft", or list_versions for the dates.` };
  return { error: `There is no version called "${asked}". Known versions: draft, latest, ${known.join(', ')}.` };
}
