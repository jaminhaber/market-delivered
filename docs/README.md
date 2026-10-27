# Documentation

[Project README](../README.md)

For a new checkout, start with [local setup](getting-started.md), then [development and checks](development.md). To operate a delivery business, start with [app workflows](workflows.md) and [app configuration](configuration.md). For a hosted installation, read [deployment](deployment.md), including the linked database and cron requirements.

| Guide                                 | Contents                                                          |
| ------------------------------------- | ----------------------------------------------------------------- |
| [Local setup](getting-started.md)     | Installation, seed data, account bootstrap, and local reset       |
| [App workflows](workflows.md)         | Customers, drivers, orders, inventory, and operations             |
| [App configuration](configuration.md) | Branding, email identity, support contacts, and location defaults |
| [Networks and access](networks.md)    | Ownership, administrator roles, and data isolation                |
| [MCP administration](mcp.md)          | Connecting clients, tokens, tools, and configuration examples     |
| [Schedules and jobs](jobs.md)         | Recurring markets, workers, cron, and market closing              |
| [Development](development.md)         | Workspace layout, database migrations, and checks                 |
| [Deployment](deployment.md)           | Hosting, environment variables, and launch checks                 |

## Common tasks

- [Grant network or global administrator access](networks.md#administrator-roles).
- [Change branding and preview edits](configuration.md#branding).
- [Set email credentials, sender identity, and reply-to](configuration.md#email-overrides).
- [Configure support contacts and autocomplete search ZIP](configuration.md#support-location-defaults-and-email-identity).
- [Connect an MCP client](mcp.md) and [edit configuration through MCP](mcp.md#configure-through-mcp).
- [Run scheduling and closing jobs](jobs.md#local-development).
- [Apply database migrations](development.md#schema-and-workspace) or [reset disposable local data](getting-started.md#resetting-local-data).
