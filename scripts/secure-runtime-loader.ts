import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { normalizePrivateKey } from './execute-controlled-polygon-crosschain';

export type SignerRuntimeSource =
  | 'PROCESS_ENV'
  | 'LOCAL_GITIGNORED_ENV'
  | 'WINDOWS_USER_REGISTRY'
  | 'NONE_AVAILABLE';

export interface SecureRuntimeSignerResult {
  rawKey: string | null;
  runtimeSource: SignerRuntimeSource;
}

/**
 * Verifies that a given filename in the workspace root is covered by .gitignore.
 */
export function isGitIgnoredFile(repoRoot: string, filename: string): boolean {
  try {
    const gitignorePath = path.join(repoRoot, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
      return false;
    }
    const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
    const lines = gitignoreContent.split(/\r?\n/).map(l => l.trim()).filter(l => Boolean(l && !l.startsWith('#')));
    
    // Check if filename matches any gitignore rule
    for (const rule of lines) {
      if (rule === filename) return true;
      if (rule === '.env' && filename === '.env') return true;
      if (rule === '.env.*' && filename.startsWith('.env.')) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Safely parses a key from a local env file without logging or leaking.
 */
function parseKeyFromEnvFile(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    const targetKeys = [
      'ZENITH_MAINNET_PRIVATE_KEY',
      'TESTNET_PRIVATE_KEY',
      'ZENITH_PRIVATE_KEY',
      'ZENITH_SIGNER_PRIVATE_KEY',
      'PRIVATE_KEY'
    ];

    for (const keyName of targetKeys) {
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
        const [k, ...vParts] = trimmed.split('=');
        if (k.trim() === keyName) {
          const val = vParts.join('=').trim();
          if (val) return val;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * On Windows, securely queries the user-level environment registry (HKCU\Environment)
 * without logging or printing values.
 */
function queryWindowsUserRegistry(): string | null {
  if (process.platform !== 'win32') return null;
  try {
    const targetKeys = ['ZENITH_MAINNET_PRIVATE_KEY', 'TESTNET_PRIVATE_KEY', 'ZENITH_PRIVATE_KEY'];
    for (const keyName of targetKeys) {
      try {
        const cmd = `reg query HKCU\\Environment /v ${keyName}`;
        const output = execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
        const lines = output.split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith(keyName)) {
            // format: KEYNAME REG_SZ VALUE
            const parts = trimmed.split(/\s+/);
            if (parts.length >= 3) {
              const val = parts.slice(2).join(' ').trim();
              if (val) return val;
            }
          }
        }
      } catch {
        // Registry key not present, continue
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Multi-source secure signer loader.
 * Order of resolution:
 * 1. Process environment (process.env)
 * 2. Local uncommitted gitignored .env / .env.local file
 * 3. Windows User environment registry (HKCU\Environment)
 */
export function resolveSecureSignerKey(repoRoot: string = process.cwd()): SecureRuntimeSignerResult {
  // 1. Check process environment
  const processKey =
    process.env.ZENITH_MAINNET_PRIVATE_KEY ||
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

  // 2. Check local gitignored .env or .env.local file
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

  // 3. Check Windows User environment registry
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
