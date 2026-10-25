import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import cityScene from '../api/city-scene.js';
import {frameFor,outsideRegionView} from '../src/city/camera.js';
import {unionGeometry,validGeometry} from '../src/city/geometry.js';
const read=path=>JSON.parse(readFileSync(new URL('../'+path,import.meta.url),'utf8'));
const suncheon=read('public/data/regions/suncheon.json');
const geometry=unionGeometry(read('public/data/regions/suncheon/admin-boundaries.geojson').features);
test('Suncheon camera stays in its region and can frame a city larger than Seo-gu',()=>{
 const pose=frameFor(geometry,'overview');
 assert.equal(outsideRegionView(suncheon.center,geometry),false);
 assert.equal(outsideRegionView([126.855,35.14],geometry),true);
 assert.ok(pose.range>36000&&pose.range<=120000);
 assert.equal(outsideRegionView(pose.center,geometry),false);
});
test('Suncheon source points use their explicit region bounds without loosening legacy bounds',()=>{
 const facilities=read('public/data/regions/suncheon/facilities.geojson').features;
 assert.ok(facilities.every(f=>validGeometry(f.geometry,{bounds:suncheon.bounds})));
 assert.equal(validGeometry(facilities[0].geometry),false);
 assert.equal(validGeometry({type:'Point',coordinates:[126.855,35.14]},{bounds:suncheon.bounds}),false);
});
test('VWorld scene initializes the selected registered city and retains the configured SDK domain',async()=>{
 const oldKey=process.env.VWORLD_BROWSER_KEY,oldDomain=process.env.VWORLD_DOMAIN;
 process.env.VWORLD_BROWSER_KEY='PUBLIC_TEST_BROWSER_KEY';process.env.VWORLD_DOMAIN='https://map-test.example';
 const res=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},end(s){this.body=s;}});
 try{
  for(const id of ['seogu','suncheon']){
   const response=res();await cityScene({method:'GET',url:`/api/city-scene?region=${id}`,headers:{host:'map-test.example'}},response);
   assert.equal(response.statusCode,200);
   const region=JSON.parse(response.body.match(/window\.SEO_REGION=(\{[^;]+\});/)[1]);
   const profile=read(`public/data/regions/${id}.json`);
   assert.equal(region.id,id);assert.equal(region.name,profile.name);assert.deepEqual(region.center,profile.center);
   assert.ok(response.body.includes(`domain=${encodeURIComponent('https://map-test.example')}`));
   assert.match(response.body,/type="module" src="\/src\/city\/scene.js"/);
  }
  const unknown=res();await cityScene({method:'GET',url:'/api/city-scene?region=../outside',headers:{host:'map-test.example'}},unknown);assert.equal(unknown.statusCode,400);
 }finally{
  if(oldKey===undefined)delete process.env.VWORLD_BROWSER_KEY;else process.env.VWORLD_BROWSER_KEY=oldKey;
  if(oldDomain===undefined)delete process.env.VWORLD_DOMAIN;else process.env.VWORLD_DOMAIN=oldDomain;
 }
});
