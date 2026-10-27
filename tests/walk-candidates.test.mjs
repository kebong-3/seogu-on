import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,mkdir,copyFile,rm,symlink} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {loadWalkCandidates} from '../server/walk-candidates.js';
import {pointInRegion} from '../shared/region-profile.js';
import {pointInGeometry} from '../src/admin.js';
const publicRoot=fileURLToPath(new URL('../public/',import.meta.url));
const read=async path=>JSON.parse(await readFile(resolve(publicRoot,path.replace(/^\//,'')),'utf8'));
const selected=new Set(['shade','heat-shelters','police','emergency-bell','childcare','public-spaces']);
async function fixture(t,regionId='seogu'){
  const root=await mkdtemp(join(tmpdir(),'seo-walk-candidates-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const profile=await read(`/data/regions/${regionId}.json`),manifest=await read(`/data/decision/${regionId}/manifest.json`);
  const paths=new Set([`/data/regions/${regionId}.json`,profile.boundaryUrl,profile.facilitiesUrl,`/data/decision/${regionId}/manifest.json`,...manifest.datasets.filter(d=>selected.has(d.id)||d.id.startsWith('care-')).map(d=>d.path)]);
  for(const path of paths){const target=resolve(root,path.slice(1));await mkdir(dirname(target),{recursive:true});await copyFile(resolve(publicRoot,path.slice(1)),target);}
  return {root,profile,manifest,regionId};
}
async function rewriteSource(fixture,id,change){
  const {root,manifest,regionId}=fixture,descriptor=manifest.datasets.find(d=>d.id===id),path=resolve(root,descriptor.path.slice(1)),raw=JSON.parse(await readFile(path,'utf8'));
  change(raw);const bytes=JSON.stringify(raw);await writeFile(path,bytes);descriptor.sha256=createHash('sha256').update(bytes).digest('hex');
  await writeFile(resolve(root,`data/decision/${regionId}/manifest.json`),JSON.stringify(manifest));
}

test('key-free Seo-gu candidates are source-backed points inside actual polygons, excluding CCTV and lighting layers',async()=>{
  const pack=await loadWalkCandidates({regionId:'seogu',env:{}});
  assert.equal(pack.profile.id,'seogu');assert.equal(pack.candidates.length,777);
  assert.deepEqual(new Set(pack.candidates.map(c=>c.category)),new Set(['shade','shelter','police','bell','childcare','care','public']));
  assert.ok(pack.candidates.every(c=>pointInRegion(c.coordinate,pack.boundaries)&&pointInGeometry(c.coordinate,pack.geometry)));
  assert.ok(pack.candidates.every(c=>c.id&&c.name&&c.sourceName&&/^https?:/.test(c.sourceUrl)));
  assert.ok(pack.candidates.every(c=>c.note.includes('실제 출입구')&&typeof c.routeEligible==='boolean'));
  assert.ok(pack.candidates.filter(c=>c.category==='childcare').every(c=>c.sourceDate===null));
  assert.ok(pack.candidates.filter(c=>c.category==='police').every(c=>c.sourceDate===null));
  assert.ok(pack.candidates.filter(c=>c.category==='bell').every(c=>c.sourceDate==='2023-06-21'));
});

test('indoor emergency bells remain reference locations and cannot be selected for automatic or explicit routes',async()=>{
  const {candidates}=await loadWalkCandidates({regionId:'seogu',env:{}}),bells=candidates.filter(c=>c.category==='bell');
  assert.equal(bells.length,62);
  assert.ok(bells.every(c=>c.routeEligible===false&&c.modes.length===0));
  assert.ok(bells.some(c=>c.locationDescription==='여자화장실 내'&&c.note.includes('원문 설치위치: 여자화장실 내')));
  assert.ok(bells.every(c=>c.note.includes('경유지로 선택할 수 없는 참고 위치')));
});

test('Suncheon uses its own reviewed sources and preserves duplicate-source identities',async()=>{
  const pack=await loadWalkCandidates({regionId:'suncheon',env:{}});
  assert.equal(pack.profile.id,'suncheon');assert.equal(pack.boundaries.features.length,24);
  assert.equal(pack.candidates.filter(c=>c.category==='childcare').length,151);
  assert.ok(pack.candidates.every(c=>pointInRegion(c.coordinate,pack.boundaries)));
  assert.deepEqual(new Set(pack.candidates.map(c=>c.category)),new Set(['shade','childcare','public']));
  assert.equal(pack.sourceStatus.find(s=>s.category==='shade').duplicates,16);
  const duplicates=pack.candidates.filter(c=>c.sourceIds.length>1);
  assert.ok(duplicates.length>0);
  assert.ok(duplicates.every(c=>c.sourceIds.length===c.sourceRefs.length));
  assert.ok(pack.candidates.filter(c=>c.category==='shade').every(c=>c.sourceDate==='2026-09-22'));
});

test('actual administrative polygons are required: a point within the bounding box but outside the district is rejected',async t=>{
  const f=await fixture(t),original=await loadWalkCandidates({regionId:'seogu',env:{}}),[minX,minY,maxX,maxY]=f.profile.bounds;
  let outside;
  for(let x=1;x<20&&!outside;x++)for(let y=1;y<20;y++){const p=[minX+(maxX-minX)*x/20,minY+(maxY-minY)*y/20];if(!pointInRegion(p,original.boundaries)){outside=p;break;}}
  assert.ok(outside);
  await rewriteSource(f,'shade',raw=>{raw.features[0].geometry.coordinates=outside;});
  await assert.rejects(loadWalkCandidates({regionId:'seogu',env:{},publicRoot:f.root}),error=>error.code==='WALK_REGION_MISMATCH');
});

test('manifest, boundary identifiers and per-source region metadata cannot cross regions',async t=>{
  const f=await fixture(t);
  await rewriteSource(f,'shade',raw=>{raw.metadata.regionId='suncheon';});
  await assert.rejects(loadWalkCandidates({regionId:'seogu',env:{},publicRoot:f.root}),error=>error.code==='WALK_REGION_MISMATCH');
  const g=await fixture(t),path=resolve(g.root,g.profile.boundaryUrl.slice(1)),boundary=JSON.parse(await readFile(path,'utf8'));boundary.features[0].properties.sgg='12150';await writeFile(path,JSON.stringify(boundary));
  await assert.rejects(loadWalkCandidates({regionId:'seogu',env:{},publicRoot:g.root}),error=>error.code==='WALK_REGION_MISMATCH');
});

test('tampered hashes, cross-region file paths and symlinks cannot substitute a candidate source',async t=>{
  const f=await fixture(t),descriptor=f.manifest.datasets.find(d=>d.id==='shade'),path=resolve(f.root,descriptor.path.slice(1));await writeFile(path,JSON.stringify({type:'FeatureCollection',features:[],metadata:{}}));
  await assert.rejects(loadWalkCandidates({regionId:'seogu',env:{},publicRoot:f.root}),error=>error.code==='WALK_SOURCE_MISMATCH');
  const g=await fixture(t);g.manifest.datasets.find(d=>d.id==='shade').path='/data/decision/suncheon/shade.geojson';await writeFile(resolve(g.root,'data/decision/seogu/manifest.json'),JSON.stringify(g.manifest));
  await assert.rejects(loadWalkCandidates({regionId:'seogu',env:{},publicRoot:g.root}),error=>error.code==='WALK_REGION_MISMATCH');
  const h=await fixture(t),shadePath=resolve(h.root,'data/city/local-shade.geojson');await rm(shadePath);await symlink(resolve(publicRoot,'data/city/local-shade.geojson'),shadePath);
  await assert.rejects(loadWalkCandidates({regionId:'seogu',env:{},publicRoot:h.root}),error=>error.code==='INVALID_WALK_PATH');
});

test('identical duplicate records are merged but conflicting identities fail instead of moving a facility',async t=>{
  const f=await fixture(t);await rewriteSource(f,'shade',raw=>{raw.features.push(structuredClone(raw.features[0]));});
  const pack=await loadWalkCandidates({regionId:'seogu',env:{},publicRoot:f.root});assert.equal(pack.candidates.length,777);assert.equal(pack.sourceStatus.find(s=>s.datasetId==='shade').duplicates,1);
  const g=await fixture(t);await rewriteSource(g,'shade',raw=>{const duplicate=structuredClone(raw.features[0]);duplicate.properties.name+=' 충돌';raw.features.push(duplicate);});
  await assert.rejects(loadWalkCandidates({regionId:'seogu',env:{},publicRoot:g.root}),error=>error.code==='WALK_SOURCE_MISMATCH');
});

test('a declared unconnected source is unknown, with no fabricated waypoint or date',async t=>{
  const f=await fixture(t);await rewriteSource(f,'heat-shelters',raw=>{raw.features=[];raw.metadata.state='not-connected';});
  const pack=await loadWalkCandidates({regionId:'seogu',env:{},publicRoot:f.root});
  assert.equal(pack.candidates.filter(c=>c.category==='shelter').length,0);
  assert.equal(pack.sourceStatus.find(s=>s.category==='shelter').candidates,null);
  await assert.rejects(loadWalkCandidates({regionId:'unknown',env:{}}),error=>error.code==='REGION_NOT_REGISTERED');
});
