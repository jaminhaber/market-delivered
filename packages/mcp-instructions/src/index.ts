export type AssistantId = 'chatgpt' | 'claude';
export type ProviderId = AssistantId | 'token';
export type OAuthInterfaceId = 'desktop' | 'terminal';
export type InterfaceId = OAuthInterfaceId | AssistantId;
export type AuthMethod = 'oauth' | 'token';
export type Provider = {
  id: ProviderId;
  name: string;
  auth: AuthMethod;
  interfaceLabel: string;
};
export type SetupInterface = { id: InterfaceId; name: string };
export type InstructionBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'steps'; items: string[] }
  | {
      type: 'copy';
      label: string;
      copyLabel: string;
      value: string;
      kind: 'address' | 'command';
    };

type ServerOptions = {
  serverName: string;
  displayName: string;
  serverUrl: string;
  examplePrompt?: string;
};
export type SetupOptions = ServerOptions &
  (
    | {
        provider: AssistantId;
        interface: OAuthInterfaceId;
        approvalLabel?: string;
      }
    | { provider: 'token'; interface: AssistantId; tokenFile: string }
  );
export type SetupInstructions = {
  provider: Provider;
  interface: SetupInterface;
  auth: AuthMethod;
  blocks: InstructionBlock[];
};

const assistants = {
  chatgpt: { name: 'ChatGPT', terminalName: 'Codex' },
  claude: { name: 'Claude', terminalName: 'Claude Code' },
} as const;
const providers: readonly Provider[] = [
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    auth: 'oauth',
    interfaceLabel: 'How do you use it?',
  },
  {
    id: 'claude',
    name: 'Claude',
    auth: 'oauth',
    interfaceLabel: 'How do you use it?',
  },
  {
    id: 'token',
    name: 'API token / automation',
    auth: 'token',
    interfaceLabel: 'Which assistant do you use?',
  },
];
const interfaces: readonly SetupInterface[] = [
  { id: 'desktop', name: 'Desktop app' },
  { id: 'terminal', name: 'Terminal' },
];

export function listProviders(): Provider[] {
  return providers.map((provider) => ({ ...provider }));
}

/** OAuth providers offer app/terminal choices; token setup offers assistant choices. */
export function listInterfaces(provider: ProviderId): SetupInterface[] {
  getProvider(provider);
  if (provider === 'token')
    return [
      { id: 'chatgpt', name: 'ChatGPT (Codex)' },
      { id: 'claude', name: 'Claude Code' },
    ];
  return interfaces.map((item) => ({ ...item }));
}

function getProvider(id: ProviderId): Provider {
  const provider = providers.find((item) => item.id === id);
  if (!provider) throw new Error(`Unsupported MCP provider: ${id}`);
  return { ...provider };
}

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

