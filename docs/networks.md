# Networks and access

A network owns the business records for one delivery operator. PostgreSQL is shared;
application scoping and composite foreign keys enforce ownership. Platform user
identities can belong to more than one business without sharing profiles,
addresses, approvals, orders, or credentials.

## Onboarding another business

1. Use the admin API or platform MCP to create a network with a unique slug and
   that business's `frontendOrigin`.
2. Assign its existing owner with `networks.setMember`, or use the trusted CLI to
   create an invitation for `network_admin`.
3. Configure email identity and business support/location settings on the admin API.
4. Deploy its own frontend, pointing its server at the shared public API and
   attaching its fixed `X-Network-Id` on every business/auth request.
5. Issue a network-scoped MCP token through business administration or the platform
   MCP `create_network_token` tool. It cannot access platform management.

No backend deployment or database is created per business. Browser authentication
uses the registered frontend origin and host-only cookies; use a same-origin
server/proxy as Silverstreak does when the business has an unrelated domain.

## Roles

- `member`: customer access and, with an approved driver profile, driver operations.
- `network_admin`: business operations and invitations within its assigned network.
- `global_admin`: platform administration. Grants use the trusted CLI. Admin API
  routes check this role and do not infer it from a selected network.

```sh
npm run admin:grant -- owner@example.com global_admin
npm run admin:grant -- operator@example.com network_admin silverstreak
npm run invite:create -- operator@example.com network_admin silverstreak
```

A network slug is mandatory for network-scoped CLI actions. Missing selectors
never silently choose the oldest business. A network ID is public context, not
an API secret or permission grant. Invalid or deleted networks fail explicitly.
