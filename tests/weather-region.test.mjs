import test from 'node:test';
import assert from 'node:assert/strict';
import weather from '../api/weather.js';
import {readWeather,kmaGrid,weatherBase} from '../server/weather-service.js';

const now=new Date('2026-10-23T01:15:00Z');
const env={KMA_SERVICE_KEY:'SHARED_KEY_TEST_ONLY'};
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},end(raw){this.body=JSON.parse(raw);}});
const request=query=>({method:'GET',url:'/api/weather?'+new URLSearchParams(query),headers:{host:'localhost'}});
const observations=(grid,temperature,time=now)=>({response:{header:{resultCode:'00'},body:{items:{item:[
 {baseDate:weatherBase(time).base_date,baseTime:weatherBase(time).base_time,nx:String(grid.nx),ny:String(grid.ny),category:'T1H',obsrValue:String(temperature)},
 {baseDate:weatherBase(time).base_date,baseTime:weatherBase(time).base_time,nx:String(grid.nx),ny:String(grid.ny),category:'RN1',obsrValue:'0'},
]}}}});

test('weather: Suncheon and Seo-gu use the shared KMA key with separate requested grids and caches',async()=>{
 const calls=[];
 const fetcher=async raw=>{
  const url=new URL(raw);const grid={nx:Number(url.searchParams.get('nx')),ny:Number(url.searchParams.get('ny'))};
  assert.equal(url.searchParams.get('serviceKey'),'SHARED_KEY_TEST_ONLY');calls.push(grid);
  return new Response(JSON.stringify(observations(grid,grid.nx===68?18:11)),{headers:{'content-type':'application/json'}});
 };
 const suncheon=response();await weather(request({regionId:'suncheon',lon:127.38441362265917,lat:35.00997660151913}),suncheon,{env,now,fetcher});
 assert.equal(suncheon.statusCode,200);assert.equal(suncheon.body.regionId,'suncheon');assert.deepEqual(suncheon.body.grid,{nx:68,ny:71});assert.equal(suncheon.body.values.T1H,18);assert.equal(suncheon.body.values.RN1,0);
 const seogu=response();await weather(request({lon:126.8514,lat:35.1595}),seogu,{env,now,fetcher});
 assert.equal(seogu.statusCode,200);assert.equal(seogu.body.regionId,'seogu');assert.deepEqual(seogu.body.grid,{nx:58,ny:74});assert.equal(seogu.body.values.T1H,11);
 assert.deepEqual(calls,[{nx:68,ny:71},{nx:58,ny:74}]);assert.ok(!JSON.stringify(suncheon.body).includes('SHARED_KEY_TEST_ONLY'));
});

test('weather: selected-region boundaries and the public region allowlist are checked before provider calls',async()=>{
 let calls=0;const fetcher=async()=>{calls++;throw Error('should not request');};
 for(const query of [
  {regionId:'seogu',lon:127.3844,lat:35.01},
  {regionId:'suncheon',lon:126.85,lat:35.15},
  {regionId:'suncheon',lon:126.98,lat:37.56},
  {lon:126.98,lat:37.56},
  {regionId:'suncheon',lon:'NaN',lat:35.01},
  {regionId:'suncheon',lon:127.38},
  {regionId:'../../secret',lon:127.38,lat:35.01},
  {regionId:'',lon:127.38,lat:35.01},
 ]){
  const res=response();await weather(request(query),res,{env,now,fetcher});assert.equal(res.statusCode,400);assert.equal(res.body.ok,false);
 }
 assert.equal(calls,0);
});

test('weather: a configured deployment may default to Suncheon when older callers omit regionId',async()=>{
 const time=new Date('2026-10-23T14:15:00Z');let calls=0;
 const fetcher=async()=>{calls++;return new Response(JSON.stringify(observations({nx:68,ny:71},18,time)));};
 const res=response();await weather(request({lon:127.38441362265917,lat:35.00997660151913}),res,{env:{...env,REGION_PROFILE:'suncheon'},now:time,fetcher});
 assert.equal(res.statusCode,200);assert.equal(res.body.regionId,'suncheon');assert.deepEqual(res.body.grid,{nx:68,ny:71});
 assert.equal(calls,1);
});

test('weather: a provider observation labelled with another grid is rejected instead of relabelled',async()=>{
 const time=new Date('2026-10-24T06:15:00Z');
 await assert.rejects(readWeather(127.38441362265917,35.00997660151913,{env,now:time,fetcher:async()=>new Response(JSON.stringify(observations({nx:58,ny:74},12,time)))}),{code:'SCHEMA_CHANGED'});
 assert.deepEqual(kmaGrid(126.8514,35.1595),{nx:58,ny:74});
 for(const point of [[NaN,35],[181,35],[127,90],[127,-90]])assert.throws(()=>kmaGrid(...point));
});
