// Where a bundle's files come from. The connector reads them from R2 when deployed and from a folder when tested
// locally, through the same small interface.

export interface BundleStore {
  /** The text of one file in a bundle, or null if the bundle or the file does not exist. */
  read(bundleId: string, path: string): Promise<string | null>;
}

/** The subset of an R2 bucket the connector uses. */
export interface R2Like {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
}

export class R2Store implements BundleStore {
  constructor(private readonly bucket: R2Like) {}
  async read(bundleId: string, path: string): Promise<string | null> {
    const object = await this.bucket.get(`${bundleId}/${path}`);
    return object ? object.text() : null;
  }
}

/** An in-memory store, for tests that need a small custom bundle. */
export class MemoryStore implements BundleStore {
  constructor(private readonly files: Record<string, string>) {}
  async read(bundleId: string, path: string): Promise<string | null> {
    return this.files[`${bundleId}/${path}`] ?? null;
  }
}
