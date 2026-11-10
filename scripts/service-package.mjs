#!/usr/bin/env node
/**
 * Scaffolds/refreshes a service package.json with the standard scripts.
 * Usage: node scripts/service-package.mjs <service-name> "<description>" [dep@range ...]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const [name, description, ...deps] = process.argv.slice(2);
if (!name || !description) {
  console.error('usage: service-package.mjs <service-name> "<description>" [dep@range ...]');
  process.exit(1);
}
const file = path.join('services', name, 'package.json');
const existing = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
const dependencies = { '@spendwise/common': '1.0.0', ...(existing.dependencies ?? {}) };
for (const dep of deps) {
  const at = dep.lastIndexOf('@');
  dependencies[dep.slice(0, at)] = dep.slice(at + 1);
}
const pkg = {
  name: `@spendwise/${name}`,
  version: '1.0.0',
  private: true,
  type: 'module',
  description,
  scripts: {
    start: 'node --import @spendwise/common/tracing src/index.js',
    dev: 'node --watch --import @spendwise/common/tracing src/index.js',
    'test:unit': 'vitest run tests/unit',
    'test:integration': 'vitest run tests/integration --passWithNoTests',
  },
  dependencies: Object.fromEntries(Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b))),
};
writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`wrote ${file}`);
