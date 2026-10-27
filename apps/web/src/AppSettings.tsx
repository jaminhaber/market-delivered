import { useQuery } from '@tanstack/react-query';
import { api, rpc } from './api';
import { Panel, useAction } from './ui';

const field = (form: HTMLFormElement, name: string) =>
  String(new FormData(form).get(name) || '').trim();
const states =
  'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(
    ' ',
  );
export function SupportContact() {
  const { data } = useQuery(api.networks.branding.queryOptions());
  if (!data || (!data.supportEmail && !data.supportPhone && !data.contactUrl))
    return null;
  return (
    <aside className="support-contact" aria-label="Support">
      <strong>Need help?</strong>
      {data.supportEmail && (
        <a href={`mailto:${data.supportEmail}`}>Email support</a>
      )}
      {data.supportPhone && (
        <a href={`tel:${data.supportPhone.replace(/[^+0-9]/g, '')}`}>
          {data.supportPhone}
        </a>
      )}
      {data.contactUrl && (
        <a href={data.contactUrl} target="_blank" rel="noopener noreferrer">
          Contact us
        </a>
      )}
    </aside>
  );
}
export function SupportSettings() {
  const { data: n } = useQuery(api.networks.current.queryOptions());
  const support = useAction();
  if (!n) return null;
  return (
    <Panel title="Support contact">
      {support.notice}
      <form
        className="form-stack"
        key={JSON.stringify([n.supportEmail, n.supportPhone, n.contactUrl])}
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          void support.act(
            () =>
              rpc.networks.update.mutate({
                supportEmail: field(form, 'supportEmail') || null,
                supportPhone: field(form, 'supportPhone') || null,
                contactUrl: field(form, 'contactUrl') || null,
              }),
            'Support contact saved',
          );
        }}
      >
        <p>
          Shown on account and order pages and in the footer. Leave a field
          blank to hide it.
        </p>
        <label>
          Support email
          <input
            type="email"
            name="supportEmail"
            defaultValue={n.supportEmail || ''}
          />
        </label>
        <label>
          Support phone
          <input
            type="tel"
            name="supportPhone"
            maxLength={40}
            defaultValue={n.supportPhone || ''}
          />
        </label>
        <label>
          Contact link
          <input
            type="url"
            name="contactUrl"
            placeholder="https://example.com/contact"
            defaultValue={n.contactUrl || ''}
          />
        </label>
        <button disabled={support.busy}>Save support contact</button>
      </form>
    </Panel>
  );
}
export function LocationSettings() {
  const { data: n } = useQuery(api.networks.current.queryOptions());
  const location = useAction();
  if (!n) return null;
  const loc = n.location;
  return (
    <Panel title="Location defaults">
      {location.notice}
      <form
        className="form-stack"
        key={JSON.stringify(loc)}
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          void location.act(async () => {
            const latitude = field(form, 'latitude'),
              longitude = field(form, 'longitude');
            if (!!latitude !== !!longitude)
              throw new Error(
                'Enter both latitude and longitude, or leave both blank.',
              );
            await rpc.networks.update.mutate({
              location: {
                city: field(form, 'city') || null,
                region: field(form, 'region') || null,
                postalCode: field(form, 'postalCode') || null,
                timezone: field(form, 'timezone') || null,
                autocompleteBias:
                  latitude && longitude
                    ? {
                        latitude: Number(latitude),
                        longitude: Number(longitude),
                        radiusMeters: Number(field(form, 'radiusMeters')),
                      }
                    : null,
              },
            });
          }, 'Location defaults saved');
        }}
      >
        <p>
          Prefill new US delivery profiles and market timezones. Existing
          addresses and markets keep their saved values. These settings do not
          restrict the delivery area.
        </p>
        <label>
          Default city
          <input name="city" maxLength={100} defaultValue={loc.city || ''} />
        </label>
        <label>
          Default state
          <select
            aria-label="Default state"
            name="region"
            defaultValue={loc.region || ''}
          >
            <option value="">No default</option>
            {states.map((state) => (
              <option key={state}>{state}</option>
            ))}
          </select>
        </label>
        <label>
          Default ZIP code
          <input
            name="postalCode"
            pattern="[0-9]{5}(-[0-9]{4})?"
            maxLength={10}
            defaultValue={loc.postalCode || ''}
          />
        </label>
        <label>
          Default timezone
          <input
            name="timezone"
            placeholder="America/Los_Angeles"
            defaultValue={loc.timezone || ''}
          />
        </label>
        <p>
          Optionally bias address suggestions toward a center point. With no
          center, suggestions use the provider’s default US search.
        </p>
        <label>
          Search center latitude
          <input
            name="latitude"
            type="number"
            step="any"
            min={-90}
            max={90}
            defaultValue={loc.autocompleteBias?.latitude ?? ''}
          />
        </label>
        <label>
          Search center longitude
          <input
            name="longitude"
            type="number"
            step="any"
            min={-180}
            max={180}
            defaultValue={loc.autocompleteBias?.longitude ?? ''}
          />
        </label>
        <label>
          Search radius (meters)
          <input
            name="radiusMeters"
            type="number"
            min={1}
            max={50000}
            defaultValue={loc.autocompleteBias?.radiusMeters ?? 30000}
          />
        </label>
        <button disabled={location.busy}>Save location defaults</button>
      </form>
    </Panel>
  );
}
