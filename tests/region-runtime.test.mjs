import test from 'node:test';
import assert from 'node:assert/strict';
import {regionLayers,supportsAction} from '../src/city/region-runtime.js';
import {allowLegacyRegion} from '../server/region-compat.js';
const profile={id:'other',name:'다른 지역',capabilities:{legacySeoguServices:false},facilityLayerId:'public-facilities',facilitiesUrl:'/data/regions/other-spaces.geojson'};
test('portable layer menu contains only the selected region data path',()=>{
 const ls=regionLayers(profile,[{id:'parks',url:'/data/seogu.json'}]);assert.equal(ls.length,1);assert.equal(ls[0].url,profile.facilitiesUrl);
});
test('legacy geography and model actions cannot run in another region',()=>{
 for(const a of ['civic-review','ask-ai','heat-plan','official-data','shade-calc','preset','tools'])assert.equal(supportsAction(profile,a),false);
 for(const a of ['space-twin','space-explain','pilot-measure','overview','list'])assert.equal(supportsAction(profile,a),true);
 assert.equal(supportsAction(profile,'engine',{engine:'clean'}),false);assert.equal(supportsAction(profile,'engine',{engine:'libre'}),true);
});
test('server legacy adapter stops before returning another region data',()=>{
 const res={setHeader(){},end(text){this.body=JSON.parse(text);}};
 assert.equal(allowLegacyRegion({},res,{REGION_PROFILE:'other'}),false);assert.equal(res.statusCode,503);assert.equal(res.body.code,'REGION_ADAPTER_NOT_CONFIGURED');
 assert.equal(allowLegacyRegion({},res,{REGION_PROFILE:'seogu'}),true);
});
