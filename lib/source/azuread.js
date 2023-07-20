"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchApps = void 0;
const axios_1 = __importDefault(require("axios"));
const env_1 = require("../util/env");
class AzureAD {
    constructor(env) {
        (0, env_1.checkEnv)(['ms_client_id', 'ms_tenant_id', 'ms_client_secret'], env);
        this.clientId = env.ms_client_id;
        this.tenantId = env.ms_tenant_id;
        this.clientSecret = env.ms_client_secret;
    }
    getAccessToken() {
        return __awaiter(this, void 0, void 0, function* () {
            console.log('Getting access token...');
            const url = `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`;
            const params = new URLSearchParams();
            params.append('grant_type', 'client_credentials');
            params.append('client_id', this.clientId);
            params.append('client_secret', this.clientSecret);
            params.append('scope', 'https://graph.microsoft.com/.default');
            try {
                const response = yield axios_1.default.post(url, params, {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                });
                return response.data.access_token;
            }
            catch (error) {
                if (error instanceof Error) {
                    throw new Error(`Failed to get access token: ${error.message}`);
                }
                else {
                    throw new Error(`An unknown error occurred while getting access token: ${error}`);
                }
            }
        });
    }
    getEnterpriseApplications(accessToken, url = 'https://graph.microsoft.com/v1.0/applications') {
        return __awaiter(this, void 0, void 0, function* () {
            const response = yield axios_1.default.get(url, {
                headers: {
                    Authorization: `Bearer ${accessToken}`
                }
            });
            const apps = response.data.value;
            // Map each app to the AppInfo interface and get the corresponding service principal id
            let appInfos = yield Promise.all(apps.map((app) => __awaiter(this, void 0, void 0, function* () {
                var _a;
                // Get the service principal id
                const servicePrincipalUrl = `https://graph.microsoft.com/v1.0/servicePrincipals?$filter=appId eq '${app.appId}'`;
                const servicePrincipalResponse = yield axios_1.default.get(servicePrincipalUrl, {
                    headers: {
                        Authorization: `Bearer ${accessToken}`
                    }
                });
                const servicePrincipalId = (_a = servicePrincipalResponse.data.value[0]) === null || _a === void 0 ? void 0 : _a.id;
                const appInfo = {
                    appId: app.appId,
                    displayName: app.displayName,
                    principleId: servicePrincipalId,
                    applicationTemplateId: app.applicationTemplateId,
                    identifierUris: app.identifierUris,
                    users: []
                };
                return appInfo;
            })));
            // After the Promise.all is resolved, then filter the apps
            appInfos = appInfos.filter(appInfo => appInfo.applicationTemplateId !== null);
            if (response.data['@odata.nextLink']) {
                const nextApps = yield this.getEnterpriseApplications(accessToken, response.data['@odata.nextLink']);
                appInfos = appInfos.concat(nextApps);
            }
            return appInfos;
        });
    }
    getUsers(accessToken, url) {
        return __awaiter(this, void 0, void 0, function* () {
            const response = yield axios_1.default.get(url, {
                headers: {
                    Authorization: `Bearer ${accessToken}`
                }
            });
            //const users: string[] = response.data.value;
            const user_principals = response.data.value
                .filter((user) => user.principalId !== null)
                .map((user) => user.principalId);
            const userInfoPromises = user_principals.map((principal_id) => __awaiter(this, void 0, void 0, function* () {
                const userUrl = `https://graph.microsoft.com/v1.0/users/${principal_id}`;
                const userResponse = yield axios_1.default.get(userUrl, {
                    headers: {
                        Authorization: `Bearer ${accessToken}`
                    }
                });
                const userInfo = {
                    email: userResponse.data.userPrincipalName,
                    displayName: userResponse.data.displayName,
                    principalId: principal_id
                };
                return userInfo;
            }));
            let userInfos = yield Promise.all(userInfoPromises);
            if (response.data['@odata.nextLink']) {
                const nextUsers = yield this.getUsers(accessToken, response.data['@odata.nextLink']);
                userInfos = userInfos.concat(nextUsers);
            }
            return userInfos;
        });
    }
    getAppAssignedUsers(accessToken, app) {
        return __awaiter(this, void 0, void 0, function* () {
            const url = `https://graph.microsoft.com/v1.0/servicePrincipals/${app.principleId}/appRoleAssignedTo`;
            const usersInfo = yield this.getUsers(accessToken, url);
            const appInfoWithUsers = {
                appId: app.appId,
                displayName: app.displayName,
                principleId: app.principleId,
                applicationTemplateId: app.applicationTemplateId,
                identifierUris: app.identifierUris,
                users: usersInfo
            };
            console.log(`Detected ${usersInfo.length} users in ${app.displayName}`);
            return appInfoWithUsers;
        });
    }
    fetchSsoApps() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const accessToken = yield this.getAccessToken();
                const enterpriseApplications = yield this.getEnterpriseApplications(accessToken);
                const dataPromises = enterpriseApplications.map(appInfo => this.getAppAssignedUsers(accessToken, appInfo).catch(err => {
                    console.error(`Failed to get assigned users for app ${appInfo.id}: ${err}`);
                    return null;
                }));
                const data = yield Promise.all(dataPromises);
                return data.filter(appInfo => appInfo !== null);
            }
            catch (error) {
                throw new Error(`Error fetching SSO apps: ${error}`);
            }
        });
    }
}
const fetchApps = (env) => {
    const aad = new AzureAD(env);
    return aad.fetchSsoApps();
};
exports.fetchApps = fetchApps;
