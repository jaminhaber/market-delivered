import { SupportContact } from './AppSettings';
import { useNetworkBranding } from './Branding';
import { GlobalAdmin } from './Networks';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Sprout } from 'lucide-react';
import { api } from './api';
import { signOut } from './auth';
import { AuthForm, Profile } from './Account';
import { Shop } from './Shop';
import { Orders } from './Orders';
import { Driver } from './Driver';
import { Admin } from './Admin';
import { ErrorState, Loading } from './ui';
import { useUrlState } from './navigation';
export function App() {
  const networkBrand = useNetworkBranding();
  const headerDisplay = networkBrand?.branding.headerDisplay || 'logo';
  const headerLogo =
    headerDisplay !== 'text' ? networkBrand?.branding.logoUrl : null;
  const selectedNetwork = new URLSearchParams(location.search).get('network');
  const homeHref = selectedNetwork
    ? `/?network=${encodeURIComponent(selectedNetwork)}`
    : '/';
  const me = useQuery(api.me.queryOptions());
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<unknown>(null);
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
  const tabs = [
    ...(me.data?.globalAdmin && !me.data.network ? [] : ['Market']),
    ...(me.data
      ? [
          ...(me.data.network ? ['Orders', 'Profile'] : []),
          ...(me.data.driver?.status === 'approved' ? ['Driver'] : []),
          ...(me.data.admin && me.data.network ? ['Operations'] : []),
          ...(me.data.globalAdmin ? ['Global administration'] : []),
        ]
      : []),
  ];
  const [urlPage, setPage] = useUrlState(
    'page',
    [...tabs, 'Account'],
    me.data?.globalAdmin && !me.data.network
      ? 'Global administration'
      : 'Market',
  );
  const params = new URLSearchParams(location.search);
  const page =
    params.has('invite') ||
    params.has('token') ||
    params.has('error') ||
    params.has('reset')
      ? 'Account'
      : urlPage;
  return (
    <>
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <header className="site-header">
        <a
          className="brand"
          href={homeHref}
          aria-label={
            networkBrand ? `${networkBrand.name} home` : 'Market Delivered home'
          }
        >
          {networkBrand ? (
            <span className="network-identity">
              {headerLogo && (
                <img
                  className="network-logo"
                  src={headerLogo}
                  alt={headerDisplay === 'logo-text' ? '' : networkBrand.name}
                  referrerPolicy="no-referrer"
                />
              )}
              {(!headerLogo || headerDisplay === 'logo-text') && (
                <span>{networkBrand.name}</span>
              )}
            </span>
          ) : (
            <>
              <span className="brand-icon">
                <Sprout size={24} />
              </span>
              market<span className="brand-light">delivered</span>
              <span className="brand-dot">.</span>
            </>
          )}
        </a>
        {me.data && (
          <div className="account-controls">
            <span>
              {me.data.name} ·{' '}
              {me.data.globalAdmin
                ? 'Global administrator'
                : me.data.networkAdmin
                  ? 'Administrator'
                  : 'Member'}
            </span>
            <button
              className="secondary"
              disabled={signingOut}
              onClick={() => void handleSignOut()}
            >
              Sign out
            </button>
          </div>
        )}
      </header>
      {me.data && (
        <nav className="main-nav" aria-label="Main navigation">
          {tabs.map((tab) => (
            <button
              key={tab}
              className={page === tab ? 'selected' : ''}
              aria-current={page === tab ? 'page' : undefined}
              onClick={() => setPage(tab)}
            >
              {tab}
            </button>
          ))}
        </nav>
      )}
      <main id="content">
        {signOutError != null && <ErrorState error={signOutError} />}
        {me.isPending ? (
          <Loading />
        ) : me.isError && me.error.data?.code !== 'NOT_FOUND' ? (
          <ErrorState error={me.error} />
        ) : !me.data || page === 'Account' ? (
          <div className="account-page">
            <AuthForm
              currentUser={me.data}
              onDone={() => setPage('Profile', true)}
            />
            <SupportContact />
          </div>
        ) : page === 'Market' ? (
          <Shop
            signedIn={!!me.data}
            onAccount={() => setPage('Account')}
            onOrders={() => setPage('Orders')}
          />
        ) : page === 'Profile' ? (
          <div className="workspace">
            <div className="page-heading">
              <h1>Your profile</h1>
            </div>
            <Profile key={me.data.id} />
          </div>
        ) : page === 'Orders' ? (
          <Orders />
        ) : page === 'Driver' ? (
          <Driver />
        ) : page === 'Global administration' && me.data.globalAdmin ? (
          <GlobalAdmin />
        ) : page === 'Operations' && me.data.admin ? (
          <Admin />
        ) : null}
      </main>
      <footer>
        <a className="footer-brand" href={homeHref}>
          {networkBrand?.name || 'market delivered.'}
        </a>
        <span>One market trip. A neighborhood of good food.</span>
        <span>Made for local.</span>
        <SupportContact />
      </footer>
    </>
  );
}
