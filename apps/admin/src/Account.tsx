import { useState, type FormEvent } from 'react';
import { authClient } from './auth';
import { Panel, useAction } from './ui';

export function AuthForm() {
  const params = new URLSearchParams(location.search);
  const token = params.get('token') || '';
  const [mode, setMode] = useState<'signin' | 'forgot' | 'reset'>(
    token ? 'reset' : 'signin',
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [needsVerification, setNeedsVerification] = useState(false);
  const { act, busy, notice } = useAction();

  async function submit(event: FormEvent) {
    event.preventDefault();
    await act(
      async () => {
        const response =
          mode === 'signin'
            ? await authClient.signIn.email({ email, password })
            : mode === 'forgot'
              ? await authClient.requestPasswordReset({
                  email,
                  redirectTo: location.origin + '/',
                })
              : await authClient.resetPassword({
                  newPassword: password,
                  token,
                });
        if (response.error) {
          setNeedsVerification(response.error.code === 'EMAIL_NOT_VERIFIED');
          throw new Error(
            response.error.message || 'Unable to complete the request.',
          );
        }
        if (mode !== 'forgot') location.replace('/');
      },
      mode === 'forgot'
        ? 'If that account exists, a reset link has been sent.'
        : 'Signed in.',
    );
  }

  function backToSignIn() {
    history.replaceState(null, '', '/');
    setPassword('');
    setNeedsVerification(false);
    setMode('signin');
  }

  return (
    <Panel
      title={
        mode === 'signin'
          ? 'Administrator sign in'
          : mode === 'forgot'
            ? 'Reset your password'
            : 'Choose a new password'
      }
    >
      <p>Sign in with your Market Delivered global administrator account.</p>
      {notice}
      {params.has('error') && (
        <p role="alert">
          This email link is invalid or expired. Request a new link.
        </p>
      )}
      <form className="form-stack" onSubmit={submit}>
        {mode !== 'reset' && (
          <label>
            Email
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
        )}
        {mode !== 'forgot' && (
          <label>
            Password
            <input
              type="password"
              required
              minLength={mode === 'reset' ? 12 : 1}
              maxLength={128}
              autoComplete={
                mode === 'signin' ? 'current-password' : 'new-password'
              }
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
        )}
        <button disabled={busy}>
          {mode === 'signin'
            ? 'Sign in'
            : mode === 'forgot'
              ? 'Send reset link'
              : 'Reset password'}
        </button>
      </form>
      <div className="inline-actions">
        {mode === 'signin' ? (
          <button
            className="secondary"
            disabled={busy}
            onClick={() => {
              setPassword('');
              setMode('forgot');
            }}
          >
            Forgot password?
          </button>
        ) : (
          <button className="secondary" disabled={busy} onClick={backToSignIn}>
            Back to sign in
          </button>
        )}
        {mode === 'signin' && needsVerification && (
          <button
            className="secondary"
            disabled={busy || !email}
            onClick={() =>
              void act(async () => {
                const response = await authClient.sendVerificationEmail({
                  email,
                  callbackURL: location.origin + '/',
                });
                if (response.error) throw new Error(response.error.message);
              }, 'If your account needs verification, a new link has been sent.')
            }
          >
            Resend verification email
          </button>
        )}
      </div>
    </Panel>
  );
}
