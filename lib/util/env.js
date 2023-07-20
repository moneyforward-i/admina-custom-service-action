"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkEnv = void 0;
function checkEnv(variables, env) {
    variables.forEach(variable => {
        if (!env[variable]) {
            throw new Error(`Environment variable ${variable} is not set`);
        }
    });
    return true;
}
exports.checkEnv = checkEnv;
