import { useState } from 'react';
import { AuthForm } from './Account';
import { oauthClient } from './auth';
import { McpSetupInstructions } from './McpSetupInstructions';
import { useQuery } from '@tanstack/react-query';
import { ErrorState, Loading, Panel, useAction } from './ui';

async function oauthRequest(path: string, body?: unknown) {
  const response = await fetch('/oauth/auth/oauth2/' + path, {
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

function OAuthConsent() {
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
              is asking to act as you in Market Delivered.
            </p>
            <p>
              This assistant can act across the networks you administer, and can
              perform platform administration if you have that permission. Every
              operation uses your current permissions. New permissions you
              receive also apply to this connection.
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
    queryKey: ['oauth-connections'],
    queryFn: async () => {
      const response = await fetch('/oauth/auth/connections');
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
                    const response = await fetch('/oauth/auth/connections', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ id: item.id }),
                    });
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
    queryKey: ['oauth-identity'],
    queryFn: async () => {
      const response = await fetch('/oauth/auth/identity');
      if (response.status === 401) return null;
      if (!response.ok) throw new Error('Unable to load your account.');
      return response.json() as Promise<{
        name: string;
        email: string;
        globalAdmin: boolean;
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
        ) : !identity.data || location.pathname === '/oauth/login' ? (
          <AuthForm oauth />
        ) : location.pathname === '/oauth/authorize' ? (
          <OAuthConsent />
        ) : (
          <>
            <h1>Assistant connections</h1>
            <p>
              Signed in as {identity.data.email}. Assistants use your current
              permissions across Market Delivered.
            </p>
            <McpSetupInstructions />
            <OAuthConnections />
            <button
              className="secondary"
              onClick={() =>
                void oauthClient
                  .signOut()
                  .then((result) => {
                    if (result.error) throw new Error(result.error.message);
                    location.assign('/oauth/connect');
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
