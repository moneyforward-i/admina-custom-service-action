// Source
import * as kintone from '../source/kintone'

// Destination
import * as admina from '../destination/admina'

export async function transformDataToAdmina(
  appInfo: kintone.AppInfo
): Promise<admina.AppInfo> {
  try {
    const fieldMapping = JSON.parse(appInfo.field_map); // field_map をオブジェクトに変換
    const transformedUsers: admina.UserInfo[] = [];

    appInfo.users.forEach(user => {
      const emailDetail = user.details.find(detail => detail.fieldCode === fieldMapping.email);
      const displayNameDetail = user.details.find(detail => detail.fieldCode === fieldMapping.displayName);

      if (emailDetail && emailDetail.value) { // emailが存在する場合のみ処理
        transformedUsers.push({
          email: emailDetail.value,
          displayName: displayNameDetail ? displayNameDetail.value : ""
        });
      } else { // emailが空の場合、warning logを出力
        console.warn(`⚠Warning: Skipping record with missing email. Record ID: ${user.recordId}}}`);
      }
    });

    return {
      displayName: appInfo.displayName,
      identifierUris: [], // この部分は後で調整する必要があります
      users: transformedUsers
    };
  } catch (error) {
    console.log('transform data error:', error);
    throw new Error('Error in transformDataToAdmina');
  }
}
