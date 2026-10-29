# Documentation

[Project README](../README.md)

| Guide                              | Contents                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------ |
| [Architecture](architecture.md)    | Applications, API boundaries, authentication, and data ownership         |
| [Local setup](getting-started.md)  | One-command development, accounts, networks, and invitations             |
| [Workflows](workflows.md)          | Silverstreak customers and API/MCP operations                            |
| [Configuration](configuration.md)  | Secrets, business domains, email identity, and support/location settings |
| [Networks and access](networks.md) | Onboarding businesses, roles, credentials, and isolation                 |
| [MCP](mcp.md)                      | Separate platform and business tool catalogs                             |
| [Jobs](jobs.md)                    | Scheduling, closing markets, and cron                                    |
| [Development](development.md)      | Workspace layout, migrations, and checks                                 |
| [Deployment](deployment.md)        | Three Vercel projects and environment settings                           |

There is no generic themed storefront, network switcher, or network configuration
screen. Silverstreak owns its presentation and customer pages. The Market
Delivered dashboard is a minimal global-admin application; network provisioning
and configuration use the admin route namespace of the shared backend, platform MCP, or trusted CLI.
