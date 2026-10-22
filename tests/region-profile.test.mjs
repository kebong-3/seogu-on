import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DEFAULT_REGION_PROFILE, validateRegionProfile, validateRegionDataPack, safePublicDataPath, pointInRegion, validSourceDate} from '../shared/region-profile.js';
import {loadRegionProfile, loadRegionData, handleRegionProfile} from '../server/region-profile.js';
import {validateRegionDirectory} from '../scripts/validate-region.mjs';

const clone = value => JSON.parse(JSON.stringify(value));
const source = {sourceName: '합성 구조시험 데이터 · 실지역 아님', sourceUrl: 'https://example.org/synthetic-data', sourceDate: '2026-10-22'};
function syntheticPack() {
  const profile = {...clone(DEFAULT_REGION_PROFILE), id: 'synthetic-b', name: '합성지역 B', fullName: 'SAMPLE · 합성지역 B', jurisdictionCode: 'SYN02', codeSystem: 'SYNTHETIC', bounds: [127,36,127.02,36.02], center: [127.01,36.01], boundaryUrl: '/data/regions/synthetic-b/admin-boundaries.geojson', facilitiesUrl: '/data/regions/synthetic-b/facilities.geojson', districtCount: 2, capabilities: {spaceTwin: true, legacySeoguServices: false}, sample: true, serviceCodes: {}};
  const district = (id, min, max) => ({type: 'Feature', properties: {dongId: id, dongName: id, labelPoint: [(min + max)/2,36.01]}, geometry: {type: 'Polygon', coordinates: [[[min,36],[max,36],[max,36.02],[min,36.02],[min,36]]]}});
  const facility = (id, x, dongId) => ({type: 'Feature', properties: {id, name: id, dongId, sourceDate: '2026-10-22'}, geometry: {type: 'Point', coordinates: [x,36.01]}});
  return {profile, boundaries: {type: 'FeatureCollection', metadata: {...source}, features: [district('b-01',127,127.01), district('b-02',127.01,127.02)]}, facilities: {type: 'FeatureCollection', metadata: {...source}, features: [facility('room:01',127.005,'b-01'), facility('room:02',127.015,'b-02')]}};
}
async function temporaryRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'seo-region-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  return root;
}
async function writePack(root, pack) {
  await mkdir(join(root, 'data', 'regions', pack.profile.id), {recursive: true});
  await writeFile(join(root, 'data', 'regions', `${pack.profile.id}.json`), JSON.stringify(pack.profile));
  await writeFile(join(root, pack.profile.boundaryUrl.slice(1)), JSON.stringify(pack.boundaries));
  await writeFile(join(root, pack.profile.facilitiesUrl.slice(1)), JSON.stringify(pack.facilities));
}

test('default profile preserves 18 Seo-gu districts and 58 published spaces', async () => {
  const result = await loadRegionData({env: {}});
  assert.equal(result.profile.id, 'seogu');
  assert.equal(result.profile.codeSystem, 'MOIS-ADM');
  assert.equal(result.profile.jurisdictionCode, '12240');
  assert.ok(result.boundaries.features.every(feature=>feature.properties.adm_cd2.startsWith(result.profile.jurisdictionCode)));
  assert.match(result.profile.source.note, /adm_cd2 앞 5자리/);
  assert.deepEqual(result.profile.serviceCodes, {taasSido: '29', taasGugun: '140'});
  assert.equal(result.profile.facilityLayerId, 'public-facilities');
  assert.deepEqual(result.profile.bounds, DEFAULT_REGION_PROFILE.bounds);
  assert.equal(result.report.counts.districts, 18);
  assert.equal(result.report.counts.facilities, 58);
  assert.deepEqual(result.report.warnings, []);
});

test('the same validator accepts a second synthetic region without Seo-gu IDs or bounds', () => {
  const pack = syntheticPack(), result = validateRegionDataPack(pack);
  assert.equal(result.regionId, 'synthetic-b');
  assert.equal(result.counts.districts, 2);
  assert.equal(result.counts.facilities, 2);
  assert.equal(result.sample, true);
  assert.match(result.warnings[0], /합성/);
  assert.equal(pointInRegion([127.015,36.01],pack.boundaries), true);
  assert.equal(pointInRegion([126.855,35.14],pack.boundaries), false);
});

