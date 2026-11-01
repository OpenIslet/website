import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rename } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error The executable shared JavaScript helper is exercised directly.
import { acquireSyncLock, publishFiles } from '../../scripts/sync-io.mjs';
const dirs: string[] = [];
const temp = () => { const p = fs.mkdtempSync(path.join(os.tmpdir(), 'oi-publish-')); dirs.push(p); return p; };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('Publication ownership boundaries', () => {
  it.each([false, true])('stops after ownership is replaced during a rename (caller owns lock: %s)', async callerOwnsLock => {
    const root = temp(), a = path.join(root, 'a'), b = path.join(root, 'b');
    fs.writeFileSync(a, 'old-a'); fs.writeFileSync(b, 'old-b');
    const original = callerOwnsLock ? await acquireSyncLock(root) : undefined;
    let successor: { release(): void } | undefined;
    let calls = 0, failure: unknown;
    try {
      await publishFiles(root, new Map([[a, Buffer.from('new-a')], [b, Buffer.from('new-b')]]), {
        ...(original ? { lock: original } : {}),
        renameFile: async (from: string, to: string) => {
          await rename(from, to);
          if (++calls === 1) {
            fs.renameSync(path.join(root, '.openislet-sync-lock'), path.join(root, 'displaced-owner'));
            successor = await acquireSyncLock(root);
          }
        },
      });
    } catch (error) { failure = error; }
    try {
      expect(failure).toBeInstanceOf(AggregateError);
      expect(String(failure)).toMatch(/recovery files preserved/);
      expect(calls).toBe(1);
      expect(fs.readFileSync(b, 'utf8')).toBe('old-b');
      expect(fs.readFileSync(a, 'utf8')).toBe('new-a');
      const stage = fs.readdirSync(root).find(p => fs.existsSync(path.join(root, p, 'old-0')))!;
      expect(fs.readFileSync(path.join(root, stage, 'old-0'), 'utf8')).toBe('old-a');
      expect(fs.existsSync(path.join(root, '.openislet-sync-lock'))).toBe(true);
    } finally { successor?.release(); }
  });
  it('rejects overlapping publications sharing one ownership token', async () => {
    const root = temp(), a = path.join(root, 'a'), b = path.join(root, 'b');
    const lock = await acquireSyncLock(root);
    let nestedError: unknown;
    try {
      await publishFiles(root, new Map([[a, Buffer.from('first')]]), { lock, renameFile: async (from: string, to: string) => {
        try { await publishFiles(root, new Map([[b, Buffer.from('nested')]]), { lock }); }
        catch (error) { nestedError = error; }
        return rename(from, to);
      } });
      expect(nestedError).toBeInstanceOf(Error);
      expect(String(nestedError)).toMatch(/already in use/);
      expect(fs.readFileSync(a, 'utf8')).toBe('first');
      expect(fs.existsSync(b)).toBe(false);
    } finally { lock.release(); }
  });
  it('permits sequential publication with one retained ownership token', async () => {
    const root = temp(), target = path.join(root, 'a'); const lock = await acquireSyncLock(root);
    try {
      await publishFiles(root, new Map([[target, Buffer.from('first')]]), { lock });
      await publishFiles(root, new Map([[target, Buffer.from('second')]]), { lock });
      expect(fs.readFileSync(target, 'utf8')).toBe('second');
    } finally { lock.release(); }
  });
  it('never steals a pre-existing owner directory and permits inspected manual recovery', async () => {
    const root = temp(), marker = path.join(root, '.openislet-sync-lock'); fs.mkdirSync(marker);
    await expect(acquireSyncLock(root)).rejects.toThrow(/owns/);
    expect(fs.existsSync(marker)).toBe(true);
    fs.rmdirSync(marker); const lock = await acquireSyncLock(root); lock.release();
    expect(fs.existsSync(marker)).toBe(false);
  });
});


describe('Publisher-reserved path ancestry', () => {
  it.each([
    ['.openislet-sync-lock/payload', false], ['.OPENISLET-SYNC-LOCK/payload', false],
    ['nested/.openislet-sync-lock/payload', false], ['.openislet-sync-lock/payload', true],
    ['.OPENISLET-SYNC-LOCK/payload', true], ['nested/.openislet-sync-lock/payload', true],
  ])('rejects reserved target %s before writes (retained lock: %s)', async (relative, retained) => {
    const root = temp(), ordinary = path.join(root, 'data/payload');
    fs.mkdirSync(path.dirname(ordinary)); fs.writeFileSync(ordinary, 'old');
    const lock = retained ? await acquireSyncLock(root) : undefined;
    try {
      await expect(publishFiles(root, new Map([[ordinary, Buffer.from('new')], [path.join(root, relative as string), Buffer.from('must not publish')]]), lock ? { lock } : {})).rejects.toThrow(/reserved.*ownership/i);
      expect(fs.readFileSync(ordinary, 'utf8')).toBe('old');
      expect(fs.existsSync(path.join(root, relative as string))).toBe(false);
      if (retained) expect(fs.readdirSync(path.join(root, '.openislet-sync-lock'))).toEqual([]);
      else expect(fs.existsSync(path.join(root, '.openislet-sync-lock'))).toBe(false);
    } finally { lock?.release(); }
  });
  it('also rejects retirement inside the ownership directory', async () => {
    const root = temp();
    await expect(publishFiles(root, new Map([[path.join(root, '.openislet-sync-lock/payload'), null]]))).rejects.toThrow(/reserved.*ownership/i);
    expect(fs.existsSync(path.join(root, '.openislet-sync-lock'))).toBe(false);
  });
  it('preserves ordinary data publication under a Unicode-normalized root', async () => {
    const root = path.join(temp(), 're\u0301lease'); fs.mkdirSync(root);
    const target = path.join(root, 'data/payload');
    await publishFiles(root, new Map([[target, Buffer.from('ordinary')]]));
    expect(fs.readFileSync(target, 'utf8')).toBe('ordinary');
    expect(fs.existsSync(path.join(root, '.openislet-sync-lock'))).toBe(false);
  });
});
