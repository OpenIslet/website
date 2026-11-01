// How to add the OpenIslet connector to each AI assistant. The steps were last checked on `checkedOn`, which Start here shows.
// When you check them again (each assistant's own guide is linked from its tab), change the date.
// Assistants change their menus often, so every client links to its own guide where one exists.
// The order here is the order of the tabs: Claude Code first (the tab that opens), Cursor second to last, "Something else" last.
// Kev, 26 October 2026: this list is for coding assistants (the people who use MCP). The regular AI chat apps use the copy-and-paste route,
// with their own list of links on Start here (`aiChats` in src/pages/start.astro), so the Claude chat app is not here.
import { mcpEndpoint } from './site';

/** The day the assistants' steps below were last checked against each assistant's own screens and guides. */
export const checkedOn = '2026-11-01';

export interface Snippet {
  label: string;
  hint?: string;
  text: string;
}

export interface Client {
  id: string;
  label: string;
  blurb: string;
  steps: string[];
  /** Things to copy and paste: commands and settings. */
  snippets?: Snippet[];
  /** A heads-up shown under the steps. */
  note?: string;
  /** A stronger warning, shown above the steps. */
  caution?: string;
  guide?: { label: string; href: string };
  /** A one-click install link, if the app offers one. */
  oneClick?: { label: string; href: string };
  /** A second way to do it, folded away under the steps (for example the same assistant in a browser). */
  alt?: { title: string; steps: string[]; snippets?: Snippet[]; note?: string; guide?: { label: string; href: string } };
}

const cursorConfig = btoa(JSON.stringify({ url: mcpEndpoint }));

