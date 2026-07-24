// Shared test helpers: fixture loading and canonical hashing.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Every test file imports this module, so this makes "the suite never touches the
// network" an enforced property rather than an assumption. Code under test that needs
// HTTP takes an injected `fetchImpl`; anything reaching for the global has escaped its
// seam, and CI would otherwise fail intermittently on someone else's rate limit.
globalThis.fetch = () => {
  throw new Error('tests must not use the network - inject a fetchImpl instead');
};

export const GOLDEN_DIR = path.join(HERE, 'golden');
export const CATALOG_PATH = path.join(HERE, '..', 'src', 'data', 'items.catalog.json');

export function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

export function golden(name) {
  return readJson(path.join(GOLDEN_DIR, name));
}

export function catalogData() {
  return readJson(CATALOG_PATH);
}

/**
 * Serialize the way `json.dumps(..., ensure_ascii=False, sort_keys=True,
 * separators=(',', ':'))` does in the fixture generator, so digests computed on either
 * side of the port are comparable.
 */
export function canonical(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}
