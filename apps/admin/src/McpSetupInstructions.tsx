import { useState } from 'react';
import { Copy } from 'lucide-react';

import {
  getSetupInstructions,
  getTokenSaveCommand,
  listProviders,
  listInterfaces,
  type InstructionBlock,
  type ProviderId,
  type InterfaceId,
  type AssistantId,
  type OAuthInterfaceId,
} from '@market/mcp-instructions';

function mcpConnection() {
  const endpoint = new URL('/admin/mcp', window.location.origin).href;
  const connection = 'global';
  const keyFile = `.config/market-delivered/dmarket-${connection}.headers`;
  return { endpoint, connection, keyFile };
}

export function McpSetupInstructions({
  provider,
  onProviderChange,
}: {
  provider: ProviderId;
  onProviderChange: (provider: ProviderId) => void;
}) {
  const [selectedInterface, setInterface] = useState<InterfaceId>('desktop');
  const { endpoint, keyFile } = mcpConnection();
  const interfaces = listInterfaces(provider);
  const interfaceId = interfaces.some((item) => item.id === selectedInterface)
    ? selectedInterface
    : interfaces[0]!.id;
  const providerOption = listProviders().find((item) => item.id === provider)!;
  const setup = getSetupInstructions({
    ...(provider !== 'token'
      ? {
          provider,
          interface: interfaceId as OAuthInterfaceId,
          approvalLabel: 'Allow global administrator access',
        }
      : {
          provider: 'token' as const,
          interface: interfaceId as AssistantId,
          tokenFile: keyFile,
        }),
    serverName: 'dmarket-global',
    displayName: 'Market Delivered',
    serverUrl: endpoint,
    examplePrompt: 'Use Market Delivered to list delivery networks.',
  });
  return (
    <div className="mcp-setup">
      <div className="mcp-choices">
        <label>
          How would you like to connect?
          <select
            value={provider}
            onChange={(event) =>
              onProviderChange(event.target.value as ProviderId)
            }
          >
            {listProviders().map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {interfaces.length > 1 && (
          <label>
            {providerOption.interfaceLabel}
            <select
              value={interfaceId}
              onChange={(event) =>
                setInterface(event.target.value as InterfaceId)
              }
            >
              {interfaces.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <InstructionBlocks blocks={setup.blocks} />
      {provider === 'token' && (
        <details>
          <summary>Access and connection notes</summary>
          <p>
            This token grants global administrator access. Keep the file
            private. Tokens expire after 90 days; replace the token in the file
            when needed.
          </p>
        </details>
      )}
    </div>
  );
}

function InstructionBlocks({
  blocks,
}: {
  blocks: readonly InstructionBlock[];
}) {
  return blocks.map((block, index) => {
    if (block.type === 'heading') return <h3 key={index}>{block.text}</h3>;
    if (block.type === 'paragraph') return <p key={index}>{block.text}</p>;
    if (block.type === 'steps')
      return (
        <ol key={index}>
          {block.items.map((item, itemIndex) => (
            <li key={itemIndex}>{item}</li>
          ))}
        </ol>
      );
    return (
      <CopyableText
        key={index + block.value}
        label={block.label}
        text={block.value}
        copyLabel={block.copyLabel}
      />
    );
  });
}

export function NewMcpToken({
  token,
  label,
}: {
  token: string;
  label: string;
}) {
  const [status, setStatus] = useState('');
  const [copyFailed, setCopyFailed] = useState(false);
  const { keyFile } = mcpConnection();
  const saveCommand = getTokenSaveCommand({ token, tokenFile: keyFile });
  return (
    <div className="form-stack mcp-new-token">
      <label>
        {label}
        <input readOnly value={token} onFocus={(e) => e.target.select()} />
      </label>
      <button
        type="button"
        className="secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(saveCommand);
            setCopyFailed(false);
            setStatus('Command copied. Paste and run it in Terminal.');
          } catch {
            setCopyFailed(true);
            setStatus('Copy failed. Select and copy the save command below.');
          }
        }}
      >
        <Copy size={14} aria-hidden="true" /> Copy save command
      </button>
      <button
        type="button"
        className="secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(
              `Authorization: Bearer ${token}`,
            );
            setCopyFailed(false);
            setStatus('Copied. Paste into your token file.');
          } catch {
            setCopyFailed(false);
            setStatus('Copy failed. Save the line below in your token file.');
          }
        }}
      >
        <Copy size={14} aria-hidden="true" /> Copy token for file
      </button>
      <span role="status">{status}</span>
      {copyFailed ? (
        <textarea
          aria-label="Save token command"
          readOnly
          value={saveCommand}
          onFocus={(e) => e.target.select()}
        />
      ) : (
        status.startsWith('Copy failed') && (
          <input
            aria-label="Token file contents"
            readOnly
            value={`Authorization: Bearer ${token}`}
            onFocus={(e) => e.target.select()}
          />
        )
      )}
    </div>
  );
}

function CopyableText({
  text,
  label,
  copyLabel,
}: {
  text: string;
  label: string;
  copyLabel: string;
}) {
  const [status, setStatus] = useState('');
  return (
    <div className="mcp-copy-block">
      <div className="mcp-copy-toolbar">
        <strong>{label}</strong>
        <button
          type="button"
          className="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setStatus('Copied');
            } catch {
              setStatus('Select the text below and copy it manually.');
            }
          }}
        >
          <Copy size={14} aria-hidden="true" /> {copyLabel}
        </button>
      </div>
      <pre className="mcp-config">
        <code>{text}</code>
      </pre>
      <span role="status">{status}</span>
    </div>
  );
}
