/* Reproducible local checks only, not production deployment or an authority's certification. */
import {readFile,stat,readdir,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const results=[];const check=(name,passed)=>results.push({name,passed:!!passed});
const pkg=JSON.parse(await readFile('package.json','utf8'));
const release=JSON.parse(await readFile('dist/data/release.json','utf8'));
check('Release identifier equals application version',release.version===pkg.version);
for(const p of ['src/city/finish-tools.js','src/city/layer-sync.js','src/city/local-records.js','data/city/civic-index.json','model.html','classic.html','src/city/space-twin.js','src/city/space-twin.css','src/city/pilot-measure.js','shared/space-twin-model.js','shared/region-profile.js','shared/pilot-measure.js','data/regions/seogu.json']){try{check('Built '+p,(await stat('dist/'+p)).size>0);}catch{check('Built '+p,false);}}
const config=JSON.parse(await readFile('vercel.json','utf8'));
check('Vercel preserves data file for geocode server',config.functions['api/geocode.js'].includeFiles==='public/data/address-records.json');
const data=JSON.parse(await readFile('public/data/city/civic-index.json','utf8'));
check('Civic index has 18 unique dong names',new Set(data.rows.map(r=>r.dongName)).size===18);
check('Civic index does not claim field verification',data.fieldVerified===false);
const sources=JSON.parse(await readFile('public/data/address-records.json','utf8'));
check('Pending coordinates are not fabricated',sources.records.every(r=>!r.coordinates));
async function walk(path){const files=[];for(const e of await readdir(path,{withFileTypes:true})){if(e.isDirectory())files.push(...await walk(path+'/'+e.name));else files.push(path+'/'+e.name);}return files;}
const paths=await walk('dist');
check('No secrets files or font files in web package',!paths.some(p=>/\.(?:ttf|otf|woff2?|eot)$|\/(?:\.env[^/]*|\.git\/|tests\/)/i.test(p)));
const digest=createHash('sha256');for(const p of paths.sort()){digest.update(p);digest.update(await readFile(p));}
await mkdir('docs/v061',{recursive:true});
await writeFile('docs/v061/RELEASE_AUDIT.json',JSON.stringify({scope:'local built files',version:pkg.version,webBundleSha256:digest.digest('hex'),results},null,2));
console.log(JSON.stringify({checks:results.length,passed:results.filter(r=>r.passed).length},null,2));
const http=spawnSync(process.execPath,['scripts/verify-release.mjs'],{stdio:'inherit'});
if(results.some(r=>!r.passed)||http.status!==0)process.exitCode=1;
