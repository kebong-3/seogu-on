import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
async function walk(path) {
  for (const item of await readdir(path, { withFileTypes: true })) {
    const file = `${path}/${item.name}`;
    if (item.isDirectory()) await walk(file);
    else if (/\.(js|mjs)$/.test(file)) {
      const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
      if (result.status !== 0) process.exit(result.status || 1);
    }
  }
}
for (const path of ['src', 'shared', 'api', 'server', 'scripts', 'tests']) await walk(path);
console.log('All JavaScript syntax checks passed.');
