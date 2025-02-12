import axios from 'axios'
import { checkEnv } from '../util/env'

export interface AppInfo {
  appId: string
  code?: string
  displayName: string
  users: UserInfo[]
  field_map: string
}

export interface UserInfo {
  recordId: string
  details: Detail[]
}

export interface Detail {
  fieldCode: string;
  value: string;
}

class Kintone {
  private app_id: string
  private field_map: string
  private api_key: string
  private sub_domain: string

  // Kintone Integration didn't support this options
  private register_zero_user_app: boolean
  private register_disabled_app: boolean
  private target_services: string[]
  private preload_cache: boolean

  constructor(inputs: Record<string, string>) {
    checkEnv(['kintone_sub_domain', 'kintone_api_key', 'kintone_app_id', 'kintone_field_mapping'], inputs)
    this.sub_domain = inputs['kintone_sub_domain']
    this.app_id = inputs['kintone_app_id']
    this.api_key = inputs['kintone_api_key']
    this.field_map = inputs['kintone_field_mapping']

    this.register_zero_user_app = inputs['register_zero_user_app'] === 'true'
    this.register_disabled_app = inputs['register_disabled_app'] === 'true'
    this.target_services = inputs['target_services']
      ? inputs['target_services'].split(',')
      : []
    this.preload_cache = inputs['preload_cache']
      ? inputs['preload_cache'] === 'true'
      : true
  }

  private async getApp(): Promise<AppInfo> {
    const url = `https://${this.sub_domain}.cybozu.com/k/v1/app.json?id=${this.app_id}`;
    const headers = {
      'X-Cybozu-API-Token': this.api_key,
      'Content-Type': 'application/json',
    };

    try {
      const response = await axios.get(url, { headers });
      const data = response.data;

      return {
        appId: data.appId,
        code: data.code,
        displayName: data.name,
        field_map: this.field_map,
        users: [],
      };
    } catch (error) {
      console.error(`Error fetching app data: ${error}`);
      throw error;
    }
  }

  private async getRecords(): Promise<UserInfo[]> {
    const limit = 100;  // Kintone APIの最大取得件数
    let offset = 0;
    let records: UserInfo[] = [];

    while (true) {
      const url = `https://${this.sub_domain}.cybozu.com/k/v1/records.json?app=${this.app_id}&offset=${offset}&limit=${limit}`;

      const headers = {
        'X-Cybozu-API-Token': this.api_key,
        'Content-Type': 'application/json',
      };

      const response = await axios.get(url, { headers });
      const data = response.data.records;

      records = records.concat(
        data.map((record: any) => ({
          recordId: record.$id.value,
          details: Object.keys(record).map(fieldCode => ({
            fieldCode: fieldCode,
            value: record[fieldCode].value
          }))
        }))
      );
      if (data.length < limit || offset >= 10000 - limit) break;  // すべてのレコードを取得した場合、またはoffsetの上限に達した場合

      offset += limit;
    }

    return records;
  }

  public async getAppInfo(): Promise<AppInfo> {
    const app = await this.getApp();
    console.log(
      `🚀 Start to get [ ${app.displayName} ]'s AppInfos ... (ID:${app.code})`
    )
    app.users = await this.getRecords();
    console.log(
      `✅ Detected ${app.users.length} users in ${app.displayName} ... (${app.code})`
    )
    return app;
  }
}

export const fetchApps = async (
  inputs: Record<string, string>
): Promise<AppInfo[]> => {
  const kintone = new Kintone(inputs)
  const apps: AppInfo[] = [await kintone.getAppInfo()]
  return apps
}