export const clients: Client[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    blurb: 'In the Claude desktop app, in its Code tab. Command-line steps are further down.',
    steps: [
      'Open Settings in the Claude desktop app, and choose Connectors, under Customize.',
      'Click + Add, then Add custom connector.',
      'Type OpenIslet as the name, paste the OpenIslet address as the MCP server URL, and click Continue.',
      'When it asks how to sign in, choose Sign in when needed. When it asks which OAuth client to use, choose Use Claude’s published identity.',
      'Open the Code tab and start a new session. Ask Claude which connectors it has. OpenIslet should be in the list.',
    ],
    note: 'In the desktop app, the connectors you connect in Claude are delivered to Claude Code in local and SSH sessions. If OpenIslet is not in the list, use the command-line steps below: they work in the desktop app too. On a Free plan Claude allows one custom connector. On Team and Enterprise plans an Owner adds it first, under Organization settings, Connectors, then each member clicks Connect. Steps checked in the Claude desktop app on 31 October 2026.',
    guide: { label: 'Claude’s guide to custom connectors', href: 'https://www.claude.com/docs/connectors/custom/remote-mcp' },
    alt: {
      title: 'Using the Claude Code command line instead',
      steps: [
        'Open your terminal.',
        'Paste the command below and press Enter.',
        'Start Claude Code and type /mcp to check that OpenIslet is connected.',
      ],
      snippets: [{ label: 'Command', text: `claude mcp add --transport http openislet ${mcpEndpoint}` }],
      note: 'The command line and the desktop app read the same settings files, so a server added this way works in both.',
      guide: { label: 'Claude Code’s guide to MCP servers', href: 'https://code.claude.com/docs/en/mcp' },
    },
  },
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    blurb: 'In the ChatGPT desktop app, which now runs Codex too.',
    steps: [
      'Open Settings in the ChatGPT desktop app, and choose Plugins, under Integrations.',
      'Open the MCPs tab. Click Add, then Add MCP server.',
      'Type OpenIslet as the name, and choose Streamable HTTP as the type.',
      'Paste the OpenIslet address as the URL, and click Save. Leave the other fields empty.',
      'If the list says OpenIslet needs sign-in, click Authenticate and choose GitHub. You only need to sign in to submit, so you can also skip it for now.',
      'In a new chat, type /mcp to check that OpenIslet is connected.',
    ],
    note: 'These settings are shared with Codex on the command line and in editors, so you add OpenIslet once. Menus checked in the ChatGPT desktop app.',
    guide: { label: 'OpenAI’s guide to MCP servers in ChatGPT and Codex', href: 'https://learn.chatgpt.com/docs/extend/mcp' },
    alt: {
      title: 'Using ChatGPT in a browser instead',
      steps: [
        'Go to chatgpt.com/plugins.',
        'Click the plus button, then Add custom MCP server.',
        'Give it a name, such as OpenIslet.',
        'Under Connection, choose a public endpoint and paste the OpenIslet address.',
        'If it asks about authentication, choose OAuth, so you can sign in later when you submit.',
        'Read the warning, click I understand and want to continue, then Create as a plugin.',
        'Install it. In a new chat, type @ and choose OpenIslet.',
      ],
      note: 'OpenAI says account and workspace policies apply to custom servers, and it does not list which plans can add one. If you cannot see Add custom MCP server, your plan or workspace may not allow it. Ask your workspace admin, or use another assistant from this list.',
      guide: { label: 'OpenAI’s guide to connecting a custom server', href: 'https://developers.openai.com/plugins/deploy/connect-chatgpt' },
    },
  },
  {
    id: 'antigravity',
    label: 'Antigravity',
    blurb: 'Google’s Antigravity, which works with Gemini. One settings file serves the Antigravity app, the editor and the command line.',
    steps: [
      'Open the file mcp_config.json in the .gemini/config folder in your home folder, or create it if it isn’t there. In the Antigravity editor you can also open it from the … menu at the top of the agent panel: MCP Servers, Manage MCP Servers, then View raw config.',
      'Add the OpenIslet entry from the box below, inside the “mcpServers” section. If the file already lists servers, add only the “openislet” part.',
      'Save the file.',
      'In the Antigravity app, open Customizations in the left sidebar and click Refresh under Installed MCP Servers. In the command line, type /mcp instead.',
      'If OpenIslet shows Authenticate, you can skip it for now. You only need to sign in when you submit.',
    ],
    snippets: [
      {
        label: 'Add to mcp_config.json',
        hint: 'Antigravity uses serverUrl, not url',
        text: `{
  "mcpServers": {
    "openislet": {
      "serverUrl": "${mcpEndpoint}"
    }
  }
}`,
      },
    ],
    note: 'The app’s Add MCP button opens Google’s own store, so OpenIslet goes in the settings file instead. If Refresh shows “Blocked by Admin Policy”, your organisation does not allow custom servers yet. Ask your admin.',
    guide: { label: 'Google’s Antigravity guide to MCP servers', href: 'https://antigravity.google/docs/mcp' },
  },
  {
    id: 'grok-build',
    label: 'Grok Build',
    blurb: 'xAI’s command-line coding agent.',
    steps: [
      'Install Grok Build and sign in, using xAI’s guide.',
      'Open your terminal.',
      'Paste the first command below and press Enter.',
      'Paste the second command to check the connection.',
    ],
    snippets: [
      { label: 'Add OpenIslet', text: `grok mcp add --transport http openislet ${mcpEndpoint}` },
      { label: 'Check the connection', text: 'grok mcp doctor openislet' },
      {
        label: 'Or add it by hand',
        hint: 'To the file ~/.grok/config.toml',
        text: `[mcp_servers.openislet]
url = "${mcpEndpoint}"`,
      },
    ],
    note: 'If Grok Build asks you to sign in to OpenIslet, choose GitHub. You only need to sign in when you submit.',
    guide: { label: 'xAI’s guide to MCP servers', href: 'https://docs.x.ai/developers/docs-mcp' },
  },
  {
    id: 'muse-code',
    label: 'Muse Code',
    blurb: 'Meta’s command-line coding agent.',
    caution:
      'Muse Code came out of beta in late August 2026. These steps follow the settings format its published guides describe. If your copy ignores the setting, connectors are not in your build yet.',
    steps: [
      'Install Muse Code and sign in, using Meta’s instructions.',
      'Open the settings file ~/.config/muse/settings.json. Create it if it isn’t there.',
      'Add the OpenIslet entry from the box below. Keep “schema_version”: 1 in the file, or Muse Code will not start.',
      'Save the file and restart Muse Code.',
      'Ask a question about OpenIslet. If it asks you to sign in, choose GitHub. You only need to sign in when you submit.',
    ],
    snippets: [
      {
        label: 'Add to settings.json',
        hint: '“optional” means Muse Code carries on if OpenIslet can’t be reached',
        text: `{
  "schema_version": 1,
  "mcp_servers": {
    "openislet": {
      "transport": "streamable_http",
      "url": "${mcpEndpoint}",
      "mode": "optional"
    }
  }
}`,
      },
    ],
    note: 'Muse Code does not sandbox MCP tools, and its sub-agents inherit every connection, so connect only servers you trust. OpenIslet only reads public data until you sign in to submit.',
  },
  {
    id: 'cursor',
    label: 'Cursor',
    blurb: 'For people who already use the Cursor code editor.',
    steps: [
      'Click Add to Cursor below. Cursor opens and asks you to approve.',
      'Approve the install. OpenIslet now shows under Customize, in the sidebar.',
      'Open a chat and ask your question.',
    ],
    snippets: [
      {
        label: 'Or add it by hand',
        hint: 'Paste into Cursor’s mcp.json',
        text: `{
  "mcpServers": {
    "openislet": {
      "url": "${mcpEndpoint}"
    }
  }
}`,
      },
    ],
    note: 'If the button does nothing, open Cursor’s MCP settings and add the address by hand.',
    guide: { label: 'Cursor’s MCP guide', href: 'https://cursor.com/docs/context/mcp' },
    oneClick: {
      label: 'Add to Cursor',
      href: `cursor://anysphere.cursor-deeplink/mcp/install?name=openislet&config=${cursorConfig}`,
    },
  },
  {
    id: 'other',
    label: 'Something else',
    blurb: 'Any app that supports remote MCP servers.',
    steps: [
      'Look in your app’s settings for MCP, connectors, tools or integrations.',
      'Add a remote server (sometimes called Streamable HTTP) and paste the OpenIslet address.',
      'If the app asks you to sign in, choose GitHub.',
    ],
    note: 'AI labs: use the same address from your own agent or test setup, with any MCP client that speaks Streamable HTTP and OAuth 2.1.',
  },
];
