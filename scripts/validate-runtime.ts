#!/usr/bin/env tsx
/**
 * ZENITH Protocol — Authoritative Runtime Validator
 *
 * Verifies that the Node.js runtime satisfies all security, persistence,
 * and cryptographic invariants required for cross-chain execution.
 * Fails closed if the runtime is unsupported.
 */

import { webcrypto } from 'node:crypto';

export interface RuntimeValidationReport {
  nodeVersion: string;
  major: number;
  minor: number;
  patch: number;
  npmVersion: string;
  sqliteAvailable: boolean;
  databaseSyncAvailable: boolean;
  webCryptoAvailable: boolean;
  fetchAvailable: boolean;
  isSupported: boolean;
  errors: string[];
}

export function validateRuntimeEnvironment(): RuntimeValidationReport {
  const nodeVersion = process.versions.node || '0.0.0';
  const parts = nodeVersion.split('.').map(Number);
  const major = parts[0] || 0;
  const minor = parts[1] || 0;
  const patch = parts[2] || 0;

  const errors: string[] = [];

  // Minimum required: Node.js 22.13.0+
  const isNodeSatisfied = major > 22 || (major === 22 && minor >= 13);
  if (!isNodeSatisfied) {
    errors.push(`Node.js version v${nodeVersion} is below the minimum required v22.13.0`);
  }

  // DatabaseSync in node:sqlite
  let sqliteAvailable = false;
  let databaseSyncAvailable = false;
  try {
    const sqlite = (process as any).getBuiltinModule
      ? (process as any).getBuiltinModule('node:sqlite')
      : require('node:sqlite');
    sqliteAvailable = Boolean(sqlite);
    databaseSyncAvailable = typeof sqlite?.DatabaseSync === 'function';
    if (!databaseSyncAvailable) {
      errors.push("Native 'node:sqlite' DatabaseSync constructor is unavailable");
    }
  } catch (err: any) {
    errors.push(`Failed to load 'node:sqlite': ${err.message}`);
  }

  // WebCrypto APIs
  const webCryptoAvailable = typeof globalThis.crypto?.subtle !== 'undefined' || typeof webcrypto?.subtle !== 'undefined';
  if (!webCryptoAvailable) {
    errors.push('WebCrypto / crypto.subtle is unavailable');
  }

  // Web APIs (fetch, Request, Response, Headers)
  const fetchAvailable = typeof globalThis.fetch === 'function' && typeof globalThis.Headers === 'function';
  if (!fetchAvailable) {
    errors.push('Native Fetch / Web APIs are unavailable');
  }

  const isSupported = errors.length === 0;

  return {
    nodeVersion,
    major,
    minor,
    patch,
    npmVersion: process.env.npm_config_user_agent?.split(' ')[0] || 'unknown',
    sqliteAvailable,
    databaseSyncAvailable,
    webCryptoAvailable,
    fetchAvailable,
    isSupported,
    errors,
  };
}

if (process.argv[1]?.includes('validate-runtime')) {
  console.log('============================================================');
  console.log('   ZENITH PROTOCOL — AUTHORITATIVE RUNTIME VALIDATION       ');
  console.log('============================================================');

  const report = validateRuntimeEnvironment();

  console.log(`Node Version:             v${report.nodeVersion}`);
  console.log(`DatabaseSync Available:   ${report.databaseSyncAvailable}`);
  console.log(`WebCrypto Available:      ${report.webCryptoAvailable}`);
  console.log(`Native Fetch Available:   ${report.fetchAvailable}`);
  console.log('------------------------------------------------------------');

  if (!report.isSupported) {
    console.error('RUNTIME_UNSUPPORTED: Mandatory runtime requirements not met:');
    for (const err of report.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  console.log('RUNTIME_VERIFIED: All security & persistence runtime invariants satisfied.');
  console.log('============================================================');
  process.exit(0);
}
