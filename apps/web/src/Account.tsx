import { SupportContact } from './AppSettings';
import { AddressAutocomplete } from './AddressAutocomplete';
import { useEffect, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, queryClient, rpc } from './api';
import { authClient, signOut } from './auth';
import { Panel, Loading, useAction } from './ui';
import { updateSearch } from './navigation';
export function AuthForm({
  currentUser,
  onDone,
}: {
  currentUser: Awaited<ReturnType<typeof rpc.me.query>> | undefined;
  onDone: () => void;
}) {
  const params = new URLSearchParams(location.search),
    invite = params.get('invite') ?? '',
    token = params.get('token') ?? '',
    linkError = params.get('error');
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot' | 'reset'>(
    token ? 'reset' : invite ? 'signup' : 'signin',
  );
  const [name, setName] = useState(''),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState('');
  const [needsVerification, setNeedsVerification] = useState(false);
  useEffect(() => {
    if (!token && !invite) return;
    setMode(token ? 'reset' : 'signup');
    setPassword('');
    setNeedsVerification(false);
  }, [invite, token]);
  const invitation = useQuery({
    ...api.invitation.queryOptions({ token: invite }),
    enabled: !!invite && !token && !currentUser,
    retry: false,
    staleTime: 0,
  });
  const networkQuery = params.get('network')
    ? `?network=${encodeURIComponent(params.get('network')!)}`
    : '';
  const signupEmail = invitation.data?.email ?? '';
  const { act, busy, notice } = useAction();
  const linkNotice = linkError && (
    <p role="alert">
      This email link is invalid or expired. Request a new link below.
    </p>
  );
  function changeMode(next: typeof mode) {
    setPassword('');
    setNeedsVerification(false);
    setEmail(signupEmail || email);
    setMode(next);
    if (next !== 'reset')
      updateSearch({ token: null, reset: null, error: null }, true);
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    await act(
      async () => {
        const response =
          mode === 'signin'
            ? await authClient.signIn.email({ email, password })
            : mode === 'signup'
              ? await authClient.signUp.email(
                  {
                    email: signupEmail,
                    password,
                    name,
                    callbackURL: location.origin + '/' + networkQuery,
                  },
                  { headers: { 'x-invite-token': invite } },
                )
              : mode === 'forgot'
                ? await authClient.requestPasswordReset({
                    email,
                    redirectTo:
                      location.origin +
                      '/' +
                      (networkQuery ? networkQuery + '&reset=1' : '?reset=1'),
                  })
                : await authClient.resetPassword({
                    newPassword: password,
                    token,
                  });
        if (response.error) {
          setNeedsVerification(response.error.code === 'EMAIL_NOT_VERIFIED');
          throw new Error(
            response.error.code === 'EMAIL_NOT_VERIFIED'
              ? 'Check your email for a verification link, or request a new one below.'
              : response.error.message,
          );
        }
        if (mode === 'signup') {
          updateSearch({ invite: null }, true);
          setEmail(signupEmail);
          setPassword('');
          setMode('signin');
          setNeedsVerification(false);
        }
        if (mode === 'reset') {
          updateSearch({ token: null, reset: null, error: null }, true);
          setPassword('');
          setMode('signin');
        }
        if (mode === 'signin' || mode === 'signup' || mode === 'reset') {
          const current = await rpc.me.query();
          if (current) {
            await queryClient.cancelQueries();
            await queryClient.resetQueries();
            onDone();
          }
        }
      },
      mode === 'forgot'
        ? 'If that account exists, a reset link has been sent.'
        : mode === 'reset'
          ? 'Password reset. If your email still needs verification, verify it before signing in.'
          : 'Account ready.',
    );
  }
  if (currentUser && !token) {
    return (
      <Panel title={invite ? 'You’re already signed in' : 'Your account'}>
        {notice}
        {linkNotice}
        <p>You’re signed in as {currentUser.email}.</p>
        {invite && (
          <p>
            Accept this invitation using the signed-in email, or sign out to use
            a different account.
          </p>
        )}
        <div className="inline-actions">
          {invite && (
            <button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await rpc.acceptInvitation.mutate({ token: invite });
                  updateSearch({ invite: null }, true);
                  onDone();
                }, 'Invitation accepted')
              }
            >
              Accept network invitation
            </button>
          )}
          <button onClick={onDone} disabled={busy}>
            Continue to your profile
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void act(signOut)}
          >
            Sign out{invite ? ' to use invitation' : ''}
          </button>
        </div>
      </Panel>
    );
  }
  return (
    <Panel
      title={
        mode === 'signin'
          ? 'Welcome back'
          : mode === 'signup'
            ? 'Join your local market'
            : mode === 'forgot'
              ? 'Reset your password'
              : 'Choose a new password'
      }
    >
      {notice}
      {linkNotice}
      {mode === 'signup' && invitation.isPending && <Loading />}
      <form onSubmit={submit} className="form-stack">
        {mode === 'signup' && (
          <>
            <p>This invitation is for {signupEmail || '…'}.</p>
            {invitation.error && <p role="alert">{invitation.error.message}</p>}
            <label>
              Full name
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
              />
            </label>
          </>
        )}
        {mode !== 'reset' && (
          <label>
            Email
            <input
              type="email"
              required
              value={mode === 'signup' ? signupEmail : email}
              readOnly={mode === 'signup'}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </label>
        )}
        {mode !== 'forgot' && (
          <label>
            Password
            <input
              type="password"
              aria-label="Password"
              required
              minLength={mode === 'signin' ? 1 : 12}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={
                mode === 'signin' ? 'current-password' : 'new-password'
              }
            />
            {mode !== 'signin' && (
              <small>Use at least 12 characters for a new password.</small>
            )}
          </label>
        )}
        <button
          disabled={
            busy ||
            (mode === 'signup' &&
              (!signupEmail || invitation.isFetching || invitation.isError))
          }
        >
          {mode === 'signin'
            ? 'Sign in'
            : mode === 'signup'
              ? 'Create account'
              : mode === 'forgot'
                ? 'Send reset link'
                : 'Reset password'}
        </button>
      </form>
      <div className="inline-actions">
        {mode === 'signin' && needsVerification && (
          <button
            className="secondary"
            disabled={busy || !email}
            onClick={() =>
              void act(async () => {
                const response = await authClient.sendVerificationEmail({
                  email,
                  callbackURL: location.origin + '/' + networkQuery,
                });
                if (response.error) throw new Error(response.error.message);
              }, 'If your account needs verification, a new link has been sent.')
            }
          >
            Resend verification email
          </button>
        )}
        {mode !== 'signin' && (
          <button className="secondary" onClick={() => changeMode('signin')}>
            Back to sign in
          </button>
        )}
        {(mode === 'signin' || mode === 'signup') && (
          <button className="secondary" onClick={() => changeMode('forgot')}>
            Forgot password?
          </button>
        )}
        {invite && mode !== 'signup' && mode !== 'reset' && (
          <button className="secondary" onClick={() => changeMode('signup')}>
            Use invitation
          </button>
        )}
      </div>
      {!invite && mode === 'signin' && (
        <p className="muted">
          We’re invite-only. Ask the team for an invitation.
        </p>
      )}
    </Panel>
  );
}
export function Profile() {
  const me = useQuery(api.me.queryOptions());
  const [lookup, setLookup] = useState<Awaited<
    ReturnType<typeof rpc.profile.locateAddress.mutate>
  > | null>(null);
  const [showCustomer, setShowCustomer] = useState(!me.data?.driver);
  const { act, busy, notice } = useAction();
  const [name, setName] = useState(me.data?.name ?? ''),
    [phone, setPhone] = useState(me.data?.customer?.phone ?? ''),
    [street, setStreet] = useState(me.data?.customer?.street ?? ''),
    [unit, setUnit] = useState(me.data?.customer?.unit ?? ''),
    [city, setCity] = useState(
      me.data?.customer?.city || me.data?.network.location.city || '',
    ),
    [region, setRegion] = useState(
      me.data?.customer?.region || me.data?.network.location.region || '',
    ),
    [postalCode, setPostalCode] = useState(
      me.data?.customer?.postalCode ||
        me.data?.network.location.postalCode ||
        '',
    ),
    [notes, setNotes] = useState(me.data?.customer?.deliveryNotes ?? '');
  return (
    <div className="page-grid">
      <SupportContact />
      {me.data?.driver && (
        <DriverProfile name={me.data.name} driver={me.data.driver} />
      )}
      {me.data?.driver && (
        <>
          <section className="panel">
            <h2>Ordering for yourself?</h2>
            <p>
              A delivery address is only needed when you place a customer order.
            </p>
            <button
              className="secondary"
              aria-expanded={showCustomer}
              onClick={() => setShowCustomer((value) => !value)}
            >
              {showCustomer
                ? 'Hide customer delivery profile'
                : me.data.customer?.street
                  ? 'Edit customer delivery profile'
                  : 'Set up customer delivery profile'}
            </button>
          </section>
        </>
      )}
      {showCustomer && (
        <>
          <Panel title="Your delivery profile">
            {notice}
            <form
              className="form-stack"
              onSubmit={(e) => {
                e.preventDefault();
                setLookup(null);
                void act(
                  () =>
                    rpc.profile.save.mutate({
                      name,
                      phone,
                      street,
                      unit,
                      city,
                      region,
                      postalCode,
                      country: 'US',
                      deliveryNotes: notes,
                    }),
                  'Delivery profile saved',
                );
              }}
            >
              <label>
                Full name
                <input
                  required
                  minLength={2}
                  maxLength={100}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                Phone
                <input
                  type="tel"
                  required
                  minLength={7}
                  maxLength={30}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </label>
              <fieldset className="form-stack">
                <legend>Delivery address</legend>
                <AddressAutocomplete
                  value={street}
                  onChange={setStreet}
                  onSelect={(address) => {
                    setStreet(address.street);
                    setCity(address.city);
                    setRegion(
                      address.region || me.data?.network.location.region || '',
                    );
                    setPostalCode(address.postalCode);
                    setLookup(null);
                  }}
                />
                <label>
                  Apartment / unit
                  <input
                    autoComplete="address-line2"
                    maxLength={100}
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                  />
                </label>
                <label>
                  City
                  <input
                    required
                    autoComplete="address-level2"
                    maxLength={100}
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                  />
                </label>
                <label>
                  State
                  <select
                    required
                    aria-label="State"
                    autoComplete="address-level1"
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                  >
                    <option value="">Choose a state</option>
                    {'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'
                      .split(' ')
                      .map((state) => (
                        <option key={state}>{state}</option>
                      ))}
                  </select>
                </label>
                <label>
                  ZIP code
                  <input
                    required
                    autoComplete="postal-code"
                    pattern="[0-9]{5}(-[0-9]{4})?"
                    maxLength={10}
                    value={postalCode}
                    onChange={(e) => setPostalCode(e.target.value)}
                  />
                </label>
                <label>
                  Country
                  <input
                    value="United States"
                    readOnly
                    autoComplete="country-name"
                  />
                </label>
              </fieldset>
              <label>
                Delivery instructions
                <textarea
                  aria-label="Delivery instructions"
                  maxLength={500}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
              <button disabled={busy}>Save delivery profile</button>
            </form>
          </Panel>
          <Panel title="Delivery location">
            <p>
              Save your address, then look up its approximate street location
              for future route planning.
            </p>
            <p className="muted">
              Lookup sends your saved address, including apartment/unit, to
              Google Address Validation. Delivery instructions stay here.
            </p>
            {lookup && (
              <div>
                <p>Google Maps</p>
                <p>Matched address: {lookup.geocodedAddress}</p>
                {lookup.needsReview ? (
                  <p role="alert">
                    Google suggested corrections. Review the matched address,
                    update your address fields, save, then look up the address
                    again.
                  </p>
                ) : (
                  <p>Address confirmed. Location saved for future routing.</p>
                )}
              </div>
            )}
            {me.data?.customer?.googlePlaceId ? (
              <p>
                Your address has a Google location saved for future routing.
              </p>
            ) : me.data?.customer?.geocodedAddress ? (
              <>
                <p>Matched street: {me.data.customer.geocodedAddress}</p>
                <p>
                  Approximate location: {me.data.customer.latitude},{' '}
                  {me.data.customer.longitude}
                </p>
                <small>
                  This is a street location, not a confirmed entrance. Include
                  access details in your delivery instructions.
                </small>
              </>
            ) : (
              <p>
                No location saved yet. You can still order using your delivery
                address.
              </p>
            )}
            <button
              className="secondary"
              disabled={busy || !me.data?.customer?.street}
              onClick={() =>
                void act(async () => {
                  const result = await rpc.profile.locateAddress.mutate();
                  setLookup(result);
                }, 'Address lookup complete')
              }
            >
              Look up saved address
            </button>
          </Panel>
        </>
      )}
    </div>
  );
}

function DriverProfile({
  name: initialName,
  driver,
}: {
  name: string;
  driver: NonNullable<
    NonNullable<Awaited<ReturnType<typeof rpc.me.query>>>['driver']
  >;
}) {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(driver.phone);
  const [vehicle, setVehicle] = useState(driver.vehicle);
  const { act, busy, notice } = useAction();
  return (
    <Panel title="Your driver details">
      <p>
        Driver access: <strong>{driver.status}</strong>
      </p>
      <p>
        Save your contact details and vehicle to claim individual orders, shop
        at the market, and deliver to customers.
      </p>
      {notice}
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void act(
            () => rpc.profile.saveDriver.mutate({ name, phone, vehicle }),
            'Driver details saved',
          );
        }}
      >
        <label>
          Full name
          <input
            required
            autoComplete="name"
            minLength={2}
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Phone
          <input
            required
            type="tel"
            autoComplete="tel"
            minLength={7}
            maxLength={30}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        </label>
        <label>
          Vehicle
          <input
            required
            minLength={2}
            maxLength={200}
            value={vehicle}
            onChange={(event) => setVehicle(event.target.value)}
          />
        </label>
        <button disabled={busy}>Save driver details</button>
      </form>
    </Panel>
  );
}
