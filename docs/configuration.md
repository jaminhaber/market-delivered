# Configuration

## Environment

The root `.env.example` is the reference. The backend needs `DATABASE_URL` and the
stable `BETTER_AUTH_SECRET` (32+ characters). The latter signs business sessions
and encrypts per-network email credentials; rotating it requires a deliberate
credential migration.

The same backend also requires a distinct `ADMIN_AUTH_SECRET` (32+ characters)
and `ADMIN_ORIGIN`. The backend port defaults to 3001; the dashboard defaults
to 5173. `API_HOST=0.0.0.0` is appropriate for containers. Node 24 is the supported
runtime. Global auth has no dependency on a network record.

`RESEND_API_KEY` and `EMAIL_FROM` are required for production email. Development
without a provider prints account links to local API logs. `CRON_SECRET` protects
scheduled endpoints. `GOOGLE_MAPS_API_KEY` enables address lookup; manual address
entry and the rest of the API do not require it.

## Registered business frontend

A network's `frontendOrigin` is an HTTP loopback origin in development or an HTTPS
origin in production, with no path, credentials, query, or fragment. Configure it
through admin `networks.create`/`networks.update`, MCP, or the trusted
`network:create`/`network:configure` CLI. Missing configuration fails explicitly.
There is no shared global business URL or inferred/default network.

Each business supplies its own frontend and fixed API context. Silverstreak stores
`MARKET_API_ORIGIN` and `SILVERSTREAK_NETWORK_ID` in its server environment. Its
cookie proxy preserves the real browser Origin and overwrites incoming selectors.
Use separate staging values for previews.

## Email, support, and location

Admin `networks.update` and MCP `update_network` accept explicit network IDs.
Settings include business name, support contacts, US location/timezone defaults,
Places search bias, and email sender/reply-to/key overrides. Keys are write-only,
encrypted at rest, and never returned. Senders must be verified with the email
provider. Invitation links use the registered frontend's `/account` route and
never include a network selector.

Presentation belongs to each bespoke frontend. Silverstreak does not load theme,
logo, color, or network-branding settings from the API.

## Administrator frontend

`apps/admin` calls `/admin/trpc` and `/admin/auth` through its own origin.
It also hosts account-wide assistant pages at `/oauth/login`, `/oauth/authorize`,
and `/oauth/connect`, and proxies `/mcp`, `/oauth/auth/*`, and OAuth discovery.
Vite forwards these API paths to `API_PORT` locally. On Vercel, set server-only
`MARKET_API_ORIGIN` to the backend origin. No database or signing credentials
belong in frontend deployments. Set the backend’s `ADMIN_ORIGIN` to this
frontend’s exact HTTPS domain. It hosts the account-wide MCP and all OAuth pages
and issuers. Silverstreak exposes its network-bound MCP at its own `/api/mcp`,
using the existing `MARKET_API_ORIGIN` and `SILVERSTREAK_NETWORK_ID` settings.
The network's registered `frontendOrigin` must match Silverstreak's public domain.

## Catalog images

Enable Cloudflare Images on one platform account. Set these on the shared backend
only; omit all three to leave uploads disabled:

- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account ID.
- `CLOUDFLARE_IMAGES_API_TOKEN`: an API token restricted to that account with
  Cloudflare Images Read and Edit permissions.
- `CLOUDFLARE_IMAGES_DELIVERY_HASH`: the account hash from its
  `https://imagedelivery.net/<hash>/<image-id>/<variant>` delivery URLs. This is
  different from the account ID.

Create these public named variants in Cloudflare Images (strip image metadata):

| Variant         | Suggested settings            |
| --------------- | ----------------------------- |
| `thumbnail`     | 160 × 160, cover              |
| `produceCard`   | 640 × 480, cover              |
| `produceDetail` | Up to 1600 × 1600, scale down |

See [direct uploads](https://developers.cloudflare.com/images/storage/upload-images/direct-creator-upload/)
and [named variants](https://developers.cloudflare.com/images/optimization/hosted-images/create-variants/).
Apply database migrations as usual, then restart the backend. No webhook, R2 bucket,
or frontend Cloudflare credentials are needed. Existing catalog entries without
images continue to work.

In Silverstreak, save a produce listing, then open its editor under
`/admin/produce` to upload, replace, describe, or remove its image. The browser
uploads directly to Cloudflare and calls the API to register the completed image.
Image changes save independently of the produce text fields. Dashboard image
uploads accept JPEG, PNG, WebP, and AVIF up to 10 MB; Cloudflare enforces its own
upload format and size limits for all clients.

Assets are created only after the backend verifies upload completion and the
network/uploader metadata set when issuing the upload URL. Associations live in
`assets.metadata`, e.g. `{"produce_id":"<uuid>"}`; the backend validates the
produce belongs to the same network. A unique index allows one image per produce
listing. Delivery is public; admin authorization protects image management.
Additional JSON metadata is retained, but farm image associations are not yet
implemented.

New uploads use Cloudflare custom image IDs shaped as
`produce/<network-id>/<uuid>`, providing a folder-like namespace per network.
Existing images with plain UUID IDs continue to work. Custom ID paths support
public delivery; Cloudflare does not support signed private delivery for them.

Replacing an image requires the current asset ID and atomically removes its
`produce_id` metadata before registering the replacement. The previous asset stays
in the library; administrators can delete it through MCP. Deletes remove the
Cloudflare image and database row. If a completed upload is abandoned before
registration, it remains in Cloudflare; automatic orphan cleanup is not included.