function validateTokenFile(file: string) {
  if (
    !/^[a-zA-Z0-9._/-]+$/.test(file) ||
    file.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error(
      'tokenFile must be a relative path inside the home directory',
    );
}

/** Builds a private credential-file command without putting the token in MCP configuration. */
export function getTokenSaveCommand(options: {
  token: string;
  tokenFile: string;
}): string {
  validateTokenFile(options.tokenFile);
  if (!options.token || /[\r\n]/.test(options.token))
    throw new Error('Expected a single-line token');
  const parent = options.tokenFile.includes('/')
    ? options.tokenFile.slice(0, options.tokenFile.lastIndexOf('/'))
    : '';
  const directory = parent
    ? `mkdir -p "$HOME/${parent}" && chmod 700 "$HOME/${parent}" && `
    : '';
  return `(umask 077 && ${directory}touch "$HOME/${options.tokenFile}" && chmod 600 "$HOME/${options.tokenFile}" && printf '%s\\n' ${shellQuote(`Authorization: Bearer ${options.token}`)} > "$HOME/${options.tokenFile}")`;
}

export function getSetupInstructions(options: SetupOptions): SetupInstructions {
  const provider = getProvider(options.provider);
  const selectedInterface = listInterfaces(provider.id).find(
    (item) => item.id === options.interface,
  );
  if (!selectedInterface)
    throw new Error(
      `Unsupported MCP setup: ${provider.id}/${options.interface}`,
    );
  const assistantId =
    options.provider === 'token' ? options.interface : options.provider;
  const assistant = assistants[assistantId];
  if (!/^[a-zA-Z0-9_-]+$/.test(options.serverName))
    throw new Error('Invalid MCP server name');
  const url = new URL(options.serverUrl);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error(
      'Expected an HTTP(S) MCP URL without credentials or a fragment',
    );
  const serverUrl = url.href;
  const blocks: InstructionBlock[] = [];
  const paragraph = (text: string) => blocks.push({ type: 'paragraph', text });
  const command = (value: string) =>
    blocks.push({
      type: 'copy',
      label: 'Setup command',
      copyLabel: `Copy ${assistant.terminalName} setup`,
      value,
      kind: 'command',
    });
  const approval =
    options.provider !== 'token'
      ? (options.approvalLabel ?? `Allow access to ${options.displayName}`)
      : '';
  const signIn = `Sign in to ${options.displayName} and choose “${approval}”.`;

  if (options.provider === 'token') {
    validateTokenFile(options.tokenFile);
    blocks.push({ type: 'heading', text: '1. Save your token' });
    paragraph(
      `Create a token, then run its “Copy save command” in Terminal. This saves the credential privately at ~/${options.tokenFile}.`,
    );
    blocks.push({ type: 'heading', text: '2. Connect your assistant' });
    paragraph(
      `With Node.js and ${assistant.terminalName} installed, copy and run this setup in Terminal.`,
    );
    const register =
      assistantId === 'chatgpt'
        ? `codex mcp add ${options.serverName}`
        : `claude mcp add --scope user --transport stdio ${options.serverName}`;
    command(
      `chmod 600 "$HOME/${options.tokenFile}" &&\n${register} -- npx -y mcp-remote ${shellQuote(serverUrl)} --transport http-only --header-file "$HOME/${options.tokenFile}"`,
    );
    paragraph('Restart your assistant after setup.');
  } else if (selectedInterface.id === 'desktop') {
    blocks.push({
      type: 'steps',
      items:
        assistantId === 'chatgpt'
          ? [
              'In ChatGPT, open Settings → MCP servers and select Add server.',
              `Name it ${options.displayName}, choose Streamable HTTP, and paste the connection address below.`,
              `Save, select Restart, then choose Authenticate next to ${options.displayName}.`,
              signIn,
            ]
          : [
              'In Claude, open Customize → Connectors and choose Add → Add custom connector.',
              `Name it ${options.displayName}, paste the connection address below, and select Continue.`,
              'Choose Sign in now and finish adding the connector.',
              signIn,
            ],
    });
    blocks.push({
      type: 'copy',
      label: 'Connection address',
      copyLabel: 'Copy address',
      value: serverUrl,
      kind: 'address',
    });
  } else {
    paragraph(
      `With ${assistant.terminalName} installed, copy and run this setup in Terminal.`,
    );
    command(
      assistantId === 'chatgpt'
        ? `codex mcp add ${options.serverName} --url ${shellQuote(serverUrl)}`
        : `claude mcp add --scope user --transport http ${options.serverName} ${shellQuote(serverUrl)}`,
    );
    if (assistantId === 'claude')
      paragraph(
        `Start Claude Code, run /mcp, select ${options.serverName}, and choose Authenticate. ${signIn}`,
      );
    else
      paragraph(
        `In the browser that opens, ${signIn.charAt(0).toLowerCase()}${signIn.slice(1)}`,
      );
  }
  paragraph(
    `Start a new chat and ask: “${options.examplePrompt ?? `Use ${options.displayName} to list available tools.`}”`,
  );
  return {
    provider,
    interface: selectedInterface,
    auth: provider.auth,
    blocks,
  };
}
