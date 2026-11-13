import { useRef, useState, type ReactNode } from 'react';
import { api, queryClient } from './api';
export const money = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    cents / 100,
  );
export const when = (date: string | Date, timezone?: string) =>
  new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(new Date(date));
export const label = (status: string) => status.replaceAll('_', ' ');
export function useAction() {
  const [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const pending = useRef(false);
  async function act(fn: () => Promise<unknown>, success = 'Saved') {
    if (pending.current) return false;
    pending.current = true;
    setError('');
    setMessage('');
    setBusy(true);
    try {
      await fn();
      await queryClient.invalidateQueries({ queryKey: api.driver.pathKey() });
      setMessage(success);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      return false;
    } finally {
      pending.current = false;
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
      Gathering your market details…
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
