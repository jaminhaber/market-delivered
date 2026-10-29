import { useState } from 'react';
import { McpSetupInstructions } from './McpSetupInstructions';
import { Panel } from './ui';
import { NetworkStatistics } from './NetworkStatistics';

export function GlobalAdmin() {
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
          Assistant connection
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
        <Panel title="Connect your assistant">
          <p>Your assistant acts with your current account permissions.</p>
          <McpSetupInstructions />
          <a href="/oauth/connect">Manage assistant connections</a>
        </Panel>
      )}
    </div>
  );
}
