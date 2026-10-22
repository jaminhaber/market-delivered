import { useEffect, useRef, useState } from 'react';
import { rpc } from './api';

type Suggestion = { placeId: string; label: string };
type Address = Awaited<ReturnType<typeof rpc.addresses.resolve.mutate>>;
export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
}: {
  value: string;
  onChange: (value: string) => void;
  onSelect: (address: Address) => void;
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [error, setError] = useState('');
  const [active, setActive] = useState(-1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const token = useRef(crypto.randomUUID());
  const generation = useRef(0);
  const selection = useRef(0);
  useEffect(
    () => () => {
      selection.current++;
    },
    [],
  );
  useEffect(() => {
    const current = ++generation.current;
    if (search.trim().length < 3 || !open) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    const timer = setTimeout(() => {
      setLoading(true);
      void rpc.addresses.suggest
        .mutate({ input: search, sessionToken: token.current })
        .then((rows) => {
          if (generation.current !== current) return;
          setSuggestions(rows);
          setActive(-1);
          setError('');
        })
        .catch((problem: unknown) => {
          if (generation.current !== current) return;
          setSuggestions([]);
          setError(
            problem instanceof Error
              ? problem.message
              : 'Address suggestions are unavailable. Enter your address manually.',
          );
        })
        .finally(() => {
          if (generation.current === current) setLoading(false);
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      generation.current++;
    };
  }, [search, open]);
  async function select(suggestion: Suggestion) {
    const current = ++selection.current;
    setOpen(false);
    setSuggestions([]);
    setLoading(true);
    setError('');
    const sessionToken = token.current;
    token.current = crypto.randomUUID();
    try {
      const address = await rpc.addresses.resolve.mutate({
        placeId: suggestion.placeId,
        sessionToken,
      });
      if (selection.current !== current) return;
      onSelect(address);
      setSearch('');
    } catch (problem) {
      if (selection.current === current)
        setError(
          problem instanceof Error
            ? problem.message
            : 'Could not load this address. Enter it manually.',
        );
    } finally {
      if (selection.current === current) setLoading(false);
    }
  }
  return (
    <div className="address-autocomplete">
      <label htmlFor="street-address">Street address</label>
      <input
        id="street-address"
        required
        minLength={3}
        maxLength={200}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && suggestions.length > 0}
        aria-controls="address-suggestions"
        aria-activedescendant={
          active >= 0 && open ? `address-option-${active}` : undefined
        }
        aria-describedby="address-suggestions-status"
        value={value}
        onChange={(event) => {
          generation.current++;
          selection.current++;
          onChange(event.target.value);
          setSearch(event.target.value);
          setOpen(true);
          setSuggestions([]);
          setActive(-1);
          setError('');
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            generation.current++;
            setOpen(false);
            setSuggestions([]);
          }
          if (
            open &&
            suggestions.length &&
            (event.key === 'ArrowDown' || event.key === 'ArrowUp')
          ) {
            event.preventDefault();
            setActive((index) =>
              index < 0
                ? event.key === 'ArrowDown'
                  ? 0
                  : suggestions.length - 1
                : (index +
                    (event.key === 'ArrowDown' ? 1 : suggestions.length - 1)) %
                  suggestions.length,
            );
          }
          if (
            event.key === 'Enter' &&
            open &&
            active >= 0 &&
            suggestions[active]
          ) {
            event.preventDefault();
            void select(suggestions[active]);
          }
        }}
        onBlur={(event) => {
          if (
            !event.currentTarget.parentElement?.contains(event.relatedTarget)
          ) {
            setOpen(false);
          }
        }}
      />
      {open && suggestions.length > 0 && (
        <div className="address-suggestions">
          <ul
            id="address-suggestions"
            role="listbox"
            aria-label="Suggested addresses"
          >
            {suggestions.map((suggestion, index) => (
              <li
                key={suggestion.placeId}
                id={`address-option-${index}`}
                role="option"
                aria-selected={active === index}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void select(suggestion)}
              >
                {suggestion.label}
              </li>
            ))}
          </ul>
        </div>
      )}
      <small>Address suggestions by Google Maps</small>
      <small id="address-suggestions-status" role="status">
        {error ||
          (loading
            ? 'Finding your address…'
            : 'Start typing to find an address. You can also enter it manually.')}
      </small>
    </div>
  );
}
