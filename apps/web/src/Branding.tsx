import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, rpc } from './api';
import { Panel, useAction } from './ui';

type Branding = Awaited<
  ReturnType<typeof rpc.networks.branding.query>
>['branding'];
const BrandingPreviewContext = createContext<{
  preview: Branding | null;
  setPreview: Dispatch<SetStateAction<Branding | null>>;
} | null>(null);
export function BrandingPreviewProvider({ children }: { children: ReactNode }) {
  const [preview, setPreview] = useState<Branding | null>(null);
  return (
    <BrandingPreviewContext.Provider value={{ preview, setPreview }}>
      {children}
    </BrandingPreviewContext.Provider>
  );
}
const defaults = {
  primaryColor: '#2d513c',
  accentColor: '#b68d4c',
  backgroundColor: '#fbfaf6',
  textColor: '#283e32',
};
const fonts = {
  default: ["'DM Sans', sans-serif", "'DM Serif Display', Georgia, serif"],
  modern: ['Arial, Helvetica, sans-serif', 'Arial, Helvetica, sans-serif'],
  editorial: ['Georgia, serif', 'Georgia, serif'],
  rounded: ["'Trebuchet MS', sans-serif", "'Trebuchet MS', sans-serif"],
};
function foreground(hex: string) {
  const channels = hex
    .slice(1)
    .match(/../g)!
    .map((v) => {
      const c = parseInt(v, 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722 >
    0.179
    ? '#111111'
    : '#ffffff';
}
export function useNetworkBranding() {
  const query = useQuery(api.networks.branding.queryOptions());
  const preview = useContext(BrandingPreviewContext)?.preview;
  const branding = preview ?? query.data?.branding;
  useEffect(() => {
    const root = document.documentElement;
    const properties: Record<string, string> = {};
    if (branding) {
      for (const key of Object.keys(defaults) as (keyof typeof defaults)[]) {
        const name = {
          primaryColor: 'primary',
          accentColor: 'accent',
          backgroundColor: 'background',
          textColor: 'text',
        }[key];
        if (branding[key]) properties[`--brand-${name}`] = branding[key]!;
      }
      if (
        Object.keys(defaults).some(
          (key) => branding[key as keyof typeof defaults],
        )
      ) {
        const primary = branding.primaryColor || defaults.primaryColor;
        const background = branding.backgroundColor || defaults.backgroundColor;
        const text = branding.textColor || defaults.textColor;
        properties['--brand-surface'] =
          `color-mix(in srgb, ${background} 96%, ${text})`;
        properties['--brand-surface-muted'] =
          `color-mix(in srgb, ${primary} 5%, ${background})`;
        properties['--brand-highlight'] =
          `color-mix(in srgb, ${primary} 12%, ${background})`;
        properties['--brand-border'] =
          `color-mix(in srgb, ${text} 20%, ${background})`;
        properties['--brand-muted-text'] =
          `color-mix(in srgb, ${text} 75%, ${background})`;
      }
      if (branding.primaryColor)
        properties['--brand-on-primary'] = foreground(branding.primaryColor);
      if (branding.font) {
        properties['--brand-font'] = fonts[branding.font][0]!;
        properties['--brand-heading-font'] = fonts[branding.font][1]!;
      }
    }
    for (const [key, value] of Object.entries(properties))
      root.style.setProperty(key, value);
    return () => {
      for (const key of Object.keys(properties)) root.style.removeProperty(key);
    };
  }, [branding]);
  return query.data && branding ? { ...query.data, branding } : query.data;
}
function normalizedBranding(branding: Branding): Branding {
  return {
    primaryColor: branding.primaryColor || defaults.primaryColor,
    accentColor: branding.accentColor || defaults.accentColor,
    backgroundColor: branding.backgroundColor || defaults.backgroundColor,
    textColor: branding.textColor || defaults.textColor,
    font: branding.font || 'default',
    headerDisplay: branding.headerDisplay || 'logo',
    logoUrl: branding.logoUrl || null,
  };
}
function validLogo(value: string | null | undefined) {
  if (!value) return true;
  if (value.startsWith('data:image/')) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}
export function BrandingAdmin() {
  const current = useQuery(api.networks.current.queryOptions());
  const { act, busy, notice } = useAction();
  if (!current.data) return null;
  const saved = current.data.branding;
  return (
    <Panel title="Branding">
      {notice}
      <BrandingEditor
        key={JSON.stringify(saved)}
        saved={saved}
        busy={busy}
        save={async (draft) => {
          const resetting =
            JSON.stringify(draft) === JSON.stringify(normalizedBranding({}));
          await act(
            () =>
              rpc.networks.update.mutate({
                branding: resetting ? null : draft,
              }),
            resetting ? 'Default branding restored' : 'Branding saved',
          );
        }}
      />
    </Panel>
  );
}
function BrandingEditor({
  saved,
  busy,
  save,
}: {
  saved: Branding;
  busy: boolean;
  save: (draft: Branding) => Promise<void>;
}) {
  const { setPreview } = useContext(BrandingPreviewContext)!;
  const initial = normalizedBranding(saved);
  const [draft, setDraft] = useState<Branding>(() => initial);
  const [uploadError, setUploadError] = useState(''),
    [reading, setReading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null),
    reader = useRef<FileReader | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const logoValid = validLogo(draft.logoUrl);
  useEffect(() => {
    setPreview(
      dirty
        ? { ...draft, logoUrl: validLogo(draft.logoUrl) ? draft.logoUrl : null }
        : null,
    );
    return () => setPreview(null);
  }, [draft, dirty, setPreview]);
  useEffect(() => () => reader.current?.abort(), []);
  function clearUpload() {
    reader.current?.abort();
    setReading(false);
    setUploadError('');
    if (fileInput.current) fileInput.current.value = '';
  }
  function cancel() {
    clearUpload();
    setDraft(initial);
  }
  return (
    <form
      className="form-stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (!reading && !uploadError && logoValid) void save(draft);
      }}
    >
      <p className="muted">
        Changes preview immediately in this browser. Save to publish them.
        Cancel or leave Configure to discard unsaved changes.
      </p>
      {dirty && (
        <p className="notice" role="status">
          Previewing unsaved branding changes
        </p>
      )}
      <div className="branding-colors">
        {(Object.keys(defaults) as (keyof typeof defaults)[]).map((key) => (
          <label key={key}>
            {
              {
                primaryColor: 'Primary color',
                accentColor: 'Accent color',
                backgroundColor: 'Background color',
                textColor: 'Text color',
              }[key]
            }
            <input
              type="color"
              name={key}
              value={draft[key] || defaults[key]}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <label>
        Font
        <select
          aria-label="Font"
          name="font"
          value={draft.font || 'default'}
          onChange={(e) =>
            setDraft({ ...draft, font: e.target.value as Branding['font'] })
          }
        >
          <option value="default">Market Delivered (DM Sans + DM Serif)</option>
          <option value="modern">Modern (Arial)</option>
          <option value="editorial">Editorial (Georgia)</option>
          <option value="rounded">Rounded (Trebuchet)</option>
        </select>
      </label>
      <label>
        Header display
        <select
          aria-label="Header display"
          name="headerDisplay"
          value={draft.headerDisplay || 'logo'}
          onChange={(e) =>
            setDraft({
              ...draft,
              headerDisplay: e.target.value as Branding['headerDisplay'],
            })
          }
        >
          <option value="logo">Logo</option>
          <option value="text">Text</option>
          <option value="logo-text">Logo + text</option>
        </select>
      </label>
      <p className="muted">
        Text uses the app name. If no logo is configured, the header shows the
        app name.
      </p>
      <label>
        Logo image URL
        <input
          type="url"
          name="logoUrl"
          placeholder="https://example.com/logo.png"
          value={draft.logoUrl?.startsWith('data:') ? '' : draft.logoUrl || ''}
          onChange={(e) => {
            clearUpload();
            setDraft({ ...draft, logoUrl: e.target.value || null });
          }}
        />
      </label>
      {!logoValid && (
        <p role="alert">Use an HTTPS image URL without credentials.</p>
      )}
      <label>
        Upload logo
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => {
            reader.current?.abort();
            setUploadError('');
            setReading(false);
            const file = e.target.files?.[0];
            if (!file) return;
            if (
              !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
              file.size > 200_000
            ) {
              setUploadError('Choose a PNG, JPEG, or WebP image up to 200 KB.');
              e.target.value = '';
              return;
            }
            const next = new FileReader();
            reader.current = next;
            setReading(true);
            next.onload = () =>
              setDraft((current) => ({
                ...current,
                logoUrl: String(next.result),
              }));
            next.onerror = () => setUploadError('Could not read this image.');
            next.onloadend = () => setReading(false);
            next.readAsDataURL(file);
          }}
        />
      </label>
      {uploadError && <p role="alert">{uploadError}</p>}
      {draft.logoUrl && logoValid && (
        <img
          className="network-logo branding-preview"
          src={draft.logoUrl}
          alt="App logo preview"
          referrerPolicy="no-referrer"
        />
      )}
      <label>
        <input
          type="checkbox"
          name="removeLogo"
          checked={!draft.logoUrl}
          onChange={(e) => {
            clearUpload();
            setDraft({
              ...draft,
              logoUrl: e.target.checked ? null : saved.logoUrl || null,
            });
          }}
        />{' '}
        Remove logo
      </label>
      <p className="muted">
        Applies to the sign-in page, storefront, and dashboards. Use a
        background and text color that are easy to read together.
      </p>
      <button
        disabled={busy || reading || !!uploadError || !logoValid || !dirty}
      >
        Save branding
      </button>
      <button
        type="button"
        className="secondary"
        disabled={busy || (!dirty && !uploadError && !reading)}
        onClick={cancel}
      >
        Cancel changes
      </button>
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={() => {
          clearUpload();
          setDraft(normalizedBranding({}));
        }}
      >
        Reset branding
      </button>
    </form>
  );
}
