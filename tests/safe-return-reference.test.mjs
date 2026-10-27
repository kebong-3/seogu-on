import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const reference=JSON.parse(readFileSync(new URL('../public/data/walk/seogu/safe-return-reference.json',import.meta.url),'utf8'));
const officialUrl=raw=>{
  const url=new URL(raw);
  assert.equal(url.protocol,'https:');
  assert.equal(url.hostname,'www.gjpolice.go.kr');
  assert.equal(url.username,'');
  assert.equal(url.password,'');
  return url;
};

test('safe return reference identifies the August 2026 official Seo-gu map and its attachment',()=>{
  assert.match(reference.sourceName,/광주경찰청/);
  assert.match(reference.sourceName,/서부경찰서/);
  assert.equal(reference.sourceDate,'2026-08');
  assert.equal(reference.publishedAt,'2026-08-24');
  const source=officialUrl(reference.sourceUrl);
  assert.equal(source.pathname,'/cop/bbs/selectBoardArticle.do');
  assert.equal(source.searchParams.get('bbsId'),'BBSMSTR_000000000742');
  assert.equal(source.searchParams.get('nttId'),'58903');
  const attachment=officialUrl(reference.attachmentUrl);
  assert.equal(attachment.pathname,'/cmm/fms/FileDown.do');
  assert.equal(attachment.searchParams.get('atchFileId'),'FILE_000000000030728');
  assert.equal(attachment.searchParams.get('fileSn'),'0');
});

test('safe return reference preserves all six official names without treating map descriptions as endpoints',()=>{
  assert.deepEqual(reference.routes.map(route=>route.name),['금호1','금호2','금호3','화정1','화정2','농성1']);
  assert.equal(new Set(reference.routes.map(route=>route.id)).size,6);
  for(const route of reference.routes){
    assert.match(route.id,/^seogu-safe-return-[a-z]+-[1-3]$/);
    assert.match(route.area,/공식 지도를 판독한 주변 설명/);
    assert.match(route.area,/시종점 주소가 아닙니다/);
    assert.equal(officialUrl(route.sourceUrl).href,officialUrl(reference.sourceUrl).href);
  }
});

test('map-only official references contain no invented coordinates, route geometry or embedded map images',()=>{
  assert.equal(reference.geometryAvailable,false);
  assert.equal(reference.georeferencingStatus,'official-map-only');
  const forbidden=new Set(['geometry','coordinates','latitude','longitude','lat','lon','start','end','distanceMeters','durationSeconds','image','imageUrl','imageData','polyline','geojson']);
  const inspect=value=>{
    if(Array.isArray(value)){for(const entry of value)inspect(entry);return;}
    if(!value||typeof value!=='object')return;
    for(const [key,entry]of Object.entries(value)){assert.equal(forbidden.has(key),false,`Map-only reference must not invent ${key}`);inspect(entry);}
  };
  inspect(reference);
  assert.doesNotMatch(JSON.stringify(reference),/data:image|LineString|FeatureCollection/);
});
