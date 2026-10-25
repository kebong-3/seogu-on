import test from 'node:test';
import assert from 'node:assert/strict';
import {regionLayers,supportsAction,initialMapEngine,regionMapConfig} from '../src/city/region-runtime.js';
import {allowLegacyRegion} from '../server/region-compat.js';
const profile={id:'other',name:'다른 지역',capabilities:{legacySeoguServices:false},facilityLayerId:'public-facilities',facilitiesUrl:'/data/regions/other-spaces.geojson'};
test('portable layer menu contains only the selected region data path',()=>{
 const ls=regionLayers(profile,[{id:'parks',url:'/data/seogu.json'}]);assert.equal(ls.length,1);assert.equal(ls[0].url,profile.facilitiesUrl);
});
test('legacy geography and model actions cannot run in another region',()=>{
 for(const a of ['civic-review','heat-plan','official-data','shade-calc','preset','tools'])assert.equal(supportsAction(profile,a),false);
 for(const a of ['space-twin','space-explain','space-from-question','ask-ai','ask-retry','ask-prepare-space','region-chooser','pilot-measure','overview','list'])assert.equal(supportsAction(profile,a),true);
 assert.equal(supportsAction(profile,'engine',{engine:'clean'}),false);assert.equal(supportsAction(profile,'engine',{engine:'libre'}),true);
 assert.equal(supportsAction(profile,'engine',{engine:'vworld'}),true);
});
test('both regions start VWorld while explicitly selected alternative maps remain selected',()=>{
 const local={capabilities:{legacySeoguServices:true}};
 for(const p of [local,profile]){
  for(const search of ['', '?work=care', '?work=safety','?map=vworld','?map=unknown'])assert.equal(initialMapEngine(p,search),'vworld');
  for(const map of ['boundary','libre'])assert.equal(initialMapEngine(p,`?map=${map}&work=care`),map);
 }
 assert.equal(initialMapEngine(local,'?map=clean'),'clean');assert.equal(initialMapEngine(profile,'?map=clean'),'vworld');
});
test('portable VWorld shares only basemap availability and keeps Seo-gu data adapters disabled',()=>{
 const shared={configured:{vworld3d:true,weather:true,'infra-children':true,safemap:true},bounds:[126.8,35,126.9,35.2],safetySources:['seogu']};
 const portable=regionMapConfig(profile,shared);
 assert.deepEqual(portable.configured,{vworld3d:true});assert.equal(portable.bounds,undefined);assert.equal(portable.safetySources,undefined);
 assert.equal(regionMapConfig({capabilities:{legacySeoguServices:true}},shared),shared);
});
test('server legacy adapter stops before returning another region data',()=>{
 const res={setHeader(){},end(text){this.body=JSON.parse(text);}};
 assert.equal(allowLegacyRegion({},res,{REGION_PROFILE:'other'}),false);assert.equal(res.statusCode,503);assert.equal(res.body.code,'REGION_ADAPTER_NOT_CONFIGURED');
 assert.equal(allowLegacyRegion({},res,{REGION_PROFILE:'seogu'}),true);
});
