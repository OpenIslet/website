// Reads a bundle from a folder: connector/bundle/<id>/. Used by the tests and the local command line, never by the Worker.
// @ts-expect-error Shared JavaScript boundary is exercised by Vitest.
import { readRegularFile } from '../../scripts/regular-files.mjs';
import type { BundleStore } from '../core/store';

export class FsStore implements BundleStore {
  constructor(private readonly root: string) {}
  async read(bundleId: string, file: string): Promise<string | null> {
    try {
      return readRegularFile(this.root, `${bundleId}/${file}`).toString('utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
}
