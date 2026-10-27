import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadSeasonalWalkData,loadSafeReturnReferences} from '../server/seasonal-walk-data.js';

test('reviewed Seo-gu data preserve unknown heights and undeclared coverage',async()=>{
  const data=await loadSeasonalWalkData({regionId:'seogu'});
  assert.equal(data.buildings.features.length,5779);assert.equal(data.icing.features.length,23);
  assert.equal(data.coverageGeometry,null);assert.equal(data.metadata.state,'partial');
  assert.equal(data.buildings.features.filter(f=>f.properties.heightBasis==='display-only').length,3510);
  assert.equal(data.buildings.features.filter(f=>f.properties.heightBasis==='tagged').length,52);
  assert.match(data.metadata.icingMeaning,/任意|임의/);assert.equal(data.metadata.buildingSha256.length,64);
});
test('unconnected regions never inherit Seo-gu buildings, icing points or references',async()=>{
  const data=await loadSeasonalWalkData({regionId:'suncheon'});
  assert.equal(data.buildings.features.length,0);assert.equal(data.icing,null);assert.equal(data.coverageGeometry,null);
  assert.equal(await loadSafeReturnReferences({regionId:'suncheon'}),null);
  await assert.rejects(()=>loadSeasonalWalkData({regionId:'../seogu'}));
});
test('official route reference is factual linked metadata, without inferred route geometry',async()=>{
  const data=await loadSafeReturnReferences();assert.equal(data.routes.length,6);assert.equal(data.geometryAvailable,false);
  assert.equal(data.sourceDate,'2026-08');assert.equal(data.publishedAt,'2026-08-24');
  assert.deepEqual(data.routes.map(r=>r.name),['금호1','금호2','금호3','화정1','화정2','농성1']);
});
test('snapshot symlinks cannot escape the fixed public root',async()=>{
  const root=await mkdtemp(join(tmpdir(),'seasonal-walk-'));
  try{await mkdir(join(root,'data/city/model'),{recursive:true});await writeFile(join(root,'outside.json'),'{}');
    const publicRoot=join(root,'public');await mkdir(join(publicRoot,'data/city/model'),{recursive:true});
    await symlink(join(root,'outside.json'),join(publicRoot,'data/city/model/buildings.geojson'));
    await assert.rejects(()=>loadSeasonalWalkData({publicRoot}),/경로|ENOENT/);
  }finally{await rm(root,{recursive:true,force:true});}
});
