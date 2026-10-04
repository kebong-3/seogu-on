// public/data 아래의 시설 GeoJSON 목록(경계·건물 모형·서식 파일 제외).
import { readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SKIP = [/admin-dongs\.geojson$/, /district\.geojson$/, /[\\/]model[\\/]/, /[\\/]templates[\\/]/, /-template\.geojson$/];

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
