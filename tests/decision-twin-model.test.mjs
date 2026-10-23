import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {computeDecisionTwin,decisionDistance} from '../shared/decision-twin-model.js';
import {loadDecisionData} from '../server/decision-data.js';

const point=(id,x,y=35,extra={})=>({type:'Feature',geometry:{type:'Point',coordinates:[x,y]},properties:{id,name:id,...extra}});
const dataset=(features,metadata={})=>({type:'FeatureCollection',metadata:{sourceName:'검증 원문',sourceUrl:'https://example.org/data',sourceDate:'2026-01-01',...metadata},features});
const polygon=(id,left,right)=>({type:'Feature',properties:{dongId:id,dongName:id},geometry:{type:'Polygon',coordinates:[[[left,34.99],[right,34.99],[right,35.01],[left,35.01],[left,34.99]]]}});
const boundaries={type:'FeatureCollection',features:[polygon('west',126.98,127),polygon('east',127,127.02)]};
const profile={id:'test',name:'시험시',facilitiesUrl:'/data/public.geojson'};
const manifest={version:1,regionId:'test',datasets:[{id:'targets',title:'대상',unit:'수록 지점',path:'/data/targets.geojson'},{id:'services',title:'기존 시설',unit:'수록 지점',path:'/data/services.geojson'},{id:'history',title:'과거 기록',unit:'원문 기록',path:'/data/history.geojson'}],
  presets:[{id:'basic',title:'시설 공백 비교',target:'targets',service:'services',radiusM:100}],defaultPreset:'basic',contextDatasetIds:['targets','services','history']};
const make=(datasets,request={})=>computeDecisionTwin({profile,boundaries,manifest,datasets,request,generatedAt:'2026-10-23T00:00:00Z'});
const empty=()=>dataset([],{complete:true});

test('additional candidate produces measured gains, stable greedy order and no double-counting',()=>{
  const data={targets:dataset([point('a',126.990),point('b',126.9905),point('c',127.010)]),services:empty(),history:empty()};
  const result=make(data,{maxNew:1});
  assert.deepEqual(result.baseline,{total:3,covered:0,uncovered:3,totalLocations:3,coveredLocations:0,uncoveredLocations:3});
  assert.equal(result.recommendations[0].targetId,'a');
  assert.equal(result.recommendations[0].marginalGain,2);
  assert.equal(result.scenario.covered,2);assert.equal(result.scenario.newlyCovered,2);
  const two=make(data,{maxNew:2});assert.equal(two.scenario.covered,3);assert.deepEqual(two.recommendations.map(p=>p.marginalGain),[2,1]);
  assert.deepEqual(make({...data,targets:dataset([...data.targets.features].reverse())},{maxNew:2}).recommendations,two.recommendations);
});

test('explicit empty additions suppress automatic proposals and duplicate location is rejected',()=>{
  const data={targets:dataset([point('a',126.990)]),services:empty(),history:empty()};
  const result=make(data,{maxNew:3,proposedSites:[]});assert.equal(result.scenario.covered,0);assert.deepEqual(result.scenario.proposedSites,[]);
  const sites=[{id:'x',coordinates:[126.99,35]},{id:'y',coordinates:[126.99,35]}];
  assert.throws(()=>make(data,{proposedSites:sites}),/중복 추가/);
});

test('scope limits targets but includes a service immediately across the dong boundary',()=>{
  const data={targets:dataset([point('west-target',126.9998),point('east-target',127.005)]),services:dataset([point('east-service',127.0001)]),history:empty()};
  const result=make(data,{scopeId:'west',proposedSites:[]});
  assert.equal(result.baseline.total,1);assert.equal(result.baseline.covered,1);assert.equal(result.rows[0].nearest.id,'east-service');
  assert.throws(()=>make(data,{scopeId:'west',proposedSites:[{id:'outside',coordinates:[127.005,35]}]}),/행정구역 안/);
});

test('removing existing coverage reports losses independently of additions and net change',()=>{
  const data={targets:dataset([point('a',126.990),point('b',127.010)]),services:dataset([point('s1',126.990)]),history:empty()};
  const result=make(data,{excludedServiceIds:['s1'],proposedSites:[{id:'new-b',coordinates:[127.010,35]}]});
  assert.equal(result.baseline.covered,1);assert.equal(result.scenario.covered,1);assert.equal(result.scenario.lostCovered,1);assert.equal(result.scenario.newlyCovered,1);assert.equal(result.scenario.netChange,0);
  assert.equal(result.rows.find(r=>r.id==='a').lostCovered,true);assert.equal(result.rows.find(r=>r.id==='b').newlyCovered,true);
  assert.throws(()=>make(data,{excludedServiceIds:['unknown']}),/원자료에 없는/);
});

