import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {careDirectoryHtml,careDirectoryRows,safeReturnGuide} from '../src/city/living-guide.js';
const read=async path=>JSON.parse(await readFile(new URL('../public'+path,import.meta.url),'utf8'));
test('care directory keeps every verified address and separates unlocated records from mapped points',async()=>{
 const data=await read('/data/decision/seogu/care-directory.json'),manifest=await read('/data/decision/seogu/manifest.json');
 assert.equal(data.entries.length,78);assert.equal(new Set(data.entries.map(r=>r.id)).size,78);
 assert.equal(careDirectoryRows(data).length,47);
 const points=[];for(const d of manifest.datasets.filter(d=>d.id.startsWith('care-'))){const bytes=await readFile(new URL('../public'+d.path,import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),d.sha256);points.push(...JSON.parse(bytes).features);}
 assert.equal(points.length,31);assert.ok(points.every(f=>f.properties.geometryMeaning&&f.properties.sourceUrl));
 assert.deepEqual(new Set(points.map(f=>f.properties.id)),new Set(data.entries.filter(r=>r.coordinates).map(r=>r.id)));
 assert.ok(data.entries.every(r=>r.address&&r.sourceName&&/^https:\/\//.test(r.sourceUrl)));
});
test('unlocated directory follows name/address and dataset filters without assigning a district or navigation point',()=>{
 const data={entries:[{id:'a',name:'센터A',address:'서구 길 1',category:'육아지원',datasetId:'parenting',coordinates:null},{id:'b',name:'센터B',address:'서구 길 2',category:'공동육아',datasetId:'parenting',coordinates:null},{id:'c',name:'지도시설',coordinates:[126.8,35.1]}]};
 assert.equal(careDirectoryRows(data,{datasetId:'parenting'}).length,2);
 const html=careDirectoryHtml(data,{query:'길 2',datasetId:'parenting',scopeIsAll:false});assert.match(html,/센터B/);assert.doesNotMatch(html,/센터A|지도에서 보기/);assert.match(html,/서구 전체/);
 assert.equal(careDirectoryRows(data,{datasetId:'childcare'}).length,0);
});
test('official return-home guide exposes the actual source and requests geometry instead of creating a line',async()=>{
 const ref=await read('/data/walk/seogu/safe-return-reference.json'),html=safeReturnGuide(ref);
 assert.equal(ref.routes.length,6);assert.equal(ref.geometryAvailable,false);assert.match(html,/\.show/);assert.match(html,/GeoJSON\/SHP/);assert.match(html,/광주서부경찰서/);
 assert.doesNotMatch(safeReturnGuide({routes:[{name:'<script>alert(1)</script>'}]}),/<script>/);
});
