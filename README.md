# Admina Custom Service Action

This is the action to register a custom service/workspace in Admina

[![AUTHOR](https://img.shields.io/badge/Author-admina-orange)](https://admina.moneyforward.com/) [![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

## Features

### Sync App & Account

- Sync IdP Apps from AzureAD(Entra ID), Okta
- Sync Database from Kintone

## Usage/Examples

- [Admina with AzureAD](./example/example_github_actions_for_AzureAD.md)
- [Admina with Kintone Database](./example/example_github_actions_for_Kintone.md)

## Input

| Target      | Service             | Key                    | Type     | Value                                                                     | Default | Required | 　Note                                                                                                                                                                                                                   |
| ----------- | ------------------- | ---------------------- | -------- | ------------------------------------------------------------------------- | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Command     | --                  | subcommand             | string   | ["sync"]                                                                  |         | true     | Specifies the command to execute.                                                                                                                                                                                        |
|             |                     | source                 | Enum Key | [choose enum key](./src/integrate/enum.ts)                                |         | true     | Specifies the source of the data.                                                                                                                                                                                        |
|             |                     | destination            | Enum Key | [choose enum key](./src/integrate/enum.ts)                                |         | true     | Specifies the destination of the data.                                                                                                                                                                                   |
| Source      | Azure AD (Entra ID) | ms_client_id           | string   |                                                                           |         |          | Specify the ClientID to connect to AzureAD.                                                                                                                                                                              |
|             |                     | ms_tenant_id           | string   |                                                                           |         |          | Specify the TenantID to connect to AzureAD.                                                                                                                                                                              |
|             |                     | ms_client_secret       | string   |                                                                           |         |          | Specify the ClientSecret to connect to AzureAD.                                                                                                                                                                          |
|             | Okta                |                        |          |                                                                           |         |          |                                                                                                                                                                                                                          |
|             | Kintone             | kintone_sub_domain     | string   |                                                                           |         |          |                                                                                                                                                                                                                          |
|             |                     | kintone_api_key        | string   |                                                                           |         |          | Specify the Api Key to connect to Kintone                                                                                                                                                                                |
|             |                     | kintone_app_id         | string   |                                                                           |         |          | Specify the App Id to connect to Kintone                                                                                                                                                                                 |
|             |                     | kintone_field_mapping  | json     | '{ "email": ''kintone_field_code", "displayName": "kintone_field_code" }' |         |          | Specify the Mapping definition to connect to Kintone                                                                                                                                                                     |
| Destination | Admina              | admina_org_id          | string   |                                                                           |         |          | Specify The OrganizationID to connect to Admina.                                                                                                                                                                         |
|             |                     | admina_api_token       | string   |                                                                           |         |          | Specify The API Key to connect to Admina.                                                                                                                                                                                |
| Options     | --                  | register_disabled_app  | string   | "true" / "false"                                                          | "false" |          | (Optional) Skip registration if the acquired app is disabled.                                                                                                                                                            |
|             |                     | register_zero_user_app | string   | "true" / "false"                                                          | "false" |          | (Optional) Skip registration if no user is assigned to the acquired app.                                                                                                                                                 |
|             |                     | target_services        | string   | comma-separated string                                                    |         |          | (Optional) Specify the application to be registered.                                                                                                                                                                     |
|             |                     | preload_cache          | string   | "true" / "false"                                                          | "true"  |          | When syncing many apps, caching in advance will make the operation faster.<br>If you only specify a few apps in target_services, using false may be faster.<br>This option caches all User and Group objects in advance. |

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
