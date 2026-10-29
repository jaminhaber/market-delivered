import { useId, useState } from 'react';
import { Copy } from 'lucide-react';

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

function mcpConnection() {
  const endpoint = new URL('/admin/mcp', window.location.origin).href;
  const connection = 'global';
  const keyFile = `.config/market-delivered/dmarket-${connection}.headers`;
  return { endpoint, connection, keyFile };
}

export function McpSetupInstructions() {
  const [client, setClient] = useState<'codex' | 'claude'>('codex');
  const commandId = useId();
  const { endpoint, connection, keyFile } = mcpConnection();
  const serverName = `dmarket-${connection}`;
  const register =
    client === 'codex'
      ? `codex mcp add ${serverName}`
      : `claude mcp add --scope user --transport stdio ${serverName}`;
  const command = `chmod 600 "$HOME/${keyFile}" &&
${register} -- npx -y mcp-remote ${shellQuote(endpoint)} --transport http-only --header-file "$HOME/${keyFile}"`;

  return (
    <div className="mcp-setup">
      <p>
        Connect Market Delivered to your AI assistant on Mac or Linux. You’ll
        need Node.js and your assistant’s command-line app installed.
      </p>
      <h3>1. Save your token</h3>
      <p>
        Create a global token below. Click <strong>Copy save command</strong>{' '}
        beside your new token, then paste and run it in Terminal. It creates{' '}
        <code className="mcp-endpoint">~/{keyFile}</code> with the complete
        authorization line.
      </p>
      <h3>2. Run the setup command</h3>
      <p>Choose your assistant, then copy and run the command in Terminal.</p>
      <div className="mcp-client-tabs" role="group" aria-label="AI assistant">
        {(
          [
            ['codex', 'Codex (OpenAI)'],
            ['claude', 'Claude Code (Anthropic)'],
          ] as const
        ).map(([id, name]) => (
          <button
            key={id}
            type="button"
            aria-pressed={client === id}
            aria-controls={commandId}
            onClick={() => setClient(id)}
          >
            {name}
          </button>
        ))}
      </div>
      <div id={commandId}>
        <CopyableText key={client} label="Command" text={command} />
      </div>
      <p>
        Restart your assistant, then ask: “Use Market Delivered to list delivery
        networks.”
      </p>
      <details>
        <summary>Access and connection notes</summary>
        <p>
          This token grants global administrator access. Keep the file private.
          Tokens expire after 90 days; replace the token in the file when
          needed.
        </p>
        <p>
          These commands use mcp-remote to read credentials from your file.
          ChatGPT in a browser cannot use this local setup.
        </p>
      </details>
    </div>
  );
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
  const saveCommand = `(umask 077 && mkdir -p "$HOME/.config/market-delivered" && chmod 700 "$HOME/.config/market-delivered" && touch "$HOME/${keyFile}" && chmod 600 "$HOME/${keyFile}" && printf '%s\\n' ${shellQuote(`Authorization: Bearer ${token}`)} > "$HOME/${keyFile}")`;
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

function CopyableText({ text, label }: { text: string; label: string }) {
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
          <Copy size={14} aria-hidden="true" /> Copy {label.toLowerCase()}
        </button>
      </div>
      <pre className="mcp-config">
        <code>{text}</code>
      </pre>
      <span role="status">{status}</span>
    </div>
  );
}
