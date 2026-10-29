import { type ProviderId } from '@market/mcp-instructions';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { McpSetupInstructions, NewMcpToken } from './McpSetupInstructions';
import { api, rpc } from './api';
import { ErrorState, Loading, Panel, useAction } from './ui';
import { OAuthConnections } from './OAuthConsent';
import { NetworkStatistics } from './NetworkStatistics';

export function GlobalAdmin() {
  const tokens = useQuery(api.tokens.list.queryOptions());
  const { act, busy, notice } = useAction();
  const [provider, setProvider] = useState<ProviderId>('chatgpt');
  const [token, setToken] = useState('');
  const [view, setView] = useState<'access' | 'statistics'>('access');
  return (
    <div className="workspace">
      <div className="page-heading">
        <p className="eyebrow">Market Delivered</p>
        <h1>Global administration</h1>
        <p>Manage platform access and view activity across networks.</p>
      </div>
      <nav className="admin-tabs" aria-label="Global administration">
        <button
          aria-pressed={view === 'access'}
          onClick={() => setView('access')}
        >
          Global MCP access
        </button>
        <button
          aria-pressed={view === 'statistics'}
          onClick={() => setView('statistics')}
        >
          Network statistics
        </button>
      </nav>
      {view === 'statistics' ? (
        <NetworkStatistics />
      ) : (
        <>
          {notice}
          <Panel title="Global MCP access">
            <McpSetupInstructions
              provider={provider}
              onProviderChange={setProvider}
            />
            {provider !== 'token' ? (
              <OAuthConnections />
            ) : (
              <>
                <form
                  className="form-stack"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    const name = String(new FormData(form).get('name') || '');
                    void act(async () => {
                      const result = await rpc.tokens.create.mutate({ name });
                      setToken(result.token);
                      form.reset();
                    }, 'Global token created. Save it now; it will only be shown once.');
                  }}
                >
                  <label>
                    Global token name
                    <input name="name" required minLength={2} maxLength={100} />
                  </label>
                  <button disabled={busy}>Create global token</button>
                </form>
                {token && (
                  <NewMcpToken
                    key={token}
                    token={token}
                    label="Global token (shown once)"
                  />
                )}
                {tokens.isPending && <Loading />}
                {tokens.error && <ErrorState error={tokens.error} />}
                {tokens.data?.length === 0 && (
                  <p className="muted">No global tokens yet.</p>
                )}
                {tokens.data?.map((item) => (
                  <div className="list-row" key={item.id}>
                    <span>
                      {item.name} · …{item.lastFour}{' '}
                      {item.revokedAt && '· Revoked'}
                    </span>
                    {!item.revokedAt && (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          void act(async () => {
                            await rpc.tokens.revoke.mutate({ id: item.id });
                            setToken('');
                          }, 'Global token revoked.')
                        }
                      >
                        Revoke global token
                      </button>
                    )}
                  </div>
                ))}
              </>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