test('empty partial and unavailable sources yield unknown, explicitly complete zero permits comparison',()=>{
  const data={targets:dataset([point('a',126.99)]),services:dataset([]),history:empty()};
  const unknown=make(data);assert.equal(unknown.status,'unavailable');assert.equal(unknown.baseline.total,1);assert.equal(unknown.baseline.covered,null);assert.equal(unknown.scenario.newlyCovered,null);
  const valid=make({...data,services:empty()},{maxNew:1});assert.equal(valid.baseline.covered,0);assert.equal(valid.scenario.newlyCovered,1);
  const omitted=make({...data,services:dataset([point('s',126.99)],{state:'not-connected'})});assert.equal(omitted.baseline.covered,null);
});

test('point cleaning keeps feature source, deduplicates IDs and reports source records versus coordinates',()=>{
  const official=point('a',126.99,35,{sourceName:'공식 학교 위치',sourceUrl:'https://example.org/school',sourceDate:'2026-03-20'});
  const invalid=point('bad',NaN),area=polygon('area',126.99,127);
  const result=make({targets:dataset([official,official,point('b',126.99),invalid,area]),services:empty(),history:empty()},{maxNew:1});
  const source=result.sourceStatus.find(s=>s.id==='targets');
  assert.equal(source.rawRecords,5);assert.equal(source.acceptedPoints,2);assert.equal(source.uniqueLocations,1);assert.equal(source.duplicates,1);assert.equal(source.nonPoint,1);assert.equal(source.invalid,1);
  assert.equal(result.rows.find(p=>p.id==='a').sourceRefs[0].url,'https://example.org/school');
  assert.equal(result.scenario.covered,2);assert.equal(result.scenario.proposedSites.length,1);
});

test('region mismatch, unsupported scope and out-of-region datasets are kept separate',()=>{
  const data={targets:dataset([point('a',126.99)]),services:empty(),history:empty()};
  assert.throws(()=>computeDecisionTwin({profile,boundaries,datasets:data,manifest:{...manifest,regionId:'other'}}),/일치하지/);
  assert.throws(()=>make({...data,services:dataset([],{regionId:'other'})}),/다른 지역/);
  assert.throws(()=>make(data,{scopeId:'other-city-dong'}),/현재 지역에 없는/);
  assert.throws(()=>make(data,{sites:[{id:'bad',coordinates:[128,36]}]}),/행정구역 안/);
});

test('inspection and site preserve record/location distinction and missing data nulls',()=>{
  const data={targets:dataset([point('a',126.99)]),services:empty(),history:dataset([point('h1',126.9901),point('h2',126.9901)])};
  const inspected=make(data,{workflow:'inspection',proposedSites:[]});
  const records=inspected.rows[0].context.find(d=>d.datasetId==='history');assert.equal(records.count,2);assert.equal(records.uniqueLocations,1);
  const result=make({...data,history:dataset([])},{workflow:'site',sites:[{id:'site1',name:'검토위치',coordinates:[126.99,35]}]});
  const unknown=result.context.sites[0].datasets.find(d=>d.datasetId==='history');assert.equal(unknown.count,null);assert.equal(unknown.uniqueLocations,null);assert.equal(unknown.nearest,null);
  assert.equal(result.context.sites[0].datasets.find(d=>d.datasetId==='targets').count,1);
});

test('coverage uses unrounded distance at the radius boundary',()=>{
  const target=point('a',126.99),service=point('s',126.9911);
  const actual=decisionDistance(target.geometry.coordinates,service.geometry.coordinates);
  const data={targets:dataset([target]),services:dataset([service]),history:empty()};
  assert.equal(make(data,{radiusM:actual,proposedSites:[]}).baseline.covered,1);
  assert.equal(make(data,{radiusM:actual-0.0001,proposedSites:[]}).baseline.covered,0);
});

