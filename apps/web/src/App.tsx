import { useQuery } from '@tanstack/react-query';
import { Sprout } from 'lucide-react';
import { api, queryClient } from './api';
import { authClient } from './auth';
import { AuthForm, Profile } from './Account';
import { Shop } from './Shop';
import { Orders } from './Orders';
import { Driver } from './Driver';
import { Admin } from './Admin';
import { ErrorState, Loading } from './ui';
import { useUrlState } from './navigation';
export function App() {
  const me = useQuery(api.me.queryOptions());
  const tabs = [
    'Market',
    ...(me.data
      ? [
          'Orders',
          'Profile',
          ...(me.data.driver?.status === 'approved' ? ['Driver'] : []),
          ...(me.data.admin ? ['Operations'] : []),
        ]
      : []),
  ];
  const [urlPage, setPage] = useUrlState(
    'page',
    [...tabs, 'Account'],
    'Market',
  );
  const params = new URLSearchParams(location.search);
  const page =
    params.has('invite') || params.has('token') ? 'Account' : urlPage;
  return (
    <>
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <header className="site-header">
        <a className="brand" href="/" aria-label="Market Delivered home">
          <span className="brand-icon">
            <Sprout size={24} />
          </span>
          market<span className="brand-light">delivered</span>
          <span className="brand-dot">.</span>
        </a>
        {me.data && (
          <div className="account-controls">
            <span>{me.data.name}</span>
            <button
              className="secondary"
              onClick={() =>
                void authClient.signOut().then(() => {
                  queryClient.clear();
                  setPage('Market', true);
                })
              }
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
        {me.isPending ? (
          <Loading />
        ) : me.isError ? (
          <ErrorState error={me.error} />
        ) : !me.data || page === 'Account' ? (
          <div className="account-page">
            <AuthForm onDone={() => setPage('Profile', true)} />
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
        ) : page === 'Operations' && me.data.admin ? (
          <Admin />
        ) : null}
      </main>
      <footer>
        <a className="footer-brand" href="/">
          market delivered.
        </a>
        <span>One market trip. A neighborhood of good food.</span>
        <span>Made for local.</span>
      </footer>
    </>
  );
}
