import { useSyncExternalStore } from 'react';

const navigationEvent = 'app-navigation';

function subscribe(onChange: () => void) {
  window.addEventListener('popstate', onChange);
  window.addEventListener(navigationEvent, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(navigationEvent, onChange);
  };
}

export function updateSearch(
  values: Record<string, string | null>,
  replace = false,
) {
  const url = new URL(location.href);
  for (const [key, value] of Object.entries(values)) {
    if (value === null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  if (url.href === location.href) return;
  if (replace) history.replaceState(history.state, '', url);
  else history.pushState(null, '', url);
  window.dispatchEvent(new Event(navigationEvent));
}

export function useUrlState(
  key: string,
  choices: readonly string[],
  fallback: string,
) {
  const search = useSyncExternalStore(subscribe, () => location.search);
  const value = new URLSearchParams(search).get(key) ?? fallback;
  return [
    choices.find(
      (choice) => choice.toLowerCase().replaceAll(' ', '-') === value,
    ) ?? fallback,
    (next: string, replace = false) => {
      updateSearch(
        {
          [key]: next.toLowerCase().replaceAll(' ', '-'),
          ...(key === 'page'
            ? {
                invite: null,
                token: null,
                reset: null,
                ...(next !== 'Operations' ? { tab: null } : {}),
              }
            : {}),
        },
        replace,
      );
    },
  ] as const;
}
