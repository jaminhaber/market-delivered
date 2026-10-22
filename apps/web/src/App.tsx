import { useState } from 'react';
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
export function App() {
  const me = useQuery(api.me.queryOptions());
  const [page, setPage] = useState(
    new URLSearchParams(location.search).has('invite') ||
      new URLSearchParams(location.search).has('token')
      ? 'Account'
      : 'Market',
  );
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
        <div className="account-controls">
          {me.data ? (
            <>
              <span>{me.data.name}</span>
              <button
                className="secondary"
                onClick={() =>
                  void authClient.signOut().then(() => {
                    queryClient.clear();
                    setPage('Market');
                  })
                }
              >
                Sign out
              </button>
            </>
          ) : (
            <button className="secondary" onClick={() => setPage('Account')}>
              Sign in
            </button>
          )}
        </div>
      </header>
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
      <main id="content">
        {me.isPending ? (
          <Loading />
        ) : me.isError ? (
          <ErrorState error={me.error} />
        ) : page === 'Market' ? (
          <Shop
            signedIn={!!me.data}
            onAccount={() => setPage('Account')}
            onOrders={() => setPage('Orders')}
          />
        ) : page === 'Account' ? (
          <div className="account-page">
            <AuthForm onDone={() => setPage('Profile')} />
          </div>
        ) : !me.data ? (
          <AuthForm onDone={() => setPage('Profile')} />
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
