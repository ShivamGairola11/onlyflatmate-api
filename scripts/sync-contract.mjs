// Copies the API contract (and everything it imports) from the web app into ./contract.
//
//   npm run contract:sync                      # web app at ../basera
//   npm run contract:sync -- D:/path/to/web    # somewhere else
//
// The web app owns the contract; this repo keeps a copy so it builds on its own.
// Files keep their paths and `@/…` imports, which tsconfig maps onto ./contract.
// Run it whenever src/lib/api/contract.ts (or a type it uses) changes, then commit the diff.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';

const webRoot = resolve(process.argv[2] ?? '../basera');
const src = join(webRoot, 'src');
const out = resolve('contract');
// contact-info: the phone/email detector the API enforces on user-written text.
const ENTRIES = ['lib/api/contract.ts', 'lib/api/errors.ts', 'lib/validation/contact-info.ts', 'features/payments/upgrade.ts', 'features/payments/reply-guarantee.ts'];

if (!existsSync(join(src, ENTRIES[0]))) {
  console.error(`No contract at ${join(src, ENTRIES[0])}. Pass the web app's folder: npm run contract:sync -- <path>`);
  process.exit(1);
}

/** Resolve an import specifier to a file under src (relative to src), or null for packages. */
function resolveImport(fromFile, spec) {
  let base;
  if (spec.startsWith('@/')) base = spec.slice(2);
  else if (spec.startsWith('.')) base = posix.join(posix.dirname(fromFile), spec);
  else return null;
  for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, base]) {
    if (existsSync(join(src, candidate)) && candidate.endsWith('.ts')) return candidate;
  }
  throw new Error(`${fromFile}: can't resolve "${spec}"`);
}

const seen = new Set();
const queue = [...ENTRIES];
while (queue.length) {
  const file = queue.pop();
  if (seen.has(file)) continue;
  seen.add(file);
  const text = readFileSync(join(src, file), 'utf8');
  for (const [, spec] of text.matchAll(/(?:import|export)[^'"]*?from\s+["']([^"']+)["']/g)) {
    const dep = resolveImport(file, spec);
    if (dep) queue.push(dep);
  }
}

rmSync(out, { recursive: true, force: true });
for (const file of [...seen].sort()) {
  const target = join(out, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `// Synced from the web app (${posix.join('src', file)}) by scripts/sync-contract.mjs — do not edit here.\n${readFileSync(join(src, file), 'utf8')}`);
}
console.log(`Synced ${seen.size} files from ${relative(process.cwd(), src) || src} into contract/:\n  ${[...seen].sort().join('\n  ')}`);
