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

const providers = listProviders(); // ChatGPT and Claude
const interfaces = listInterfaces('chatgpt');

const setup = getSetupInstructions({
  provider: 'chatgpt',
  interface: 'desktop',
  serverName: 'market-delivered',
  displayName: 'Market Delivered',
  serverUrl: 'https://admin.example.com/mcp',
  examplePrompt: 'Use Market Delivered to list my networks.',
});
```

`setup.blocks` contains discriminated `heading`, `paragraph`, `steps`, and `copy`
blocks. Text is plain text; render it as escaped text rather than raw HTML.
Copy blocks include their label, button label, value, and kind (`address` or
`command`). No Markdown parser is required. `approvalLabel` can customize the
OAuth consent button name; it defaults to `Allow access to <displayName>`.

`listInterfaces('chatgpt')` and `listInterfaces('claude')` return Desktop app
and Terminal. Both use the same account-wide OAuth connection. API token creation
and credential-file instructions are not supported.

Silverstreak uses the Astro renderer in
`apps/silverstreak/src/components/McpInstructionBlocks.astro`. The admin app uses
the React renderer in `apps/admin/src/McpSetupInstructions.tsx`. Apps own provider
selection, clipboard behavior, and navigation to the central OAuth flow.
