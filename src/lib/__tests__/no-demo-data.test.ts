import { describe, it, expect } from 'vitest';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/**
 * Mock-data guard.
 *
 * Production pages have shipped hardcoded demo arrays and Math.random()-driven
 * "data" more than once (a seeded-noise "alpha" series, random Black-Litterman
 * views, a randomised chart edge). This test walks every source file under
 * src/app and src/components and fails on:
 *
 *   1. `demo-const`  — a variable declared with a name matching
 *                      /^(DEMO|MOCK|SAMPLE|FAKE|PLACEHOLDER)_[A-Z0-9_]+$/
 *   2. `math-random` — any reference to Math.random (called or not, dotted or
 *                      Math['random'])
 *
 * It parses each file with the TypeScript compiler rather than grepping, so a
 * comment that merely mentions Math.random() is not a hit and a URL containing
 * `//` cannot hide code from the scan.
 *
 * Fail-closed rules (team lesson: a guard's failure mode is the shape it
 * silently does not scan):
 *   - a file with an extension not listed below FAILS — it is not skipped
 *   - a symlink or other non-regular entry FAILS
 *   - a file that cannot be read or does not parse cleanly FAILS
 *   - an allowlist entry that no longer matches anything FAILS (no dead
 *     exemptions waiting to excuse a future regression)
 */

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SCAN_ROOTS = ['src/app', 'src/components'];

/** Parsed and scanned. */
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
/** Known not to be able to hold executable demo data. Anything else is unknown → fail. */
const INERT_EXTENSIONS = new Set(['.css', '.ico', '.png', '.jpg', '.jpeg', '.svg', '.webp', '.woff', '.woff2']);

const DEMO_NAME = /^(DEMO|MOCK|SAMPLE|FAKE|PLACEHOLDER)_[A-Z0-9_]+$/;

type Rule = 'demo-const' | 'math-random';

/**
 * Genuine exceptions. One entry per (file, rule); every entry needs a specific
 * reason, and is checked to still be needed.
 */
const ALLOWLIST: Array<{ file: string; rule: Rule; reason: string }> = [
  {
    file: 'src/app/monte-carlo/page.tsx',
    rule: 'math-random',
    reason: 'Monte Carlo simulation: Box-Muller draws are the feature, and the page labels the output as simulated paths.',
  },
  {
    file: 'src/app/api/autopilot/route.ts',
    rule: 'math-random',
    reason: 'Uniqueness suffix on an autopilot run id (`ap-<ms>-<rand>`); an identifier, not a displayed or stored figure.',
  },
  {
    file: 'src/app/news/page.tsx',
    rule: 'demo-const',
    reason: 'PLACEHOLDER_IMG is the path of the fallback thumbnail shown when a news image fails to load; not data.',
  },
  {
    file: 'src/app/api/img/route.ts',
    rule: 'demo-const',
    reason: 'PLACEHOLDER_TTL is the cache lifetime of the fallback image response; a duration, not data.',
  },
];

interface Hit {
  file: string;
  rule: Rule;
  line: number;
  text: string;
}

interface WalkResult {
  codeFiles: string[];
  problems: string[];
}

function walk(absDir: string, out: WalkResult): void {
  let names: string[];
  try {
    names = readdirSync(absDir);
  } catch (err) {
    out.problems.push(`${path.relative(REPO_ROOT, absDir)}: unreadable directory (${(err as Error).message})`);
    return;
  }
  for (const name of names) {
    const abs = path.join(absDir, name);
    const rel = path.relative(REPO_ROOT, abs).split(path.sep).join('/');
    let stat;
    try {
      stat = lstatSync(abs);
    } catch (err) {
      out.problems.push(`${rel}: cannot stat (${(err as Error).message})`);
      continue;
    }
    if (stat.isDirectory()) {
      if (name === '__tests__') continue; // the one deliberate exclusion
      walk(abs, out);
    } else if (stat.isFile()) {
      const ext = path.extname(name).toLowerCase();
      if (CODE_EXTENSIONS.has(ext)) {
        if (/\.(test|spec)\.[a-z]+$/.test(name)) continue; // test file outside __tests__
        out.codeFiles.push(rel);
      } else if (!INERT_EXTENSIONS.has(ext)) {
        out.problems.push(`${rel}: unknown file type "${ext || '(none)'}" — add it to CODE_EXTENSIONS or INERT_EXTENSIONS in no-demo-data.test.ts`);
      }
    } else {
      out.problems.push(`${rel}: not a regular file or directory (symlink?) — the guard will not follow it, so it fails`);
    }
  }
}

