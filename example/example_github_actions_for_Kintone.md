# Example with Kintone

This is sample of GitHub Workflow Yaml.

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
          source: 'Kintone'
          destination: 'Admina'
          admina_org_id: ${{ secrets.ADMINA_SYNC_APPS_TASK_ADMINA_ORG_ID }}
          admina_api_token: ${{ secrets.ADMINA_SYNC_APPS_TASK_ADMINA_API_TOKEN }}
          kintone_api_key: ${{ secrets.ADMINA_SYNC_APPS_TASK_KINTONE_API_KEY }}
          kintone_app_id: '<<APP_ID>>'
          kintone_field_mapping: '{ "email": "<<kintone_field_code>>", "displayName": "<<kintone_field_code>>" }'
```
