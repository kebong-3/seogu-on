import {ensureRuntime} from './ensure-runtime.mjs';
import {collectSafetySnapshots} from './collect-safety-snapshots.mjs';
await ensureRuntime();
import {createHash} from 'node:crypto';
import { mkdir, cp, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {REGION_CATALOG} from '../shared/region-catalog.js';
import {loadRegionData} from '../server/region-profile.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'dist');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(resolve(root, 'index.html'), resolve(out, 'index.html'));
await cp(resolve(root, 'classic.html'), resolve(out, 'classic.html'));
await cp(resolve(root, 'src'), resolve(out, 'src'), { recursive: true });
await cp(resolve(root, 'shared'), resolve(out, 'shared'), { recursive: true });
await cp(resolve(root, 'public'), out, { recursive: true });
await collectSafetySnapshots(out);
const pkg=JSON.parse(await readFile(resolve(root,'package.json'),'utf8'));
const digest=createHash('sha256');
async function hashFiles(dir){for(const entry of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const path=resolve(dir,entry.name);if(entry.isDirectory())await hashFiles(path);else{digest.update(path.slice(root.length));digest.update(await readFile(path));}}}
for(const dir of ['src','shared','server','api'])await hashFiles(resolve(root,dir));
const official=JSON.parse(await readFile(resolve(root,'public/data/city/official-collection.json'),'utf8'));
const regions=[];
for(const region of REGION_CATALOG){const pack=await loadRegionData({regionId:region.id});regions.push({id:region.id,name:pack.profile.fullName,districts:pack.report.counts.districts,spaces:pack.report.counts.facilities,boundaryDate:pack.profile.source.asOf,spaceSourceDate:pack.facilities.metadata.sourceDate||null,coveredDistricts:new Set(pack.facilities.features.map(f=>f.properties.dongId).filter(Boolean)).size,verifiedDataPack:true,sample:pack.profile.sample});}
await writeFile(resolve(out,'data/release.json'),JSON.stringify({version:pkg.version,builtAt:new Date().toISOString(),codeSha256:digest.digest('hex'),regions,datasetVersion:`Seo-gu and Suncheon public data packs. Seo-gu official public snapshots: ${official.datasetCount} datasets / ${official.recordCount} map records; existing local records retained. API catalogues are not received API data.`,officialCollection:{datasetCount:official.datasetCount,recordCount:official.recordCount,collectedAt:official.collectedAt,manifestSha256:createHash('sha256').update(await readFile(resolve(root,'public/data/city/official-collection.json'))).digest('hex')},meaning:'Build identifier and included public snapshot counts only. Not proof of deployed API authentication, current facility operation or source data freshness.'},null,2));
// Never copy .env, server source, test fixtures or development files to the public bundle.
console.log('SEO:ON static build complete: dist/ (zero build dependencies).');
console.log('Vercel handles root api/*.js separately. Map rendering requires external map/CDN access.');
