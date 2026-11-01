import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateFamilyOutingCollection,validateFamilyOutings} from '../scripts/validate-family-outings.mjs';
import {familyOutingRows,familyMapFeatures,familyOutingLinks} from '../src/city/family-outings.js';
import {facilityFiles} from '../scripts/data/lib/files.mjs';
import {fileURLToPath} from 'node:url';

const collection=JSON.parse(await readFile(new URL('../public/data/family/gwangju-outings.geojson',import.meta.url),'utf8'));
const find=id=>collection.features.find(f=>f.properties.id===id);

test('the supplied culture 1–42 and forest 1–45 lists resolve to all 86 distinct destinations',async()=>{
 const report=await validateFamilyOutings();
 assert.equal(report.destinations,86);
 assert.deepEqual(report.byDistrict,{'북구':32,'동구':5,'남구':12,'서구':17,'광산구':20});
 assert.match(report.dataSha256,/^[a-f0-9]{64}$/);
 assert.equal(familyOutingRows(collection).length,17);
 assert.equal(familyMapFeatures(familyOutingRows(collection)).length,16);
 assert.equal(familyOutingRows(collection,{district:'all'}).length,86);
 assert.ok(facilityFiles(fileURLToPath(new URL('../',import.meta.url))).every(path=>!path.includes('/family/')),'Gwangju destinations use their own gate, not the Seo-gu-only ingest');
});

test('conflicting addresses and protected areas are retained without fabricated directions',()=>{
 const river=find('forest-07'),wetland=find('culture-16'),office=find('culture-33');
 assert.equal(river.geometry,null);
 assert.equal(river.properties.address,'');
 assert.equal(familyOutingLinks(river).route,null);
 assert.doesNotMatch(decodeURIComponent(familyOutingLinks(river).search),/칠성로|삼삼/);
 for(const feature of [wetland,office]){
  assert.equal(feature.properties.directionPolicy,'confirm-first');
  assert.equal(familyOutingLinks(feature).route,null);
  assert.ok(familyOutingLinks(feature).website);
 }
 for(const id of ['forest-10','forest-20','forest-28','forest-30','forest-34','forest-36','forest-39'])assert.equal(familyOutingLinks(find(id)).route,null,id);
});

test('park and child-forest destinations remain separate and the conflated building name is corrected',()=>{
 for(const pair of [['forest-01','culture-35'],['forest-13','forest-14'],['forest-34','forest-39']]){
  assert.ok(pair.every(id=>find(id)));
  assert.notEqual(find(pair[0]).properties.name,find(pair[1]).properties.name);
 }
 assert.equal(find('culture-17').properties.name,'전일빌딩245');
 assert.ok(find('culture-17').properties.sourceRefs.some(r=>r.originalName.includes('옛 전남도청')));
 assert.equal(familyOutingRows(collection,{district:'all',query:'옛 전남도청'}).length,0);
 assert.equal(familyOutingRows(collection,{district:'all',query:'솔로몬파크'})[0]?.properties.id,'culture-07');
 assert.equal(familyOutingRows(collection,{district:'all',query:'유적'})[0]?.properties.id,'culture-37');
 assert.ok(familyOutingRows(collection,{district:'서구',query:'유적'}).some(f=>f.properties.id==='forest-32'));
});

test('the release validator rejects lost book coverage, duplicate destinations and unsupported coordinates',()=>{
 const copy=()=>structuredClone(collection);
 let data=copy();data.features.pop();assert.throws(()=>validateFamilyOutingCollection(data),/86 destinations/);
 data=copy();data.features[1].id=data.features[0].id;data.features[1].properties.id=data.features[0].properties.id;assert.throws(()=>validateFamilyOutingCollection(data),/duplicate/);
 data=copy();data.features[0].properties.coordinateSource.url='';assert.throws(()=>validateFamilyOutingCollection(data),/coordinate evidence/);
 data=copy();data.features[0].geometry.coordinates=[35.1,126.8];assert.throws(()=>validateFamilyOutingCollection(data),/outside/);
 data=copy();data.features.find(f=>f.properties.id==='culture-02').properties.sourceRefs[0].number=500;assert.throws(()=>validateFamilyOutingCollection(data),/source list coverage/);
});
