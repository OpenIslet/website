// Materialize the advertised contract from the actual registered MCP server.
// No endpoint is called and no queue, credentials or network are used.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const connector = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = path.join(connector, `.tool-schema-${process.pid}.mjs`);
try {
  await build({ stdin: { contents: `
    import { Client } from '@modelcontextprotocol/client';
    import { InMemoryTransport } from '@modelcontextprotocol/server';
    import { createConnectorServer } from './src/server';
    import { defaultConfig } from './src/core/answer';
    import { FsStore } from './src/node/fs-store';
    const [a,b] = InMemoryTransport.createLinkedPair();
    const server = createConnectorServer({store:new FsStore(process.cwd()+'/bundle'),config:defaultConfig});
    await server.connect(b);
    const client = new Client({name:'local-schema-export',version:'1.0.0'});
    await client.connect(a);
    console.log(JSON.stringify((await client.listTools()).tools));
    await client.close(); await server.close();
  `, resolveDir: connector, sourcefile: 'local-schema-export.ts', loader: 'ts' }, outfile: temporary, bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent' });
  const tools = JSON.parse(execFileSync(process.execPath, [temporary], {cwd:connector,encoding:'utf8'}));
  const target = path.resolve(connector, '../mcp_tool_schemas.json');
  const old = JSON.parse(fs.readFileSync(target,'utf8'));
  const categories = Object.fromEntries(old.tools.map((t)=>[t.name,t.category]));
  categories.submit_proposal = 'submission_github_signed_in_or_form_link';
  old.tools = tools.map((tool)=>({name:tool.name,category:categories[tool.name]??'read_only_anonymous',description:tool.description,inputSchema:tool.inputSchema}));
  // GitHub is the only sign-in. The contract is docs/connector/QUEUE-API.md.
  old.authentication_transport = 'Reading needs no sign-in. submit_proposal signed in through GitHub (OAuth 2.1 with PKCE; the token travels only in the HTTP Authorization: Bearer header, never in tool arguments) posts the Islet Improvement Proposal (IIP) straight away. Without a token it stages the checked draft and returns a one-click link to the pre-filled form at https://openislet.org/submit. GitHub is the only sign-in. ORCID iD, X handle and a display name are optional text fields, shown as typed and never as verified (docs/connector/QUEUE-API.md).';
  old.wetlab_measurement_contract = JSON.parse(fs.readFileSync(path.join(connector,'src/core/wetlab-endpoint-contract.json'),'utf8'));
  fs.writeFileSync(target, JSON.stringify(old,null,2)+'\n');
} finally { if(fs.existsSync(temporary))fs.unlinkSync(temporary); }
