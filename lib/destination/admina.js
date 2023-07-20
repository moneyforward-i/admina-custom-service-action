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
exports.registerCustomService = void 0;
const axios_1 = __importDefault(require("axios"));
const env_1 = require("../util/env");
function registerCustomService(app, env) {
    const admina = new Admina(env);
    admina.registerCustomService(app);
}
exports.registerCustomService = registerCustomService;
class Admina {
    constructor(env) {
        (0, env_1.checkEnv)(['admina_org_id', 'admina_api_token'], env);
        this.endpoint = 'https://api.itmc.i.moneyforward.com';
        this.orgId = env.admina_org_id;
        this.apiKey = env.admina_api_token;
        this.request_header = {
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            }
        };
    }
    registerCustomService(appInfo) {
        return __awaiter(this, void 0, void 0, function* () {
            const SSO_SERVICE_NAME = 'Single Sign-On'; // The service name is fixed.
            // Check if the Service already exists in the Organization
            const encodedServiceName = encodeURIComponent(SSO_SERVICE_NAME);
            const serviceListEndpoint = `${this.endpoint}/api/v1/organizations/${this.orgId}/services?keyword=${encodedServiceName}`;
            const serviceListResponse = yield axios_1.default.get(serviceListEndpoint, this.request_header);
            const sso_service = serviceListResponse.data.items[0];
            const sso_workspaces = sso_service ? sso_service.workspaces : []; //　完全に新規登録
            const targetWorkspaceName = appInfo.displayName;
            let serviceId = sso_service ? sso_service.id : null;
            let serviceName = sso_service ? sso_service.name : null;
            let workspaceId = -1; // dummy
            // Check if the Workspace already exists in the Service
            for (const workspace of sso_workspaces) {
                if (workspace.workspaceName === appInfo.displayName) {
                    workspaceId = workspace.id;
                    break;
                }
            }
            if (!workspaceId) {
                // Create Workspace if it does not exist
                const customWsEndpoint = `${this.endpoint}/api/v1/organizations/${this.orgId}/workspaces/custom`;
                const customWsPayload = {
                    serviceName: SSO_SERVICE_NAME,
                    serviceUrl: appInfo.identifierUris[0],
                    workspaceName: targetWorkspaceName
                };
                const customWsConfig = {
                    headers: {
                        Authorization: `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    }
                };
                const customServiceResponse = yield axios_1.default.post(customWsEndpoint, customWsPayload, customWsConfig);
                workspaceId = customServiceResponse.data.workspace.id;
                serviceId = customServiceResponse.data.service.id;
                console.log('Workspace created | ServiceName:', serviceName + '(' + serviceId + ')', ',WorkspaceName:', targetWorkspaceName + '(' + workspaceId + ')');
            }
            else {
                // Skip Workspace Creation if it already exist
                console.log('Workspace already exists | ServiceName:', serviceName + '(' + serviceId + ')', ',WorkspaceName:', targetWorkspaceName + '(' + workspaceId + ')');
            }
            yield this.registerUserAccountToCustomWorkspace(serviceId, workspaceId, targetWorkspaceName, appInfo.users);
        });
    }
    registerUserAccountToCustomWorkspace(serviceId, workspaceId, wsName, users) {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            const accountListEndpoint = `${this.endpoint}/api/v1/organizations/${this.orgId}/services/${serviceId}/accounts?workspaceId=${workspaceId}`;
            const accountListResponse = yield axios_1.default.get(accountListEndpoint, this.request_header);
            const accountEmails = accountListResponse.data.items.map((account) => account.email);
            // Obtain a list of accounts for each creation, renewal, and deletion
            const existingUsers = users.filter((user) => accountEmails.includes(user.email));
            const newUsers = users.filter((user) => !accountEmails.includes(user.email));
            const deletedUsers = accountListResponse.data.items.filter((account) => !users.find((user) => user.email === account.email));
            console.log(`Register data into ${wsName}: existingUsers`, existingUsers.length, ', newUsers', newUsers.length, ', deleteAccounts', deletedUsers.length);
            // Register accounts
            const registerEndpoint = `${this.endpoint}/api/v1/organizations/${this.orgId}/workspace/${workspaceId}/accounts/custom`;
            const requestData = {
                create: newUsers.map(user => ({
                    email: user.email,
                    displayName: user.displayName,
                    userName: user.displayName,
                    roles: ['user']
                })),
                update: existingUsers.map(user => ({
                    email: user.email,
                    displayName: user.displayName,
                    userName: user.displayName,
                    roles: ['user']
                })),
                delete: deletedUsers.map(account => ({
                    email: account.email,
                    displayName: account.displayName
                }))
            };
            try {
                yield axios_1.default.post(registerEndpoint, requestData, this.request_header);
            }
            catch (error) {
                if (error && error.response) {
                    const axiosError = error;
                    console.error(`Error occurred while registering user account into [${wsName}]:`, axiosError.message, (_a = axiosError.response) === null || _a === void 0 ? void 0 : _a.data);
                }
                else if (error instanceof Error) {
                    console.error(`Error occurred while registering user account into [${wsName}]:`, error.message);
                }
                else {
                    console.error(`An unknown error occurred while registering user account into [${wsName}]:`, error);
                }
            }
        });
    }
}
