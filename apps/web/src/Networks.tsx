import { SupportSettings, LocationSettings } from './AppSettings';
import { BrandingAdmin } from './Branding';
import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, rpc } from './api';
import { ErrorState, Loading, Panel, useAction } from './ui';

const field = (form: HTMLFormElement, key: string) =>
  String(new FormData(form).get(key) || '');
export function switchNetwork(slug: string) {
  const url = new URL(location.href);
  url.search = '';
  url.searchParams.set('network', slug);
  location.assign(url.href);
}
export function NetworkAdmin() {
  const current = useQuery(api.networks.current.queryOptions());
  const members = useQuery(api.networks.members.queryOptions());
  const { act, busy, notice } = useAction();
  if (current.isPending) return <Loading />;
  if (current.error) return <ErrorState error={current.error} />;
  const n = current.data!;
  return (
    <div className="configure-layout">
      {notice}
      <div className="configure-columns">
        <div className="configure-column">
          <Panel title="App settings">
            <p>Configure {n.name} and manage who can administer the app.</p>
            <form
              key={`${n.id}-${n.name}-${n.emailFrom}-${n.emailReplyTo}`}
              className="form-stack"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                void act(async () => {
                  const key = field(form, 'emailKey');
                  await rpc.networks.update.mutate({
                    name: field(form, 'name'),
                    emailFrom: field(form, 'emailFrom') || null,
                    emailReplyTo: field(form, 'emailReplyTo') || null,
                    ...(key ? { emailKey: key } : {}),
                    ...(new FormData(form).has('clearKey')
                      ? { emailKey: null }
                      : {}),
                  });
                  (
                    form.elements.namedItem('emailKey') as HTMLInputElement
                  ).value = '';
                });
              }}
            >
              <label>
                App name
                <input
                  name="name"
                  defaultValue={n.name}
                  required
                  minLength={2}
                />
              </label>
              <label>
                Sender email override
                <input
                  type="email"
                  name="emailFrom"
                  defaultValue={n.emailFrom || ''}
                  placeholder="Use platform sender"
                />
              </label>
              <label>
                Email reply-to address
                <input
                  type="email"
                  name="emailReplyTo"
                  defaultValue={n.emailReplyTo || ''}
                  placeholder="Use support email, if configured"
                />
              </label>
              <p className="muted">
                Invitations and account emails use the app name as their sender
                name and in their subject. Replies use this address, or the
                support email when blank.
              </p>
              <label>
                Resend API key override
                <input
                  type="password"
                  name="emailKey"
                  autoComplete="new-password"
                  placeholder={
                    n.hasEmailKey
                      ? 'Override configured; leave blank to keep'
                      : 'Use platform key'
                  }
                />
              </label>
              <label>
                <input type="checkbox" name="clearKey" /> Clear stored key and
                use the platform key
              </label>
              <p className="muted">
                Blank sender uses the platform default. Keys are encrypted and
                never displayed. These overrides apply to invitations and
                account emails sent from this app. The sender must be verified
                with the selected email provider account.
              </p>
              <button disabled={busy}>Save app settings</button>
            </form>
          </Panel>
          <SupportSettings />
          <Panel title="Administrators">
            <p>
              Make an existing member an administrator. Use People to invite a
              new member or administrator.
            </p>
            <form
              className="form-stack"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                void act(() =>
                  rpc.networks.setMember.mutate({
                    email: field(form, 'email'),
                    role: field(form, 'role') as 'member' | 'network_admin',
                  }),
                );
              }}
            >
              <label>
                Member email
                <input name="email" type="email" required />
              </label>
              <label>
                App role
                <select name="role">
                  <option value="network_admin">Administrator</option>
                  <option value="member">Member</option>
                </select>
              </label>
              <button disabled={busy}>Set app role</button>
            </form>
            {members.error && <ErrorState error={members.error} />}
            {members.data?.map((m) => (
              <div className="list-row" key={m.userId}>
                <span>
                  {m.name} · {m.email}
                </span>
                <strong>
                  {m.role === 'network_admin' ? 'Administrator' : 'Member'}
                </strong>
              </div>
            ))}
          </Panel>
        </div>
        <div className="configure-column">
          <BrandingAdmin />
          <LocationSettings />
        </div>
      </div>
    </div>
  );
}
export function GlobalAdmin() {
  const networks = useQuery(api.networks.list.queryOptions());
  const tokens = useQuery(api.networks.tokens.queryOptions());
  const { act, busy, notice } = useAction();
  const [token, setToken] = useState('');
  const create = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    void act(async () => {
      await rpc.networks.create.mutate({
        name: field(form, 'name'),
        slug: field(form, 'slug'),
      });
      form.reset();
    }, 'Network created. Open it to assign administrators and set up markets.');
  };
  return (
    <div className="workspace">
      <div className="page-heading">
        <h1>Global administration</h1>
        <p>
          global_admin has every permission across all networks. network_admin
          applies only within its assigned network.
        </p>
      </div>
      {notice}
      <div className="page-grid">
        <Panel title="Delivery networks">
          {networks.error && <ErrorState error={networks.error} />}
          {networks.data?.map((n) => (
            <div className="list-row" key={n.id}>
              <span>
                {n.name} · {n.slug}
              </span>
              <button
                className="secondary"
                onClick={() => switchNetwork(n.slug)}
              >
                Open network
              </button>
            </div>
          ))}
          <form className="form-stack" onSubmit={create}>
            <label>
              Network name
              <input name="name" required minLength={2} />
            </label>
            <label>
              Network slug
              <input
                name="slug"
                required
                minLength={2}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                placeholder="sonoma"
              />
            </label>
            <button disabled={busy}>Create network</button>
          </form>
          <p>
            Open a network, then use Operations → Configure to assign
            administrators to existing accounts, or People to invite a new
            network administrator. Each network starts with its own empty vendor
            catalog and markets.
          </p>
        </Panel>
        <Panel title="Global MCP access">
          <p>
            Global tokens can create and manage every network. Network tokens
            created in Operations remain restricted to that network, even for
            global administrators.
          </p>
          <p>
            Endpoint:{' '}
            <code>
              {
                new URL(
                  '/mcp',
                  new URL(import.meta.env.VITE_API_URL || '/', location.origin),
                ).href
              }
            </code>
            . To work in another network, append <code>?network=its-slug</code>.
          </p>
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              void act(async () =>
                setToken(
                  (
                    await rpc.networks.createToken.mutate({
                      name: field(form, 'name'),
                    })
                  ).token,
                ),
              );
            }}
          >
            <label>
              Global token name
              <input name="name" required minLength={2} />
            </label>
            <button disabled={busy}>Create global token</button>
          </form>
          {token && (
            <label>
              Global token (shown once)
              <input
                readOnly
                value={token}
                onFocus={(e) => e.target.select()}
              />
            </label>
          )}
          {tokens.error && <ErrorState error={tokens.error} />}
          {tokens.data?.map((t) => (
            <div className="list-row" key={t.id}>
              <span>
                {t.name} · …{t.lastFour} {t.revokedAt && '· Revoked'}
              </span>
              {!t.revokedAt && (
                <button
                  disabled={busy}
                  className="secondary"
                  onClick={() =>
                    void act(() =>
                      rpc.networks.revokeToken.mutate({ id: t.id }),
                    )
                  }
                >
                  Revoke global token
                </button>
              )}
            </div>
          ))}
        </Panel>
      </div>
    </div>
  );
}
