import { mkdir, readdir, rm, copyFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const srcDir = path.join(root, 'src');
const distDir = path.join(root, 'dist');

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

await rm(distDir, { recursive: true, force: true });
await copyRecursive(srcDir, distDir);
console.log(`Built frontend to ${distDir}`);