function scriptKindFor(file: string): ts.ScriptKind {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (file.endsWith('.ts')) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

/** Scan one file's source. Exported shape kept tiny so the self-test below can drive it. */
function scanSource(file: string, source: string): { hits: Hit[]; parseErrors: string[] } {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKindFor(file));
  const diagnostics = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  const parseErrors = diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, ' '));
  const hits: Hit[] = [];
  const add = (rule: Rule, node: ts.Node) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    hits.push({ file, rule, line: line + 1, text: node.getText(sf).slice(0, 80) });
  };
  const isMath = (n: ts.Expression) => ts.isIdentifier(n) && n.text === 'Math';

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && DEMO_NAME.test(node.name.text)) {
      add('demo-const', node.name);
    }
    if (ts.isPropertyAccessExpression(node) && isMath(node.expression) && node.name.text === 'random') {
      add('math-random', node);
    }
    if (
      ts.isElementAccessExpression(node) && isMath(node.expression) &&
      ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === 'random'
    ) {
      add('math-random', node);
    }
    // `const { random } = Math` / `const { random: r } = Math`
    if (
      ts.isVariableDeclaration(node) && node.initializer && isMath(node.initializer) &&
      ts.isObjectBindingPattern(node.name)
    ) {
      for (const el of node.name.elements) {
        const prop = el.propertyName ?? el.name;
        if (el.dotDotDotToken || (ts.isIdentifier(prop) && prop.text === 'random')) add('math-random', el);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { hits, parseErrors };
}

describe('scanner self-test (the guard must see what it claims to see)', () => {
  const rules = (src: string, file = 'x.tsx') => scanSource(file, src).hits.map(h => h.rule);

  it('flags demo-named declarations', () => {
    expect(rules('const DEMO_POSITIONS = [1];')).toEqual(['demo-const']);
    expect(rules('export const MOCK_TRADES: number[] = [];')).toEqual(['demo-const']);
    expect(rules('let SAMPLE_DATA = 1; var FAKE_ROWS = 2; const PLACEHOLDER_X1 = 3;')).toEqual(['demo-const', 'demo-const', 'demo-const']);
    expect(rules('function f() { const MOCK_INNER = 1; return MOCK_INNER; }')).toEqual(['demo-const']);
  });

  it('flags every way of reaching Math.random', () => {
    expect(rules('const x = Math.random();')).toEqual(['math-random']);
    expect(rules('const r = Math.random; r();')).toEqual(['math-random']);
    expect(rules('const x = Math["random"]();')).toEqual(['math-random']);
    expect(rules('const x = Math . random ( );')).toEqual(['math-random']);
    expect(rules('const { random } = Math;')).toEqual(['math-random']);
    expect(rules('const { random: r, ...rest } = Math;')).toEqual(['math-random', 'math-random']);
    expect(rules('const el = <div>{Math.random()}</div>;')).toEqual(['math-random']);
    expect(rules('const u = "https://x.test/a"; const y = Math.random();')).toEqual(['math-random']);
  });

  it('does not flag comments, strings, or near-miss names', () => {
    expect(rules('// Math.random() used to live here\n/* const DEMO_X = 1 */\nconst a = 1;')).toEqual([]);
    expect(rules('const s = "Math.random()"; const t = `DEMO_X`;')).toEqual([]);
    expect(rules('const DEMONSTRATION = 1; const demoRows = 2; const MOCKED = 3; const IS_DEMO_MODE = 4;')).toEqual([]);
    expect(rules('const x = crypto.randomUUID(); const y = other.random();')).toEqual([]);
  });

  it('reports a file that does not parse instead of scanning what it can', () => {
    expect(scanSource('x.ts', 'const = ;;; {{{').parseErrors.length).toBeGreaterThan(0);
    expect(scanSource('x.ts', 'const a: number = 1;').parseErrors).toEqual([]);
  });
});

describe('no demo / mock / random data in src/app and src/components', () => {
  const walked: WalkResult = { codeFiles: [], problems: [] };
  for (const root of SCAN_ROOTS) walk(path.join(REPO_ROOT, root), walked);

  const hits: Hit[] = [];
  const problems = [...walked.problems];
  for (const file of walked.codeFiles) {
    let source: string;
    try {
      source = readFileSync(path.join(REPO_ROOT, file), 'utf8');
    } catch (err) {
      problems.push(`${file}: unreadable (${(err as Error).message})`);
      continue;
    }
    const result = scanSource(file, source);
    if (result.parseErrors.length > 0) {
      problems.push(`${file}: does not parse, so it cannot be scanned (${result.parseErrors[0]})`);
      continue;
    }
    hits.push(...result.hits);
  }

  const allowed = (h: Hit) => ALLOWLIST.some(a => a.file === h.file && a.rule === h.rule);

  it('actually scanned the tree', () => {
    // A guard that walks zero files passes forever. Both roots hold hundreds.
    expect(walked.codeFiles.length).toBeGreaterThan(200);
    expect(walked.codeFiles.some(f => f.startsWith('src/app/'))).toBe(true);
    expect(walked.codeFiles.some(f => f.startsWith('src/components/'))).toBe(true);
  });

  it('every file was a known type, readable and parseable', () => {
    expect(problems, `files the guard could not vouch for:\n  ${problems.join('\n  ')}\n`).toEqual([]);
  });

  it('has no un-allowlisted demo constants or Math.random references', () => {
    const offenders = hits.filter(h => !allowed(h)).map(h => `${h.file}:${h.line} [${h.rule}] ${h.text}`);
    expect(
      offenders,
      `demo data / randomness in shipped code. Remove it, or add a specific reason to ALLOWLIST:\n  ${offenders.join('\n  ')}\n`,
    ).toEqual([]);
  });

  it('every allowlist entry is specific and still needed', () => {
    for (const entry of ALLOWLIST) {
      expect(entry.reason.trim().length, `${entry.file}: allowlist reason is too thin`).toBeGreaterThan(30);
      expect(
        hits.some(h => h.file === entry.file && h.rule === entry.rule),
        `${entry.file} [${entry.rule}] is allowlisted but no longer has a hit — delete the entry`,
      ).toBe(true);
    }
    const keys = ALLOWLIST.map(a => `${a.file}|${a.rule}`);
    expect(new Set(keys).size, 'duplicate allowlist entries').toBe(keys.length);
  });
});
