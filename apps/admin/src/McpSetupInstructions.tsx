import { useState } from 'react';
import { Copy } from 'lucide-react';
import {
  getSetupInstructions,
  listProviders,
  listInterfaces,
  type InstructionBlock,
  type ProviderId,
  type InterfaceId,
} from '@market/mcp-instructions';

export function McpSetupInstructions({
  serverUrl,
  displayName = 'Market Delivered',
  serverName = 'market-delivered',
}: { serverUrl?: string; displayName?: string; serverName?: string } = {}) {
  const [provider, setProvider] = useState<ProviderId>('chatgpt');
  const [surface, setSurface] = useState<InterfaceId>('desktop');
  const setup = getSetupInstructions({
    provider,
    interface: surface,
    serverName,
    displayName,
    serverUrl: serverUrl ?? new URL('/mcp', location.origin).href,
    approvalLabel: 'Allow access as me',
    examplePrompt:
      serverName === 'market-delivered'
        ? 'Use Market Delivered to list the networks I can access.'
        : `Use ${displayName} to list upcoming markets.`,
  });
  return (
    <div className="mcp-setup">
      <div className="mcp-choices">
        <label>
          Which assistant?
          <select
            value={provider}
            onChange={(event) => setProvider(event.target.value as ProviderId)}
          >
            {listProviders().map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          How do you use it?
          <select
            value={surface}
            onChange={(event) => setSurface(event.target.value as InterfaceId)}
          >
            {listInterfaces(provider).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <InstructionBlocks blocks={setup.blocks} />
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
