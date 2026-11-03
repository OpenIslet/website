#!/usr/bin/env node
// Connects to a running connector over HTTP, the way an AI assistant would, and asks it a few things.
//
//   npm run smoke                          the local Worker (npm run dev)
//   npm run smoke -- https://example/mcp   any deployment
import fs from 'node:fs';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const url = new URL(process.argv[2] ?? 'http://localhost:8787/mcp');
const client = new Client({ name: 'openislet-smoke', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(url));

// The first planned lock, read from the website's version plan so the date lives in one place.
const versionsFile = fs.readFileSync(new URL('../../src/data/versions.ts', import.meta.url), 'utf8');
const firstLock = /lock:\s*'(\d{4}-\d{2}-\d{2})'/.exec(versionsFile)?.[1];
const firstLockText = firstLock ? new Date(`${firstLock}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';

const failures = [];
const expect = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};
const text = (r) => r.content.map((c) => c.text).join('\n');

const { tools } = await client.listTools();
expect(tools.length === 13, `lists 13 tools (${tools.map((t) => t.name).join(', ')})`);

let r = await client.callTool({ name: 'get_blueprint_overview', arguments: {} });
expect(!r.isError && text(r).includes('Islet-1') && r.structuredContent?.counts?.studies === 563 && text(r).includes('study records'), 'get_blueprint_overview answers in plain English');

r = await client.callTool({ name: 'search_studies', arguments: { gene: 'CD47', limit: 3 } });
expect(!r.isError && r.structuredContent.total > 5 && r.structuredContent.results.length === 3, 'search_studies finds CD47 studies');

r = await client.callTool({ name: 'get_study', arguments: { pmid: '38508139' } });
expect(!r.isError && text(r).includes('pubmed.ncbi.nlm.nih.gov/38508139'), 'get_study reads one study');

r = await client.callTool({ name: 'check_against_graveyard', arguments: { design: 'A' } });
expect(!r.isError && r.structuredContent.triggered.map((t) => t.id).join() === 'GY-009,GY-010', 'check_against_graveyard gives Design A its two risks');

r = await client.callTool({ name: 'list_versions', arguments: {} });
expect(!r.isError && firstLockText !== '' && text(r).includes(firstLockText), 'list_versions shows the first planned lock');

r = await client.callTool({ name: 'submit_proposal', arguments: { draft: 'short', review: 'short', consent: true } });
expect(r.isError && r.structuredContent.reason === 'basic_rules', 'submit_proposal applies the basic rules');

await client.close();
console.log(failures.length ? `\n${failures.length} check(s) failed.` : '\nAll checks passed.');
process.exit(failures.length ? 1 : 0);