test('profile paths reject upstream URLs, traversal, encoding, query routes and ambiguous slashes', () => {
  for (const value of ['https://example.org/f.json','//evil.test/a.json','/data/../a.json','/data/%2e%2e/a.json','/data//x.json','/data/x.json?token=a','/data/x.json#x','/api/weather','/data/./x.json']) assert.throws(() => safePublicDataPath(value));
  assert.equal(safePublicDataPath('/data/regions/my-city/facilities.geojson'), '/data/regions/my-city/facilities.geojson');
});

test('profile whitelist excludes credentials and rejects poisoned or executable properties', () => {
  assert.throws(() => validateRegionProfile({...clone(DEFAULT_REGION_PROFILE), apiKey: 'private'}));
  const polluted = JSON.parse(JSON.stringify(DEFAULT_REGION_PROFILE).slice(0,-1) + ',"__proto__":{"polluted":true}}');
  assert.throws(() => validateRegionProfile(polluted));
  const getter = clone(DEFAULT_REGION_PROFILE); Object.defineProperty(getter, 'name', {get() { throw Error('getter invoked'); }, enumerable: true});
  assert.throws(() => validateRegionProfile(getter), /허용하지 않는 속성/);
  assert.equal({}.polluted, undefined);
});

test('profiles keep code systems explicit and cannot activate Seo-gu services for a different region', () => {
  assert.throws(() => validateRegionProfile({...clone(DEFAULT_REGION_PROFILE), codeSystem: undefined}));
  assert.throws(() => validateRegionProfile({...clone(DEFAULT_REGION_PROFILE), id: 'another-city'}), /서구 전용/);
  const p = validateRegionProfile(syntheticPack().profile);
  assert.equal(p.capabilities.legacySeoguServices, false);
  assert.equal(p.layerMappings['public-facilities'].url, p.facilitiesUrl);
  assert.throws(() => validateRegionProfile({...p, layerMappings: {'public-facilities': {url:'/data/another.json',available:true}}}));
});

test('profile bounds, center, dates, IDs and source URLs are validated', () => {
  const cases = [{bounds:[127,36,126,35]}, {center:[0,0]}, {districtCount:0}, {id:'../seogu'}, {source:{name:'a',url:'javascript:alert(1)',asOf:null}}, {source:{name:'a',url:'https://user:secret@example.org/data',asOf:null}}, {source:{name:'a',url:'https://example.org/',asOf:'2026-02-30'}}];
  for (const patch of cases) assert.throws(() => validateRegionProfile({...clone(DEFAULT_REGION_PROFILE),...patch}));
  assert.equal(validSourceDate('2024-02-29'),true); assert.equal(validSourceDate('2026-02-29'),false);
});

test('package coordinates, CRS, duplicate IDs and source metadata fail before adoption', () => {
  const mutations = [
    p=>p.facilities.features[0].geometry.coordinates=[35,127],
    p=>p.facilities.features[0].geometry.coordinates=[127.03,36.01],
    p=>p.facilities.features[0].geometry.type='LineString',
    p=>p.facilities.features.push(clone(p.facilities.features[0])),
    p=>p.facilities.crs={type:'name',properties:{name:'EPSG:3857'}},
    p=>delete p.facilities.metadata.sourceName,
    p=>p.facilities.features[0].properties.sourceDate='2026-99-01',
    p=>p.facilities.features[0].id='different-id',
    p=>p.facilities.features[0].properties.dongId='b-02',
  ];
  for (const mutate of mutations) { const pack=syntheticPack(); mutate(pack); assert.throws(()=>validateRegionDataPack(pack)); }
});

test('missing operating data or source dates stay unknown rather than becoming empty or closed facts', () => {
  const pack=syntheticPack(); delete pack.facilities.metadata.sourceDate; delete pack.facilities.features[0].properties.sourceDate;
  const result=validateRegionDataPack(pack);
  assert.equal(result.counts.facilities,2);
  assert.ok(result.warnings.some(item=>item.includes('개별 기준일')));
  assert.equal(pack.facilities.features[0].properties.hours,undefined);
  assert.equal(pack.facilities.features[0].properties.operatingStatus,undefined);
});

