# Admina Custom Service Action

This is the action to register a custom service/workspace in Admina

[![AUTHOR](https://img.shields.io/badge/Author-admina-orange)](https://admina.moneyforward.com/) [![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

## Features

### Sync App & Account

- Sync IdP Apps from AzureAD(Entra ID), Okta
- Sync Database from Kintone

## Usage/Examples

```yaml
name: "TBD"
description: "Sync data from various cloud services to Admina"
```

## Imput

| Target      | Service             | Key              | Type     | Value                                      |
| ----------- | ------------------- | ---------------- | -------- | ------------------------------------------ |
| Source      | Azure AD (Entra ID) | ms_client_id     | String   |                                            |
|             |                     | ms_tenant_id     | String   |                                            |
|             |                     | ms_client_secret | String   |                                            |
|             | Okta                |                  |          |                                            |
|             | Kintone             |                  |          |                                            |
| Destination | Admina              | admina_org_id    | String   |                                            |
|             |                     | admina_api_token | String   |                                            |
| Command     | --                  | subcommand       | String   | ["sync"]                                   |
|             |                     | source           | Enum Key | [choose enum key](./src/integrate/enum.ts) |
|             |                     | destination      | Enum Key | [choose enum key](./src/integrate/enum.ts) |

## Acknowledgements

- [Admina Top](https://admina.moneyforward.com/)
- [Admina Support](https://support.itmc.i.moneyforward.com/)
- [Admina API Doc](https://docs.itmc.i.moneyforward.com/)

## Feedback

If you have any feedback, please reach out to us at [ISSUES Page](https://github.com/moneyforward-i/admina-custom-service-action/issues)

## FAQ

TBD
