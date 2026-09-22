import * as fs from 'fs';
import * as path from 'path';

interface SecurityViolation {
  file: string;
  line: number;
  pattern: string;
  snippet: string;
  category: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
}

const FORBIDDEN_SECURITY_PATTERNS: Array<{
  regex: RegExp;
  category: string;
  description: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  allowInFiles?: RegExp[];
}> = [
  {
    regex: /\beval\s*\(/,
    category: 'Dangerous eval()',
    description: 'Dynamic code execution via eval() is strictly prohibited across all packages',
    severity: 'CRITICAL'
  },
  {
    regex: /new\s+Function\s*\(/,
    category: 'Dynamic Function Constructor',
    description: 'Dynamic function generation via new Function() is strictly prohibited',
    severity: 'CRITICAL'
  },
  {
    regex: /(?:private[_-]?key|secret[_-]?key)\s*[:=]\s*['"`][0-9a-fA-F]{64}['"`]/i,
    category: 'Hardcoded Private Key',
    description: 'Hardcoded private keys or secrets are strictly prohibited in source code',
    severity: 'CRITICAL'
  },
  {
    regex: /Number\s*\(\s*BigInt\s*\(/,
    category: 'Unsafe Number(BigInt(...)) Cast',
    description: 'Converting BigInt token quantities to Number can cause silent precision loss',
    severity: 'HIGH'
  },
  {
    regex: /0x[1-8]00000000000000000000000000000000000/i,
    category: 'Synthetic Execution Target',
    description: 'Synthetic placeholder addresses are prohibited in production execution targets',
    severity: 'CRITICAL'
  }
];

const SCAN_DIRS = [
  path.resolve(process.cwd(), 'contracts'),
  path.resolve(process.cwd(), 'packages'),
  path.resolve(process.cwd(), 'apps'),
  path.resolve(process.cwd(), 'deployments'),
  path.resolve(process.cwd(), 'scripts')
];

const EXCLUDE_PATHS = [
  /\.test\.ts$/,
  /\.spec\.ts$/,
  /__tests__/,
  /node_modules/,
  /dist/,
  /\.next/,
  /build/,
  /\.git/,
  /contracts[\\\/]evm[\\\/]lib/,
  /scripts[\\\/]audit-anti-mock\.ts$/,
  /scripts[\\\/]audit-security\.ts$/
];

export function runSecurityAudit(): SecurityViolation[] {
  const violations: SecurityViolation[] = [];

  function scanDir(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!EXCLUDE_PATHS.some((p) => p.test(fullPath))) {
          scanDir(fullPath);
        }
      } else if (
        entry.isFile() &&
        (entry.name.endsWith('.ts') ||
          entry.name.endsWith('.tsx') ||
          entry.name.endsWith('.sol') ||
          (entry.name.endsWith('.json') && !entry.name.includes('package')))
      ) {
        if (EXCLUDE_PATHS.some((p) => p.test(fullPath))) continue;

        const content = fs.readFileSync(fullPath, 'utf8');
        const lines = content.split('\n');

        lines.forEach((line, index) => {
          for (const pattern of FORBIDDEN_SECURITY_PATTERNS) {
            if (pattern.regex.test(line)) {
              const allowed = pattern.allowInFiles?.some((p) => p.test(fullPath));
              if (!allowed) {
                if (line.trim().startsWith('//') || line.trim().startsWith('*') || line.trim().startsWith('/*')) {
                  return;
                }
                violations.push({
                  file: path.relative(process.cwd(), fullPath),
                  line: index + 1,
                  pattern: pattern.category,
                  snippet: line.trim(),
                  category: pattern.description,
                  severity: pattern.severity
                });
              }
            }
          }
        });
      }
    }
  }

  for (const dir of SCAN_DIRS) {
    scanDir(dir);
  }

  return violations;
}

if (typeof require !== 'undefined' && require.main === module) {
  console.log('🔒 Running ZENITH Adversarial Security & Production Integrity Audit...');
  const violations = runSecurityAudit();

  if (violations.length === 0) {
    console.log('✅ Security Audit PASSED: Zero critical security vulnerabilities, secret leaks, or forbidden execution patterns detected.');
    process.exit(0);
  } else {
    console.error(`❌ Security Audit FAILED: Found ${violations.length} security violation(s):`);
    violations.forEach((v) => {
      console.error(`  - [${v.severity}] [${v.pattern}] ${v.file}:${v.line} -> ${v.snippet} (${v.category})`);
    });
    process.exit(1);
  }
}