test('boundary count, rings, zero area, label positions and holes are not silently repaired', () => {
  const mutations = [p=>p.profile.districtCount=3, p=>p.boundaries.features[0].geometry.coordinates[0].pop(), p=>p.boundaries.features[0].properties.labelPoint=[127.015,36.01], p=>p.boundaries.features[0].geometry.coordinates=[[[127,36],[127,36],[127,36],[127,36]]]];
  for (const mutate of mutations) {const p=syntheticPack();mutate(p);assert.throws(()=>validateRegionDataPack(p));}
  const p=syntheticPack();p.boundaries.features[0].properties.labelPoint=[127.002,36.002];
  p.boundaries.features[0].geometry.coordinates.push([[127.004,36.009],[127.006,36.009],[127.006,36.011],[127.004,36.011],[127.004,36.009]]);
  assert.equal(pointInRegion([127.005,36.01],p.boundaries),false);
  assert.throws(()=>validateRegionDataPack(p),/행정경계 밖/);
});

test('deployment loading selects an explicit profile and never silently falls back', async t => {
  const root=await temporaryRoot(t),pack=syntheticPack(); await writePack(root,pack);
  await assert.rejects(loadRegionProfile({env:{REGION_PROFILE:'../seogu'},publicRoot:root}));
  await assert.rejects(loadRegionProfile({env:{REGION_PROFILE:'missing'},publicRoot:root}),{code:'REGION_FILE_NOT_FOUND'});
  await assert.rejects(loadRegionProfile({env:{REGION_PROFILE:'synthetic-b'},publicRoot:root}),{code:'SAMPLE_REGION_NOT_ENABLED'});
  const actual=await loadRegionData({env:{REGION_PROFILE:'synthetic-b'},publicRoot:root,allowSample:true});
  assert.equal(actual.report.regionId,'synthetic-b');assert.equal(actual.report.counts.facilities,2);
  pack.profile.id='other-id';await writeFile(join(root,'data/regions/synthetic-b.json'),JSON.stringify(pack.profile));
  await assert.rejects(loadRegionProfile({env:{REGION_PROFILE:'synthetic-b'},publicRoot:root,allowSample:true}),/일치하지/);
});

test('server refuses public-data symlinks that escape the configured root', async t => {
  const root=await temporaryRoot(t),outside=await temporaryRoot(t),pack=syntheticPack(); await writePack(root,pack);
  const outsideFile=join(outside,'facilities.json');await writeFile(outsideFile,JSON.stringify(pack.facilities));
  const insideFile=join(root,pack.profile.facilitiesUrl.slice(1));await rm(insideFile);await symlink(outsideFile,insideFile);
  await assert.rejects(loadRegionData({env:{REGION_PROFILE:'synthetic-b'},publicRoot:root,allowSample:true}),{code:'INVALID_REGION_PATH'});
});

test('directory validation exercises the documented portable bundle format',async t=>{
  const root=await temporaryRoot(t),pack=syntheticPack();
  for(const [name,value] of Object.entries({'manifest.json':pack.profile,'admin-boundaries.geojson':pack.boundaries,'facilities.geojson':pack.facilities}))await writeFile(join(root,name),JSON.stringify(value));
  const report=await validateRegionDirectory(root);assert.equal(report.regionId,'synthetic-b');assert.equal(report.counts.districts,2);
});

function response(){return {statusCode:0,headers:{},setHeader(k,v){this.headers[k]=v;},end(value){this.body=JSON.parse(value);}};}
test('region endpoint is read-only, same-origin and returns sanitized public config',async()=>{
  const res=response();await handleRegionProfile({method:'GET',headers:{host:'example.org'}},res,{env:{}});
  assert.equal(res.statusCode,200);assert.equal(res.body.profile.id,'seogu');assert.equal(res.headers['Cache-Control'],'no-store');
  assert.equal(JSON.stringify(res.body).includes('API_KEY'),false);
  const post=response();await handleRegionProfile({method:'POST',headers:{host:'example.org'}},post);assert.equal(post.statusCode,405);
  const other=response();await handleRegionProfile({method:'GET',headers:{host:'example.org',origin:'https://evil.example'}},other);assert.equal(other.statusCode,403);
  const invalid=response();await handleRegionProfile({method:'GET',headers:{host:'example.org'}},invalid,{env:{REGION_PROFILE:'missing'}});assert.equal(invalid.statusCode,503);assert.equal(invalid.body.code,'REGION_FILE_NOT_FOUND');assert.equal(JSON.stringify(invalid.body).includes('/workspace/'),false);
});
