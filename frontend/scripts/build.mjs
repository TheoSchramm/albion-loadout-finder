// Build the deployable site into dist/.
//
// There is no bundler or transpiler: the app is plain ES modules that browsers load
// directly, so "building" is a file copy plus the two files GitHub Pages needs and a set
// of guards that fail the build rather than shipping something subtly broken.

import { mkdir, readdir, rm, copyFile, stat, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const srcDir = path.join(root, 'src');
const distDir = path.join(root, 'dist');

// The catalog is the only large asset. A sudden jump means upstream changed shape and
// every visitor would pay for it.
const CATALOG_BUDGET_BYTES = 1.5 * 1024 * 1024;

async function copyRecursive(source, target) {
  const stats = await stat(source);
  if (stats.isDirectory()) {
    await mkdir(target, { recursive: true });
    for (const entry of await readdir(source)) {
      await copyRecursive(path.join(source, entry), path.join(target, entry));
    }
    return;
  }
  await copyFile(source, target);
}

async function collectFiles(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await collectFiles(full)));
    } else {
      found.push(full);
    }
  }
  return found;
}

/**
 * Fail on anything that assumes the site is served from a domain root.
 *
 * GitHub Pages serves project sites from https://user.github.io/<repo>/, so a
 * root-relative "/app.js" or a URL built against window.location.origin resolves to the
 * wrong place - and does so only in production, where it is most annoying to discover.
 * The original app had exactly this bug in its apiUrl() helper; this keeps it gone.
 */
async function assertNoAbsolutePaths(files) {
  const problems = [];
  for (const file of files) {
    if (!/\.(html|js|css)$/.test(file)) continue;
    const text = await readFile(file, 'utf8');
    const relative = path.relative(distDir, file);
    if (text.includes('window.location.origin')) {
      problems.push(`${relative}: uses window.location.origin, which drops the /<repo>/ prefix`);
    }
    // src="/..." or href="/..." but not "//host" (protocol-relative) and not "./".
    const rootRelative = text.match(/\b(?:src|href)="\/(?!\/)/g);
    if (rootRelative) {
      problems.push(`${relative}: ${rootRelative.length} root-relative asset path(s)`);
    }
  }
  return problems;
}

async function assertCatalogBudget(files) {
  const catalog = files.find((file) => file.endsWith('items.catalog.json'));
  if (!catalog) {
    return ['data/items.catalog.json is missing - run `npm run build:catalog` first'];
  }
  const { size } = await stat(catalog);
  if (size > CATALOG_BUDGET_BYTES) {
    return [
      `catalog is ${(size / 1024 / 1024).toFixed(2)} MB, over the ` +
        `${(CATALOG_BUDGET_BYTES / 1024 / 1024).toFixed(2)} MB budget`,
    ];
  }
  return [];
}

/**
 * Stamps the deploy date into the "Updated" line in the sidebar, so visitors can tell
 * when the site was last redeployed without checking GitHub. src/index.html ships with
 * the placeholder committed as "dev" - `npm run dev` serves that file directly, so a local
 * dev server honestly shows "not a real deployed build" rather than a stale or fake date.
 */
async function stampBuildDate(distDir) {
  const indexPath = path.join(distDir, 'index.html');
  const html = await readFile(indexPath, 'utf8');
  const buildDate = new Date().toISOString().slice(0, 10);
  const stamped = html.replace('<span id="appBuildDate">dev</span>', `<span id="appBuildDate">${buildDate}</span>`);
  await writeFile(indexPath, stamped);
}

await rm(distDir, { recursive: true, force: true });
await copyRecursive(srcDir, distDir);
await stampBuildDate(distDir);

// Tells GitHub Pages to serve the tree as-is. Without it Jekyll processes the site and
// silently drops anything whose path starts with an underscore.
await writeFile(path.join(distDir, '.nojekyll'), '');

// Pages serves 404.html for unknown paths. The app has no client-side router, so this is
// only for mistyped deep links - but a styled page beats GitHub's default.
await copyFile(path.join(distDir, 'index.html'), path.join(distDir, '404.html'));

const files = await collectFiles(distDir);
const problems = [...(await assertNoAbsolutePaths(files)), ...(await assertCatalogBudget(files))];

if (problems.length > 0) {
  console.error('\nBuild failed:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

const totalBytes = (await Promise.all(files.map(async (file) => (await stat(file)).size))).reduce(
  (sum, size) => sum + size,
  0,
);
console.log(`Built frontend to ${distDir}`);
console.log(`  ${files.length} files, ${(totalBytes / 1024).toFixed(0)} KB total`);
