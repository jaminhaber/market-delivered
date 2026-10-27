# App configuration

[Documentation](README.md) · [Project README](../README.md)

Each operator manages its app in **Operations → Configure**. Network administrators manage their own app; global administrators can configure any network. All controls are also available through [MCP](mcp.md#configure-through-mcp).

## Authentication and platform email

Better Auth manages password hashing, database-backed sessions, sign-in, sign-out, email verification, and password resets. Customer and driver profiles point to the core `users` table; a person can have both profiles. Session cookies are HTTP-only and are secured by Better Auth for HTTPS deployments. API authorization and origin checks are enforced independently of UI navigation.

Local password-reset and verification links are printed to the API terminal instead of sending email. The reset UI is accessible from **Sign in → Forgot password?** Production requires `RESEND_API_KEY`, `EMAIL_FROM`, `BETTER_AUTH_SECRET`, and correct HTTPS `BETTER_AUTH_URL` / `WEB_ORIGIN`. Production signup requires email verification. Unverified sign-in attempts resend verification, and the sign-in/signup screen offers an explicit resend action (limited to five requests per IP per minute). Verification redirects back to the frontend, with secure HTTP-only sessions. Email requests time out after 10 seconds so provider outages cannot indefinitely hold an API request. Configure a verified Resend sender domain before inviting real users.

`GOOGLE_MAPS_API_KEY` configures server-side Google Address Validation. Set it in the root `.env` locally and in the shared Vercel project environment when deployed. The key is never sent to the frontend.

Auth rate limits use PostgreSQL so they work across API processes. The isolated E2E server runs with `NODE_ENV=test` and disables auth rate limiting so repeated test-account setup does not exhaust it. Do not run a deployed app in test mode.

## Email overrides

**Operations → Configure**, or MCP `update_network`, can override `emailFrom` and
`emailKey` (Resend) independently. Missing overrides inherit `EMAIL_FROM` and
`RESEND_API_KEY`. Set a field to `null` to clear it; omitting it preserves its
current value. Keys are write-only, encrypted with AES-256-GCM using a key derived
from `BETTER_AUTH_SECRET` and bound to the network ID. Responses expose only
`hasEmailKey`, never the key or ciphertext. Re-enter stored network keys after
rotating `BETTER_AUTH_SECRET`. Sender addresses must be verified in the selected
Resend account.

Overrides apply to MCP invitation mail and verification/password-reset mail
initiated from that network. Platform email defaults are still required for
production authentication. Database URLs, auth secrets, trusted origins, and cron
secrets remain platform configuration. Custom domains and DNS are not part of this layer.

## Branding

Use **Operations → Configure → Branding** to set primary, accent, background,
and text colors, choose a font preset, and upload a PNG/JPEG/WebP logo (up to 200 KB)
or supply an HTTPS image URL. The theme applies to the sign-in page, storefront,
and dashboards. Fonts use the existing DM Sans/DM Serif pair or installed Arial,
Georgia, or Trebuchet fonts; no custom CSS or font downloads are accepted.
**Header display** selects Logo, Text (the network name), or Logo + text.
Logo modes fall back to the network name when no logo is configured.
**Branding edits preview immediately in your browser** without changing the saved
app. **Save branding** publishes them; **Cancel changes** restores saved settings.
Leaving Configure discards unsaved edits. **Reset branding** previews the default
theme and logo; save to publish that reset.

MCP `get_network` returns branding. `update_network` accepts a `branding` object
with `primaryColor`, `accentColor`, `backgroundColor`, `textColor` (six-digit hex),
`font` (`default`, `modern`, `editorial`, `rounded`), and `logoUrl`, plus `headerDisplay` (`logo`, `text`, `logo-text`). Supplied fields
merge with saved branding. Set individual fields to `null` to restore their defaults,
or set `branding: null` to reset everything. Network administrators manage their
own branding; global administrators can manage any network. Public branding reads
contain no email settings or secrets.

## Support, location defaults, and email identity

**Operations → Configure** includes support email, support phone, and an HTTPS
contact link. Configured contacts appear on account/profile and order pages and
in the shared footer. Blank contacts are hidden. These details are public; email
provider credentials and the reply-to override are not exposed by public reads.

Location defaults include city, US state, ZIP, and IANA timezone. They prefill
new delivery profiles and new markets; saved addresses and market timezones stay
unchanged. Address autocomplete can optionally use a five-digit search ZIP code and radius
in meters (1–50,000). The backend resolves the ZIP center through
[Zippopotam.us](https://docs.zippopotam.us/docs/getting-started/) (GeoNames data)
when settings are saved, and stores the ZIP with its latitude/longitude. Unchanged
ZIP codes reuse the saved center; lookup failures leave all settings unchanged.
No API key or new Google API needs to be configured. This biases suggestions, without
restricting delivery eligibility. Without a search center, autocomplete uses its
default US search. The network migration initializes Ojai defaults; newly created
operators have no location-specific defaults.

Invitations, verification emails, and password resets automatically use the app
name in their subject and sender display name. Sending still uses the configured,
verified sender email address and Resend account. **Email reply-to address** can
override where replies go; otherwise the support email is used when configured.

MCP `get_network` and `update_network` support `supportEmail`, `supportPhone`,
`contactUrl`, `emailReplyTo`, and `location`. Location fields are `city`, `region`,
`postalCode`, `timezone`, and `autocompleteBias: { postalCode, radiusMeters }`.
Coordinates are returned as saved data, but cannot be supplied as update inputs.
Set `autocompleteBias: null` to remove the search bias. Existing coordinate-only
centers remain active until replaced with a ZIP or explicitly cleared. Partial location updates merge with saved values. Set individual
fields to `null` to clear them, or `location: null` to clear all location defaults.
The supported address format remains US/USD; these settings do not introduce
international address or currency support.

## Related guides

- [Ownership and administrator roles](networks.md)
- [Configure through MCP](mcp.md#configure-through-mcp)
- [Deployment environment variables](deployment.md#vercel-test-deployment)
