import * as fs from 'fs';
import * as path from 'path';

interface AuditViolation {
  file: string;
  line: number;
  pattern: string;
  snippet: string;
  category: string;
}

const FORBIDDEN_PATTERNS: Array<{
  regex: RegExp;
  category: string;
  description: string;
  allowInFiles?: RegExp[];
}> = [
  {
    regex: /0x1111111254EEB25477B68fb85Ed929f73A960582/i,
    category: 'Hardcoded Mock Router',
    description: 'Generic 1inch/mock router address must not be used as simulation target'
  },
  {
    regex: /0x0000000000000000000000000000000000000000/i,
    category: 'Zero Address Spender/Recipient',
    description: 'Zero address must not be used as default spender or recipient (use ERC-7528 0xEeee... or fail closed)',
    allowInFiles: [/permit2\.ts/, /acrossProvider\.ts/, /errors\.ts/, /solana\.ts/, /addressValidator\.ts/, /dexMath\.ts/]
  },
  {
    regex: /Math\.random\(\)/,
    category: 'Random Generation in Production',
    description: 'Math.random() is prohibited for tx hashes, signatures, nonces, and execution logic',
    allowInFiles: [/chart/i, /particle/i, /visual/i, /animation/i]
  },
  {
    regex: /0xdead00000000000000000000000000000000dead/i,
    category: 'Dead Address Fallback',
    description: 'Do not use fake dead addresses as protocol targets'
  },
  {
    regex: /0x[1-8]00000000000000000000000000000000000/i,
    category: 'Synthetic Placeholder Address',
    description: 'Synthetic sequential placeholder addresses (0x1000... - 0x8000...) must not be used in production configurations'
  },
  {
    regex: /isSimulated\s*:\s*true/i,
    category: 'Simulated Execution Flag',
    description: 'Simulated execution flags must not bypass real execution pipelines'
  }
];

const SCAN_DIRS = [
  path.resolve(process.cwd(), 'packages'),
  path.resolve(process.cwd(), 'apps/web/src')
];

const EXCLUDE_PATHS = [
  /\.test\.ts$/,
  /\.spec\.ts$/,
  /__tests__/,
  /node_modules/,
  /dist/,
  /\.next/,
  /build/
];

export function runAudit(): AuditViolation[] {
  const violations: AuditViolation[] = [];

  function scanDir(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!EXCLUDE_PATHS.some((p) => p.test(fullPath))) {
          scanDir(fullPath);
        }
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
        if (EXCLUDE_PATHS.some((p) => p.test(fullPath))) continue;

        const content = fs.readFileSync(fullPath, 'utf8');
        const lines = content.split('\n');

        lines.forEach((line, index) => {
          for (const pattern of FORBIDDEN_PATTERNS) {
            if (pattern.regex.test(line)) {
              const allowed = pattern.allowInFiles?.some((p) => p.test(fullPath));
              if (!allowed) {

                if (line.trim().startsWith('//') || line.trim().startsWith('*')) {
                  return;
                }
                violations.push({
                  file: path.relative(process.cwd(), fullPath),
                  line: index + 1,
                  pattern: pattern.category,
                  snippet: line.trim(),
                  category: pattern.description
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

if (require.main === module) {
  console.log('🔍 Running ZENITH Anti-Mock & Zero-Address Audit...');
  const violations = runAudit();

  if (violations.length === 0) {
    console.log('✅ Anti-Mock Audit PASSED: Zero prohibited mock patterns detected across production codebases.');
    process.exit(0);
  } else {
    console.error(`❌ Anti-Mock Audit FAILED: Found ${violations.length} violation(s):`);
    violations.forEach((v) => {
      console.error(`  - [${v.pattern}] ${v.file}:${v.line} -> ${v.snippet} (${v.category})`);
    });
    process.exit(1);
  }
}