test('server loader preserves source hashes and rejects source, region and path substitutions',async()=>{
  const publicRoot=await mkdtemp(join(tmpdir(),'seogu-decision-test-'));
  const sourceRoot=fileURLToPath(new URL('../public/',import.meta.url));
  const profileData=JSON.parse(await readFile(join(sourceRoot,'data/regions/seogu.json'),'utf8'));
  const files=['data/regions/seogu.json',profileData.boundaryUrl.slice(1),profileData.facilitiesUrl.slice(1)];
  try {
    for(const file of files){await mkdir(dirname(join(publicRoot,file)),{recursive:true});await copyFile(join(sourceRoot,file),join(publicRoot,file));}
    const decisionPath=join(publicRoot,'data/decision/seogu');await mkdir(decisionPath,{recursive:true});
    const record=dataset([point('local-target',126.88,35.14)],{regionId:'seogu'});
    await writeFile(join(decisionPath,'targets.geojson'),JSON.stringify(record));
    await writeFile(join(decisionPath,'services.geojson'),JSON.stringify(record));
    const sources=['targets','services'].map(id=>({id,title:id,path:`/data/decision/seogu/${id}.geojson`,sourceName:'검증 원문',sourceUrl:'https://example.org/data',sourceDate:'2026-01-01'}));
    const config={...manifest,regionId:'seogu',datasets:sources,contextDatasetIds:['targets','services']};
    const save=body=>writeFile(join(decisionPath,'manifest.json'),JSON.stringify(body));
    await save(config);const loaded=await loadDecisionData({regionId:'seogu',publicRoot});
    assert.match(loaded.datasets.targets.sha256,/^[0-9a-f]{64}$/);assert.equal(loaded.manifest.regionId,'seogu');
    await save({...config,datasets:[{...sources[0],sourceName:'다른 원문'},sources[1]]});
    await assert.rejects(()=>loadDecisionData({regionId:'seogu',publicRoot}),e=>e.code==='DECISION_SOURCE_MISMATCH');
    await save({...config,regionId:'suncheon'});
    await assert.rejects(()=>loadDecisionData({regionId:'seogu',publicRoot}),e=>e.code==='DECISION_REGION_MISMATCH');
    await save({...config,datasets:[{...sources[0],path:'/data/../outside.geojson'},sources[1]]});
    await assert.rejects(()=>loadDecisionData({regionId:'seogu',publicRoot}));
  }finally{await rm(publicRoot,{recursive:true,force:true});}
});

test('current placement gains distinguish order, overlap, removal and baseline-new records',()=>{
  const data={targets:dataset([point('a',126.99),point('b',126.9905),point('c',126.991)]),services:empty(),history:empty()};
  const proposals=[{id:'left',name:'왼쪽',coordinates:[126.9896,35]},{id:'right',name:'오른쪽',coordinates:[126.9914,35]}];
  const result=make(data,{proposedSites:proposals,radiusM:100});
  const [left,right]=result.scenario.proposedSites;
  assert.equal(left.marginalGain,2);assert.equal(right.marginalGain,1);
  assert.equal(left.exclusiveGain,1);assert.equal(right.exclusiveGain,1);
  assert.equal(left.baselineNewCount,2);assert.equal(right.baselineNewCount,2);
  const removed=make(data,{proposedSites:[proposals[0]],radiusM:100});
  assert.equal(removed.scenario.proposedSites[0].exclusiveGain,2);
  const reversed=make(data,{proposedSites:[...proposals].reverse(),radiusM:100});
  assert.deepEqual(reversed.scenario.proposedSites.map(p=>p.marginalGain),[2,1]);
  const restore=make({...data,services:dataset([point('closed',126.9905)])},{excludedServiceIds:['closed'],proposedSites:[{id:'replacement',coordinates:[126.9905,35]}]});
  assert.equal(restore.scenario.proposedSites[0].marginalGain,3);assert.equal(restore.scenario.proposedSites[0].baselineNewCount,0);
  assert.ok(result.evidence.some(e=>e.id==='proposal:left'));
});

