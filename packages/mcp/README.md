# Market Delivered MCP

`@market/mcp` is the shared server-side MCP library. It provides the tool catalog,
permission checks, and stateless Streamable HTTP transport for Fastify apps.
Business operations and OAuth infrastructure remain in `@market/core`; database
storage remains in `@market/db`.

## Use from an app

Add `"@market/mcp": "*"` to the app's workspace dependencies and import its
registration function:

```ts
import { createServer } from '@market/core/server';
import { registerMcp } from '@market/mcp';

const server = await createServer(db, config, registerMcp);
```

`createServer` supplies the database, server configuration, and shared OAuth
provider. The API app uses this composition. Apps bundling workspace source must
include `@market/mcp` alongside `@market/core` and `@market/db` in their bundle.

An app assembling its own Fastify server can register the same endpoint directly:

```ts
import { registerMcp } from '@market/mcp';
import { createOAuth, registerOAuthRoutes } from '@market/core/oauth-routes';

const oauth = createOAuth(db, config);
await registerOAuthRoutes(server, db, oauth);
registerMcp(server, db, config, oauth);
```

The host owns CORS, request parsing, and public routing. The library preserves
configured response headers when handing the response to the MCP transport.
Frontend browser code should use HTTP rather than import this server library.

## Authorization and hosting

The default admin connection uses `config.adminOrigin` for its issuer and `/mcp`
resource. Network-bound routes resolve a separate OAuth provider configuration
per request and pass it to `registerMcp` with a route path. The network UUID is
stored in the OAuth grant reference and enforced alongside the token audience.
Network tools default to that network and reject arguments selecting another one.
Global platform tools are unavailable through network-bound connections.

Apps can import the lightweight proxy without importing database or MCP SDK code:

```ts
import { proxyNetworkMcp } from '@market/mcp/proxy';

return proxyNetworkMcp(request, url, {
  origin: process.env.MARKET_API_ORIGIN!,
  networkId: process.env.SILVERSTREAK_NETWORK_ID!,
});
```

The host must validate its backend origin and network configuration first.
Expose this handler at `/api/mcp` and
`/.well-known/oauth-protected-resource/api/mcp`. The proxy forwards only the
fixed network's MCP/discovery routes and preserves authentication and CORS headers.
See [MCP architecture](../../docs/mcp.md) for issuer, consent, and resource URLs.
