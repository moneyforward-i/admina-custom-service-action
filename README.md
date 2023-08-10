# Admina Custom Service Action

This is the action to register a custom service/workspace in Admina

[![AUTHOR](https://img.shields.io/badge/Author-admina-orange)](https://admina.moneyforward.com/) [![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

## Features

### Sync App & Account

- Sync IdP Apps from AzureAD(Entra ID), Okta
- Sync Database from Kintone

## Usage/Examples

```yaml
# Admina Custom Service Action
# This GitHub Actions workflow runs a Node.js script that synchronizes applications and users between Source System to Admina.
# The workflow can be triggered manually or by a cron schedule.

name: Admina Sync Custom Apps

# Schedule a workflow run every hour between 00:00 AM and 12:00 PM UTC (9:00 AM to 9:00 PM JST) and 4:00 PM UTC (1:00 AM JST) from Monday to Friday, excluding weekends
on:
  workflow_dispatch:
  schedule:
    - cron: '0 0-12,16 * * 1-5' # JST: AM9:00-PM9:00, AM1:00

# AzureAD with Admina
jobs:
  AzureAD-Saml-App-Sync:
    name: AzureAD Saml Apps Sync
    runs-on: ubuntu-latest
    steps:
      - name: Sync
        uses: moneyforward-i/admina-custom-service-action@v1.0.0
        with:
          subcommand: 'sync'
          source: 'AzureAd'
          destination: 'Admina'
          admina_org_id: ${{ secrets.ADMINA_SYNC_SAMLAPPS_TASK_ADMINA_ORG_ID }}
          admina_api_token: ${{ secrets.ADMINA_SYNC_SAMLAPPS_TASK_ADMINA_API_TOKEN }}
          ms_client_id: ${{ secrets.ADMINA_SYNC_SAMLAPPS_TASK_MS_CLIENT_ID }}
          ms_tenant_id: ${{ secrets.ADMINA_SYNC_SAMLAPPS_TASK_MS_TENANT_ID }}
          ms_client_secret: ${{ secrets.ADMINA_SYNC_SAMLAPPS_TASK_MS_CLIENT_SECRET }}
```

## Input

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

## Acknowledgments

- [Admina Top](https://admina.moneyforward.com/)
- [Admina Support](https://support.itmc.i.moneyforward.com/)
- [Admina API Doc](https://docs.itmc.i.moneyforward.com/)

## Development

How to run locally

```
## Compile
npm run build && npm run package

## set env
export subcommand='sync'
export source='AzureAd'
export destination='Admina'
export admina_org_id=''
export admina_api_token=''
export ms_client_id=''
export ms_tenant_id=''
export ms_client_secret=''

## call dist/index.js directly
node dist/index.js
```

## Feedback

If you have any feedback, please reach out to us on [Issues Page](https://github.com/moneyforward-i/admina-custom-service-action/issues)](https://github.com/moneyforward-i/admina-custom-service-action/issues)
