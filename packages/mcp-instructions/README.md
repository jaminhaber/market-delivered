# MCP setup instructions

`@market/mcp-instructions` is a dependency-free, browser-safe TypeScript package for
MCP onboarding content. It owns provider names, supported interfaces, setup
steps, and commands. Applications render the returned blocks with their own
components and styles; the package does not render HTML or manage credentials.

```ts
import {
  listProviders,
  listInterfaces,
  getSetupInstructions,
} from '@market/mcp-instructions';

const providers = listProviders(); // ChatGPT, Claude, API token / automation
const interfaces = listInterfaces('chatgpt');

const setup = getSetupInstructions({
  provider: 'chatgpt',
  interface: 'desktop',
  serverName: 'silverstreak',
  displayName: 'Silverstreak',
  serverUrl: 'https://example.com/networks/silverstreak/mcp',
  examplePrompt: 'Use Silverstreak to list upcoming markets.',
});
```

`setup.blocks` contains discriminated `heading`, `paragraph`, `steps`, and `copy`
blocks. Text is plain text; render it as escaped text rather than raw HTML.
Copy blocks include their label, button label, value, and kind (`address` or
`command`). No Markdown parser is required. `approvalLabel` can customize the
OAuth consent button name; it defaults to `Allow access to <displayName>`.

`listInterfaces('chatgpt')` and `listInterfaces('claude')` return Desktop app
and Terminal. These providers use OAuth. `listInterfaces('token')` returns
ChatGPT (Codex) and Claude Code. Each provider includes `auth` and
`interfaceLabel`, so renderers can show the relevant second selector and
credential controls without a separate authentication selector.

For token-based automation, use `provider: 'token'`, `interface: 'chatgpt'` or
`'claude'`, and a `tokenFile` path relative to the user's home directory:

```ts
const setup = getSetupInstructions({
  provider: 'token',
  interface: 'claude',
  tokenFile: '.config/example/mcp.headers',
  serverName: 'example',
  displayName: 'Example',
  serverUrl: 'https://example.com/mcp',
});
```

Unsupported provider/interface combinations throw an error. The generated
command reads an Authorization
header from that file through `mcp-remote`; it never embeds a token in MCP client
configuration. The client needs Node.js and its assistant's CLI installed.

Use `getTokenSaveCommand({ token, tokenFile })` when displaying a newly issued
token. It returns a shell command that writes the header into a private file.
The command contains the token: show it only in the credential-creation result,
never in persistent setup content, logs, or analytics. Absolute paths, traversal,
and shell metacharacters in `tokenFile` are rejected. File commands target
Mac/Linux shells; they are not PowerShell commands.

Silverstreak uses the Astro renderer in
`apps/silverstreak/src/components/McpInstructionBlocks.astro`. The admin app uses
the React renderer in `apps/admin/src/McpSetupInstructions.tsx`. Apps own provider
selection, clipboard behavior, access checks, token issuance, and disconnecting
connections. The provider’s authentication method must match the endpoint: instruction
generation does not enable OAuth on a token-only server.
