// Shared by the tests: where the built bundle is, and a client connected to the real server in memory.
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Config, defaultConfig } from '../src/core/answer';
import { Bundle } from '../src/core/bundle';
import { FsStore } from '../src/node/fs-store';
import { createConnectorServer } from '../src/server';

const here = path.dirname(fileURLToPath(import.meta.url));
export const connectorRoot = path.resolve(here, '..');
export const websiteRoot = path.resolve(connectorRoot, '..');
export const bundleRoot = path.join(connectorRoot, 'bundle');
export const bundleId = 'islet-1-draft';
export const bundleDir = path.join(bundleRoot, bundleId);

export const readJson = <T = any>(...parts: string[]): T => JSON.parse(fs.readFileSync(path.join(bundleDir, ...parts), 'utf8')); // eslint-disable-line @typescript-eslint/no-explicit-any

export const store = new FsStore(bundleRoot);
export const bundle = () => new Bundle(store, bundleId);

export async function connect(config: Partial<Config> = {}) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createConnectorServer({ store, config: { ...defaultConfig, ...config } });
  await server.connect(serverSide);
  const client = new Client({ name: 'openislet-tests', version: '1.0.0' });
  await client.connect(clientSide);
  return {
    client,
    async call(name: string, args: Record<string, unknown> = {}) {
      const result = (await client.callTool({ name, arguments: args })) as { content: { type: string; text: string }[]; structuredContent?: Record<string, any>; isError?: boolean }; // eslint-disable-line @typescript-eslint/no-explicit-any
      return { ...result, text: result.content.map((c) => c.text).join('\n') };
    },
    async close() {
      await client.close();
      await server.close();
    },
  };
}
