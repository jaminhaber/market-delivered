import { useState } from 'react';
import { AuthForm } from './Account';
import { oauthClient, oauthBasePath, oauthPagePath } from './auth';
import { McpSetupInstructions } from './McpSetupInstructions';
import { useQuery } from '@tanstack/react-query';
import { ErrorState, Loading, Panel, useAction } from './ui';

async function oauthRequest(path: string, body?: unknown) {
  const response = await fetch(oauthBasePath + '/oauth2/' + path, {
    credentials: 'same-origin',
    ...(body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
  });
  if (!response.ok)
    throw new Error(
      'This connection request is invalid or expired. Start again from your assistant.',
    );
  return response.json();
}

function OAuthConsent({ networkName }: { networkName?: string }) {
  const oauthQuery = location.search.slice(1);
  const params = new URLSearchParams(location.search);
  const client = useQuery({
    queryKey: ['oauth-client', oauthQuery],
    queryFn: () =>
      oauthRequest(
        'public-client?' +
          new URLSearchParams({
            client_id: params.get('client_id') || '',
            oauth_query: oauthQuery,
          }),
      ),
    retry: false,
  });
  const { act, busy, notice } = useAction();
  const decide = (accept: boolean) =>
    void act(async () => {
      const result = await oauthRequest('consent', {
        accept,
        oauth_query: oauthQuery,
      });
      if (typeof result.url !== 'string')
        throw new Error('Unable to complete the connection.');
      location.assign(result.url);
    }, '');
  return (
    <div className="account-page">
      <Panel title="Connect your assistant">
        {notice}
        {client.isPending ? (
          <Loading />
        ) : client.isError ? (
          <ErrorState error={client.error} />
        ) : (
          <>
            <p>
              <strong>
                {client.data.client_name ||
                  client.data.name ||
                  'Your AI assistant'}
              </strong>{' '}
              is asking to act as you in {networkName ?? 'Market Delivered'}.
            </p>
            <p>
              {networkName ? (
                `This assistant can manage only ${networkName}. It cannot manage other networks or perform platform administration. Every operation uses your current permissions in ${networkName}.`
              ) : (
                <>
                  This assistant can act across the networks you administer, and
                  can perform platform administration if you have that
                  permission. Every operation uses your current permissions. New
                  permissions you receive also apply to this connection.
                </>
              )}
            </p>
            <p>You can disconnect it at any time from Assistant connections.</p>
            <div className="inline-actions">
              <button disabled={busy} onClick={() => decide(true)}>
                Allow access as me
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => decide(false)}
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}

export function OAuthConnections() {
  const connections = useQuery({
    queryKey: ['oauth-connections', oauthBasePath],
    queryFn: async () => {
      const response = await fetch(oauthBasePath + '/connections');
      if (!response.ok) throw new Error('Unable to load connected assistants.');
      return response.json() as Promise<{
        connections: { id: string; name: string | null }[];
      }>;
    },
  });
  const { act, busy, notice } = useAction();
  return (
    <div>
      {notice}
      {connections.isPending && <Loading />}
      {connections.error && <ErrorState error={connections.error} />}
      {!!connections.data?.connections.length && (
        <details>
          <summary>
            Connected assistants ({connections.data.connections.length})
          </summary>
          {connections.data.connections.map((item) => (
            <div className="list-row" key={item.id}>
              <span>{item.name || 'AI assistant'}</span>
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    const response = await fetch(
                      oauthBasePath + '/connections',
                      {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: item.id }),
                      },
                    );
                    if (!response.ok)
                      throw new Error('Unable to disconnect assistant.');
                    await connections.refetch();
                  }, 'Assistant disconnected. Its access has been revoked.')
                }
              >
                Disconnect {item.name || 'AI assistant'}
              </button>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

export function OAuthPage() {
  const identity = useQuery({
    queryKey: ['oauth-identity', oauthBasePath],
    queryFn: async () => {
      const response = await fetch(oauthBasePath + '/identity');
      if (response.status === 401) return null;
      if (!response.ok) throw new Error('Unable to load your account.');
      return response.json() as Promise<{
        name: string;
        email: string;
        globalAdmin: boolean;
        connection: {
          resource: string;
          network?: { id: string; name: string; slug: string };
        };
      }>;
    },
    retry: false,
  });
  const [error, setError] = useState<unknown>(null);
  return (
    <main className="account-page">
      <Panel title="Market Delivered">
        {error != null && <ErrorState error={error} />}
        {identity.isPending ? (
          <Loading />
        ) : identity.isError ? (
          <ErrorState error={identity.error} />
        ) : !identity.data || location.pathname === oauthPagePath('login') ? (
          <AuthForm oauth />
        ) : location.pathname === oauthPagePath('authorize') ? (
          <OAuthConsent networkName={identity.data.connection.network?.name} />
        ) : (
          <>
            <h1>Assistant connections</h1>
            <p>
              Signed in as {identity.data.email}. Assistants use your current
              permissions{' '}
              {identity.data.connection.network
                ? `only in ${identity.data.connection.network.name}`
                : 'across Market Delivered'}
              .
            </p>
            <McpSetupInstructions
              serverUrl={identity.data.connection.resource}
              displayName={identity.data.connection.network?.name}
              serverName={identity.data.connection.network?.slug}
            />
            <OAuthConnections />
            <button
              className="secondary"
              onClick={() =>
                void oauthClient
                  .signOut()
                  .then((result) => {
                    if (result.error) throw new Error(result.error.message);
                    location.assign(oauthPagePath('connect'));
                  })
                  .catch(setError)
              }
            >
              Sign out
            </button>
          </>
        )}
      </Panel>
    </main>
  );
}
