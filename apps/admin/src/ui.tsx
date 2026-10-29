import { useState, type ReactNode } from 'react';
import { queryClient } from './api';
export function useAction() {
  const [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function act(fn: () => Promise<unknown>, success = 'Saved') {
    setError('');
    setMessage('');
    setBusy(true);
    try {
      await fn();
      await queryClient.invalidateQueries();
      setMessage(success);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      return false;
    } finally {
      setBusy(false);
    }
  }
  return {
    act,
    busy,
    notice: (
      <>
        <div role="alert" className={error ? 'notice error' : 'empty-notice'}>
          {error}
        </div>
        <div
          role="status"
          className={message ? 'notice success' : 'empty-notice'}
        >
          {message}
        </div>
      </>
    ),
  };
}
export function Panel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
export function Loading() {
  return (
    <div role="status" className="state">
      Loading…
    </div>
  );
}
export function ErrorState({ error }: { error: unknown }) {
  return (
    <p role="alert" className="notice error">
      {error instanceof Error
        ? error.message
        : 'Unable to load. Please try again.'}
    </p>
  );
}
