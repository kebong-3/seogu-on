// Legacy Seo-gu ingest/audit scope. Region packs have their own profile boundaries and validator.
// Never assign Seo-gu dong IDs or check a second region against Seo-gu geometry.
import { readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SKIP = [/admin-dongs\.geojson$/, /district\.geojson$/, /[\\/]model[\\/]/, /[\\/]templates[\\/]/, /[\\/]regions[\\/]/, /-template\.geojson$/];

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]);
}

export function facilityFiles(root) {
  const base = resolve(root, 'public/data');
  return walk(base)
    .filter(path => path.endsWith('.geojson') && !SKIP.some(pattern => pattern.test(path)))
    .map(path => relative(root, path).split('\\').join('/'))
    .sort();
}
