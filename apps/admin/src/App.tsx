import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Sprout } from 'lucide-react';
import { api } from './api';
import { signOut } from './auth';
import { AuthForm } from './Account';
import { OAuthPage } from './OAuthConsent';
import { GlobalAdmin } from './GlobalAdmin';
import { ErrorState, Loading, Panel } from './ui';

export function App() {
  return location.pathname.startsWith('/oauth/') ? <OAuthPage /> : <AdminApp />;
}

function AdminApp() {
  const me = useQuery(api.me.queryOptions());
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<unknown>(null);
  const params = new URLSearchParams(location.search);
  const accountLink = params.has('token') || params.has('error');

  async function handleSignOut() {
    setSigningOut(true);
    setSignOutError(null);
    try {
      await signOut();
    } catch (error) {
      setSignOutError(error);
      setSigningOut(false);
    }
  }

  return (
    <>
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <header className="site-header">
        <a className="brand" href="/" aria-label="Market Delivered home">
          <Sprout size={25} aria-hidden="true" />
          Market Delivered
        </a>
        {me.data && (
          <div className="account-controls">
            <span>{me.data.name}</span>
            <button
              className="secondary"
              disabled={signingOut}
              onClick={() => void handleSignOut()}
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        )}
      </header>
      <main id="content">
        {signOutError != null && <ErrorState error={signOutError} />}
        {me.isPending ? (
          <Loading />
        ) : me.isError ? (
          <ErrorState error={me.error} />
        ) : accountLink || !me.data ? (
          <div className="account-page">
            <AuthForm />
          </div>
        ) : !me.data.globalAdmin ? (
          <div className="account-page">
            <Panel title="Global administrator access required">
              <p>
                This dashboard is for Market Delivered global administrators.
                Sign out to use a different account.
              </p>
            </Panel>
          </div>
        ) : (
          <GlobalAdmin />
        )}
      </main>
      <footer>
        <span>Market Delivered</span>
        <span>Platform administration</span>
      </footer>
    </>
  );
}
