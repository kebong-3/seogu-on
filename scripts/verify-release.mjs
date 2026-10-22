/* Local build/routes/packaging checks. NOT Vercel deployment, live API, or WebGL validation. */
import {spawn} from 'node:child_process';
import {readFile,readdir,stat,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),dist=resolve(root,'dist'),checks=[];
const expectedVersion=JSON.parse(await readFile(resolve(root,'package.json'),'utf8')).version;
function check(name,passed,detail=''){checks.push({name,passed:Boolean(passed),detail});}
async function walk(dir){const out=[];for(const x of await readdir(dir,{withFileTypes:true})){const p=resolve(dir,x.name);if(x.isDirectory())out.push(...await walk(p));else out.push(p);}return out;}
const files=await walk(dist),bad=[];let count=0;
for(const p of files){if(['.json','.geojson'].includes(extname(p)))try{JSON.parse(await readFile(p,'utf8'));count++;}catch{bad.push(p.slice(dist.length+1));}}
check('All public JSON/GeoJSON parse',bad.length===0,`${count} files; invalid=${bad.length}`);
check('No font files bundled',!files.some(p=>/\.(woff2?|ttf|otf|eot)$/i.test(p)));
check('No private/test/server source in dist',!files.some(p=>/\/(?:\.env(?:\.|$)|tests\/|server\/|\.git\/)/.test(p.slice(dist.length))));
const missing=[];for(const p of files.filter(p=>p.startsWith(resolve(dist,'src'))&&p.endsWith('.js'))){const s=await readFile(p,'utf8');for(const m of s.matchAll(/(?:from\s*|import\s*\()(['"])(\.[^'"\n]+)\1/g)){const t=resolve(dirname(p),m[2]);try{await stat(t);}catch{missing.push(p.slice(dist.length+1)+': '+m[2]);}}}
check('Relative module imports resolve',missing.length===0,JSON.stringify(missing));
check('Cesium license included',files.includes(resolve(dist,'vendor/cesium/LICENSE.md')));
const port=Number(process.env.VERIFY_PORT||4197),url=`http://127.0.0.1:${port}`;
const env={...process.env,PORT:String(port),VWORLD_BROWSER_KEY:'',VWORLD_DOMAIN:'',VWORLD_API_KEY:'',KMA_SERVICE_KEY:'',DATA_GO_KR_SERVICE_KEY:'',AIRKOREA_SERVICE_KEY:'',SAFETYDATA_SERVICE_KEY:'',SAFETYDATA_KEYS_JSON:'{}',SAFETYDATA_LOCATION_INDEX_JSON:'{}',INFRA_SOURCES_JSON:'[]'};
Object.assign(env,{AI_PROVIDER:'google',AI_API_KEY:'',GEMINI_API_KEY:'',REGION_PROFILE:'seogu'});
for(const key of Object.keys(env))if(/^SAFETYDATA_\d+_KEY$/.test(key))env[key]='';
const child=spawn(process.execPath,['scripts/dev.mjs','--dist'],{cwd:root,env,stdio:['ignore','pipe','pipe']});
try{
 await new Promise((yes,no)=>{const t=setTimeout(()=>no(Error('Dev server did not start')),8000);child.stdout.once('data',()=>{clearTimeout(t);yes();});child.once('error',e=>{clearTimeout(t);no(e);});child.once('exit',c=>{clearTimeout(t);no(Error('Server exited '+c));});});
 async function route(path,expected,inspect){try{const r=await fetch(url+path,{signal:AbortSignal.timeout(8000)});let okay=r.status===expected;const body=await r.text();if(inspect)okay=okay&&inspect(body,r);check(path,okay,`HTTP ${r.status}`);}catch(e){check(path,false,e.message);}}
 await route('/',200,b=>b.includes('/src/city/app.js'));
 await route('/classic.html',200);
 await route('/model.html',200,b=>b.includes('/vendor/cesium/Cesium.js'));
 await route('/src/city/app.js',200,(_,r)=>r.headers.get('content-type').includes('javascript'));
 await route('/vendor/cesium/Cesium.js',200,(_,r)=>r.headers.get('content-type').includes('javascript'));
 await route('/vendor/cesium/Widgets/widgets.css',200);
 const worker=files.find(p=>p.includes('/vendor/cesium/Workers/')&&p.endsWith('.js'));
 if(worker)await route(worker.slice(dist.length),200);
 await route('/data/admin-dongs.geojson',200,b=>JSON.parse(b).features.length===18);
 await route('/data/city/coverage.json',200,b=>JSON.parse(b).version==='0.4.0');
 await route('/data/city/infra/school.geojson',200,b=>JSON.parse(b).features.length===104);
 await route('/data/city/model/buildings.geojson',200,b=>JSON.parse(b).features.length===5779);
 await route('/data/release.json',200,b=>JSON.parse(b).version===expectedVersion);
 await route('/data/city/civic-index.json',200,b=>JSON.parse(b).matchedDongCount===18);
 await route('/api/city-config',200,b=>JSON.parse(b).version===expectedVersion&&!b.includes('VWORLD_BROWSER_KEY='));
 await route('/brand/seogu-ci.png',200,(_,r)=>r.headers.get('content-type').includes('image'));
 await route('/brand/dongs.json',200,b=>JSON.parse(b).items.length===18);
 await route('/brand/dongs/seogu-18.png',200);
 await route('/data/city/local-shade.geojson',200,b=>JSON.parse(b).features.length===199);
 await route('/data/city/local-cooling.geojson',200,b=>JSON.parse(b).features.length===7);
 await route('/data/city/local-flood-history.geojson',200,b=>JSON.parse(b).features.length===468);
 await route('/data/city/source-roadmap.json',200,b=>JSON.parse(b).items.length===60);
 await route('/src/city/appearance.css',200);
 await route('/shared/space-twin-model.js',200,(_,r)=>r.headers.get('content-type').includes('javascript'));
 await route('/shared/region-profile.js',200);
 await route('/shared/pilot-measure.js',200);
 await route('/src/city/space-twin.js',200);
 await route('/src/city/pilot-measure.js',200);
 await route('/api/region-profile',200,b=>JSON.parse(b).profile.id==='seogu');
 await route('/api/space-review',405);
 const facilities=JSON.parse(await readFile(resolve(root,'public/data/layers/public-facilities.geojson'),'utf8'));
 const assetId=`public-facilities::${facilities.features[0].properties.id}`;
 const reviewResponse=await fetch(url+'/api/space-review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({regionId:'seogu',assetIds:[assetId],observations:{},query:{dayOfWeek:1,start:'18:00',end:'21:00'},scenarios:[]})});
 const review=await reviewResponse.json();check('Public-space POST recomputes unknown current state',reviewResponse.status===200&&review.mode==='rules'&&review.comparison?.baseline.unknownCount===1&&review.comparison?.baseline.eligibleCount===0);
 await route('/src/city/identity.css',200);
 await route('/brand/seogu-on-symbol.svg',200,b=>b.includes('<svg'));
 await route('/brand/seogu-on-wordmark.svg',200,b=>b.includes('서구:온'));
 await route('/src/city/safety-hub.js',200);
 await route('/api/city-data?kind=sd-cold&dong=all&page=1',503);
 await route('/api/city-data?kind=sd-beds&dong=all&page=1',503);
 await route('/api/city-data?kind=heat',503);
 await route('/api/city-data?kind=vw-c_up201&dong=all&page=1',503);
 await route('/api/city-data?kind=vw-unknown&dong=all',400);
 await route('/src/city/sun-engine.js',200);
 await route('/src/city/resilience-tools.js',200);
 await route('/src/city/vworld-catalog.js',200);
 await route('/api/city-data?kind=infra-cold',503);
 await route('/api/city-scene',503);
 await route('/api/weather?lon=126.85&lat=35.15',503);
 await route('/server/city/providers.js',404);
 await route('/.env.example',404);
 await route('/tools/safety-key-import.html',404);
 await route('/tests/city-v04.test.mjs',404);
 await route('/docs/v04/TEST_REPORT.md',404);
 const r=await fetch(url+'/api/city-config',{method:'POST'});check('Read-only API rejects POST',r.status===405,`HTTP ${r.status}`);
}finally{child.kill('SIGTERM');}
const result={mode:'Local built files + local HTTP; external API credentials absent; NOT GPU/Vercel',checks:checks.length,passed:checks.filter(c=>c.passed).length,results:checks};
await mkdir(resolve(root,'docs/v061'),{recursive:true});await writeFile(resolve(root,'docs/v061/DEPLOYMENT_CHECK.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({checks:result.checks,passed:result.passed,failures:checks.filter(c=>!c.passed)},null,2));if(result.passed!==result.checks)process.exitCode=1;
