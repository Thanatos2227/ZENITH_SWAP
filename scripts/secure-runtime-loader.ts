import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { normalizePrivateKey } from './execute-controlled-polygon-crosschain';

export type SignerRuntimeSource = 'PROCESS_ENV' | 'LOCAL_GITIGNORED_ENV' | 'WINDOWS_USER_REGISTRY' | 'NONE_AVAILABLE';

export interface SecureRuntimeSignerResult {
    rawKey: string | null;
    runtimeSource: SignerRuntimeSource;
}

export function isGitIgnoredFile(repoRoot: string, filename: string): boolean {
    try {
        const gitignorePath = path.join(repoRoot, '.gitignore');
        if (!fs.existsSync(gitignorePath)) {
            return false;
        }
        const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
        const lines = gitignoreContent.split(/\r?\n/).map(l => l.trim()).filter(l => Boolean(l && !l.startsWith('#')));
        for (const rule of lines) {
            if (rule === filename)
                return true;
            if (rule === '.env' && filename === '.env')
                return true;
            if (rule === '.env.*' && filename.startsWith('.env.'))
                return true;
        }
        return false;
    }
    catch {
        return false;
    }
}

function parseKeyFromEnvFile(filePath: string, allowedKeys?: string[]): string | null {
    try {
        if (!fs.existsSync(filePath))
            return null;
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split(/\r?\n/);
        const targetKeys = allowedKeys || [
            'ZENITH_MAINNET_PRIVATE_KEY',
            'TESTNET_PRIVATE_KEY',
            'ZENITH_PRIVATE_KEY',
            'ZENITH_SIGNER_PRIVATE_KEY',
            'PRIVATE_KEY'
        ];
        for (const keyName of targetKeys) {
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith('#') || !trimmed.includes('='))
                    continue;
                const [k, ...vParts] = trimmed.split('=');
                if (k.trim() === keyName) {
                    const val = vParts.join('=').trim();
                    if (val)
                        return val;
                }
            }
        }
        return null;
    }
    catch {
        return null;
    }
}

export type EnvironmentScope = 'MAINNET' | 'TESTNET' | 'LOCAL';
export enum ChainScope {
    LOCAL = 'LOCAL',
    TESTNET = 'TESTNET',
    MAINNET = 'MAINNET'
}

export function resolveScopedSignerKey(
    envScope: EnvironmentScope | ChainScope,
    repoRoot: string = process.cwd()
): SecureRuntimeSignerResult {
    const scopeStr = String(envScope).toUpperCase();
    let targetKeyNames: string[];
    if (scopeStr === 'MAINNET') {
        targetKeyNames = ['ZENITH_MAINNET_PRIVATE_KEY'];
    } else if (scopeStr === 'TESTNET') {
        targetKeyNames = ['TESTNET_PRIVATE_KEY', 'ZENITH_TESTNET_PRIVATE_KEY'];
    } else if (scopeStr === 'LOCAL') {
        targetKeyNames = ['ZENITH_LOCAL_PRIVATE_KEY', 'ANVIL_PRIVATE_KEY'];
    } else {
        throw new Error(`[Security] Unknown chain scope: ${envScope}`);
    }

    for (const keyName of targetKeyNames) {
        const val = process.env[keyName];
        if (val && val.trim()) {
            return {
                rawKey: val.trim(),
                runtimeSource: 'PROCESS_ENV'
            };
        }
    }

    const candidateFiles = ['.env.local', '.env'];
    for (const file of candidateFiles) {
        if (isGitIgnoredFile(repoRoot, file)) {
            const fullPath = path.join(repoRoot, file);
            const val = parseKeyFromEnvFile(fullPath, targetKeyNames);
            if (val && val.trim()) {
                return {
                    rawKey: val.trim(),
                    runtimeSource: 'LOCAL_GITIGNORED_ENV'
                };
            }
        }
    }

    if (process.platform === 'win32') {
        try {
            for (const keyName of targetKeyNames) {
                try {
                    const cmd = `reg query HKCU\\Environment /v ${keyName}`;
                    const output = execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
                    const lines = output.split(/\r?\n/);
                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (trimmed.startsWith(keyName)) {
                            const parts = trimmed.split(/\s+/);
                            if (parts.length >= 3) {
                                const val = parts.slice(2).join(' ').trim();
                                if (val) {
                                    return {
                                        rawKey: val,
                                        runtimeSource: 'WINDOWS_USER_REGISTRY'
                                    };
                                }
                            }
                        }
                    }
                } catch {
                    // Ignore registry key not found
                }
            }
        } catch {
            // Ignore registry query error
        }
    }

    return {
        rawKey: null,
        runtimeSource: 'NONE_AVAILABLE'
    };
}

export function resolveSecureSignerKey(repoRoot: string = process.cwd()): SecureRuntimeSignerResult {
    const processKey = process.env.ZENITH_MAINNET_PRIVATE_KEY ||
        process.env.TESTNET_PRIVATE_KEY ||
        process.env.ZENITH_PRIVATE_KEY ||
        process.env.ZENITH_SIGNER_PRIVATE_KEY ||
        process.env.PRIVATE_KEY;
    if (processKey && processKey.trim()) {
        return {
            rawKey: processKey.trim(),
            runtimeSource: 'PROCESS_ENV'
        };
    }
    const candidateFiles = ['.env.local', '.env'];
    for (const file of candidateFiles) {
        if (isGitIgnoredFile(repoRoot, file)) {
            const fullPath = path.join(repoRoot, file);
            const fileKey = parseKeyFromEnvFile(fullPath);
            if (fileKey && fileKey.trim()) {
                return {
                    rawKey: fileKey.trim(),
                    runtimeSource: 'LOCAL_GITIGNORED_ENV'
                };
            }
        }
    }
    const regKey = queryWindowsUserRegistry();
    if (regKey && regKey.trim()) {
        return {
            rawKey: regKey.trim(),
            runtimeSource: 'WINDOWS_USER_REGISTRY'
        };
    }
    return {
        rawKey: null,
        runtimeSource: 'NONE_AVAILABLE'
    };
}

function queryWindowsUserRegistry(): string | null {
    if (process.platform !== 'win32') return null;
    const targetKeyNames = [
        'ZENITH_MAINNET_PRIVATE_KEY',
        'TESTNET_PRIVATE_KEY',
        'ZENITH_PRIVATE_KEY',
        'ZENITH_SIGNER_PRIVATE_KEY',
        'PRIVATE_KEY'
    ];
    try {
        for (const keyName of targetKeyNames) {
            try {
                const cmd = `reg query HKCU\\Environment /v ${keyName}`;
                const output = execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
                const lines = output.split(/\r?\n/);
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed.startsWith(keyName)) {
                        const parts = trimmed.split(/\s+/);
                        if (parts.length >= 3) {
                            const val = parts.slice(2).join(' ').trim();
                            if (val) return val;
                        }
                    }
                }
            } catch {
                // Ignore key not found
            }
        }
    } catch {
        // Ignore registry query error
    }
    return null;
}