test('crosswalk source flags prioritize curb and tactile omissions without treating unknown as false',()=>{
  const data={targets:dataset([
    point('far-unknown',127.015,35,{loweredCurb:null,tactilePaving:null,pedestrianSignal:null,dedicatedLighting:null}),
    point('signal-only',127.010,35,{loweredCurb:true,tactilePaving:true,pedestrianSignal:false,dedicatedLighting:false}),
    point('curb-near',126.9901,35,{loweredCurb:false,tactilePaving:true,pedestrianSignal:true,dedicatedLighting:null}),
    point('two-core',126.9902,35,{loweredCurb:false,tactilePaving:false,pedestrianSignal:true,dedicatedLighting:true}),
  ]),services:dataset([point('service',126.99)]),history:empty()};
  const result=make(data,{workflow:'inspection',proposedSites:[]});
  assert.deepEqual(result.rows.map(r=>r.id),['two-core','curb-near','signal-only','far-unknown']);
  assert.equal(result.rows[0].inspectionCoreCount,2);assert.equal(result.rows[1].inspectionUnknownCount,1);
  assert.equal(result.rows[3].inspectionFlagCount,0);assert.equal(result.rows[3].inspectionUnknownCount,4);
  assert.equal(result.rows[0].sourceFlags.pedestrianSignal,true);
  assert.equal(result.rows[0].inspectionFlags[0].state,'not-installed');
  assert.match(result.evidence.find(e=>e.id==='target:two-core').text,/현장 적정성 확인/);
  assert.match(result.evidence.find(e=>e.id==='target:signal-only').text,/위법·위험·설치 의무를 판단하지/);
});

test('greedy prioritizes distinct source coordinates ahead of duplicate management records',()=>{
  const duplicates=Array.from({length:5},(_,i)=>point(`duplicate-${i}`,126.99));
  const data={targets:dataset([...duplicates,point('distinct-a',127.01),point('distinct-b',127.0105)]),services:empty(),history:empty()};
  const result=make(data,{maxNew:1});
  assert.equal(result.recommendations[0].targetId,'distinct-a');
  assert.equal(result.recommendations[0].marginalGain,2);assert.equal(result.recommendations[0].marginalLocationGain,2);
  assert.equal(result.baseline.total,7);assert.equal(result.baseline.totalLocations,3);
  assert.equal(result.scenario.covered,2);assert.equal(result.scenario.coveredLocations,2);
  assert.equal(result.scenario.uncovered,5);assert.equal(result.scenario.uncoveredLocations,1);
});
test('facility source facts stay raw and do not become live vacancies, safety ratings or private attributes',()=>{
 const careManifest={...manifest,datasets:manifest.datasets.map(d=>d.id==='targets'?{...d,topic:'care'}:d.id==='services'?{...d,topic:'safety'}:d)};
 const raw=point('care-a',126.99,35,{facilityType:'국공립',registeredStatus:'정상',capacity:40,enrolled:38,openingHours:'원문 미제공',directorName:'비공개 테스트',personalPhone:'010-0000-0000'});
 const result=computeDecisionTwin({profile,boundaries,manifest:careManifest,datasets:{targets:dataset([raw]),services:empty(),history:empty()},request:{workflow:'inspection',proposedSites:[]}});
 assert.deepEqual(result.rows[0].sourceAttributes,{facilityType:'국공립',registeredStatus:'정상',capacity:40,enrolled:38,openingHours:'원문 미제공'});
 assert.equal(Object.hasOwn(result.rows[0],'vacancies'),false);
 assert.ok(result.limitations.some(t=>/현재 입소 가능한 자리/.test(t)));
 assert.ok(result.limitations.some(t=>/범죄위험/.test(t)));
 assert.ok(!JSON.stringify(result).includes('010-0000-0000'));
});
test('large service layers retain exact counts and source hashes without repeating raw records in every context',()=>{
 const services=Array.from({length:7887},(_,index)=>point(`light-${index}`,126.99001+index*0.00000001));
 const data={targets:dataset(Array.from({length:80},(_,index)=>point(`target-${index}`,126.99+index*0.000001))),services:dataset(services,{sha256:'a'.repeat(64)}),history:empty()};
 const result=make(data,{workflow:'inspection',proposedSites:[],radiusM:300});
 const context=result.rows[0].context.find(d=>d.datasetId==='services');
 assert.equal(context.count,7887);assert.ok(context.nearest?.id);assert.ok(result.sourceStatus.some(s=>s.id===context.datasetId&&s.sha256==='a'.repeat(64)));
 assert.equal(result.evidence.find(e=>e.id==='coverage:baseline').sourceRefs.length,2);
 assert.equal(result.evidence.find(e=>e.id==='coverage:baseline').sourceRefs[1].sha256,'a'.repeat(64));
 assert.ok(Buffer.byteLength(JSON.stringify(result))<3_500_000,'7887 service points must fit the serverless response budget');
});
