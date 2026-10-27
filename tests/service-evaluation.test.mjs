import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {loadSuite,validateSuite,validateBaseUrl,parseArgs,evaluateChecks,auditEvidence,runEvaluation,summarize,toCsv} from '../scripts/evaluate-service.mjs';

test('50 cases have distinct tasks, executable expectations, and honest manual boundaries',async()=>{
  const {suite,sha256}=await loadSuite();
  assert.equal(suite.cases.length,50);
  assert.match(sha256,/^[a-f0-9]{64}$/);
  assert.equal(new Set(suite.cases.map(c=>c.id)).size,50);
  assert.equal(new Set(suite.cases.map(c=>c.question)).size,50);
  for(const category of ['map','search','care','boundary','route-input','prefilter','uncertainty','adversarial','voice','gps','winter','accessibility'])assert.ok(suite.cases.some(c=>c.category===category),category);
  const manual=suite.cases.filter(c=>c.local.kind==='manual');
  assert.equal(manual.length,10);
  assert.ok(manual.every(c=>c.expected.local.length===0&&c.manualReview.length>0));
  const duplicate=structuredClone(suite);duplicate.cases[1].id=duplicate.cases[0].id;
  assert.throws(()=>validateSuite(duplicate),/ID/);
  const unsafe=structuredClone(suite);unsafe.cases.find(c=>c.live?.kind==='ask').live.body={apiKey:'not-a-real-key'};
  assert.throws(()=>validateSuite(unsafe),/인증정보/);
});

test('live requests require explicit paired opt-in and cannot embed credentials or change the origin path',()=>{
  assert.equal(parseArgs([]).live,false);
  assert.throws(()=>parseArgs(['--base-url','https://example.invalid']),/함께/);
  assert.throws(()=>parseArgs(['--live']),/함께/);
  for(const url of ['https://user:password@example.invalid','https://example.invalid/path','https://example.invalid?key=value','http://example.invalid','https://example.invalid/#key'])assert.throws(()=>validateBaseUrl(url));
  assert.equal(validateBaseUrl('http://127.0.0.1:3000'),'http://127.0.0.1:3000');
  assert.equal(parseArgs(['--live','--base-url','https://example.invalid','--case','ask-35,search-05']).caseIds.length,2);
  assert.throws(()=>parseArgs(['--api-key','secret']),/옵션/);
  assert.throws(()=>parseArgs(['--interval-ms','0']),/6500/);
  assert.throws(()=>parseArgs(['--json','same.json','--csv','same.json']),/달라야/);
});

test('full default run uses actual local data, does not call fetch or ambient keys, and leaves both AI models unexecuted',async()=>{
  const originalFetch=globalThis.fetch;
  const names=['UPSTAGE_API_KEY','AI_API_KEY','GEMINI_API_KEY','TMAP_API_KEY','VWORLD_API_KEY','VWORLD_DOMAIN','KMA_SERVICE_KEY'];
  const previous=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  let fetchCalls=0;
  try{
    for(const name of names)process.env[name]=name==='VWORLD_DOMAIN'?'https://example.invalid':'EVALUATION_SENTINEL_NOT_A_REAL_KEY';
    globalThis.fetch=async()=>{fetchCalls++;throw Error('Default evaluator must remain offline');};
    const report=await runEvaluation();
    assert.equal(report.execution,'local_deterministic');
    assert.equal(report.simulation,false);
    assert.equal(report.rows.length,50);
    assert.equal(fetchCalls,0);
    assert.deepEqual(report.network,{externalRequests:0,blockedOfflineAttempts:0});
    assert.equal(report.summary.automaticPassed,40);
    assert.equal(report.summary.automaticFailed,0);
    assert.equal(report.summary.errors,0);
    assert.equal(report.summary.notExecuted,10);
    assert.equal(report.summary.models.length,2);
    assert.ok(report.summary.models.every(m=>m.status==='not_executed'&&m.responses===0));
    assert.equal(report.summary.liveLatencyMs.p50,null);
    assert.equal(report.summary.cost,null);
    assert.ok(report.rows.every(r=>r.cost===null));
    assert.ok(report.rows.filter(r=>r.execution==='not_executed').every(r=>r.latencyMs===null&&r.status==='not_executed'));
    assert.ok(report.rows.some(r=>r.status==='pass'&&r.manualReview.status==='pending'));
    const unlocated=report.rows.find(r=>r.id==='care-13');
    assert.equal(unlocated.facts.unlocatedCandidateCount,0);
    assert.equal(unlocated.facts.unlocated,47);
    assert.ok(!JSON.stringify(report).includes('EVALUATION_SENTINEL_NOT_A_REAL_KEY'));
    assert.equal(report.deployment,null);
    assert.ok(report.evaluator.localAppVersion);
  }finally{
    globalThis.fetch=originalFetch;
    for(const name of names)if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];
  }
});

test('missing evidence, unknown dates, and missing expected entities are different outcomes',()=>{
  const expected={required:true,minimumRecords:1,fields:['name','url','date'],entities:['공개시설']};
  const good=auditEvidence([{entity:'공개시설',name:'공식 제공기관',url:'https://example.invalid/public',date:null}],expected);
  assert.equal(good.missing,false);
  assert.equal(good.unknownDateRecords,1);
  const noDate=auditEvidence([{entity:'공개시설',name:'공식 제공기관',url:'https://example.invalid/public'}],expected);
  assert.equal(noDate.missing,true);
  assert.ok(noDate.missingFields.some(f=>f.field==='date'));
  const invented=auditEvidence([{entity:'다른 시설',name:'공식 제공기관',url:'https://example.invalid/public',date:null}],expected);
  assert.deepEqual(invented.missingEntities,['공개시설']);
  assert.equal(invented.missing,true);
  assert.equal(auditEvidence([{entity:'공개시설',name:'공식 제공기관',url:'javascript:alert(1)',date:null}],expected).missing,true);
});

test('machine predicates fail absent fields rather than silently approving an unchecked answer',()=>{
  const result=evaluateChecks({mode:'rules',names:['공개시설']},[
    {field:'mode',op:'oneOf',value:['rules','llm']},
    {field:'names',op:'includes',value:'공개시설'},
    {field:'missing',op:'notIncludes',value:'unsafe'},
    {field:'unknown.count',op:'gte',value:0},
  ]);
  assert.deepEqual(result.map(r=>r.pass),[true,true,false,false]);
});

test('rules responses are not counted as a successful model comparison; unidentified models stay separate',()=>{
  const base={status:'pass',execution:'live_api',latencyMs:20,httpStatus:200,checks:[],evidenceAudit:{required:false,missing:false},manualReview:{status:'pending'}};
  const rows=[
    {...base,model:{mode:'rules',rulesFallback:true,executed:false,provider:null,model:null}},
    {...base,model:{mode:'llm',rulesFallback:false,executed:true,provider:'upstage',model:'solar-pro4'}},
    {...base,model:{mode:'llm',rulesFallback:false,executed:true,provider:null,model:null,displayMissing:true}},
  ];
  const result=summarize(rows,[{provider:'upstage',model:'solar-pro4'},{provider:'google',model:'gemma-4-26b-a4b-it'}]);
  assert.equal(result.liveRulesFallback,1);
  assert.equal(result.models[0].responses,1);
  assert.equal(result.models[1].status,'not_executed');
  assert.equal(result.unrecognizedModelResponses,1);
  assert.equal(result.modelDisplayMissing,1);
  assert.equal(result.cost,null);
  // Constructed records test accounting only; no model or HTTP performance result is exported.
});

test('CSV preserves missing costs and escapes text that spreadsheet software could execute',()=>{
  const report={suiteId:'unit-fixture',suiteVersion:'test',suiteSha256:'test',startedAt:'2026-01-01T00:00:00Z',evaluator:{localAppVersion:'test'},deployment:null,
    rows:[{id:'unit',category:'test',execution:'not_executed',simulation:true,status:'not_executed',httpStatus:null,latencyMs:null,model:null,evidenceAudit:null,
      manualReview:{status:'pending',criteria:['쉼표, 줄바꿈\n인용 "표시"']},cost:null,checks:[],facts:{answer:'=HYPERLINK("https://example.invalid")'}}]};
  const csv=toCsv(report);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"\'=HYPERLINK'));
  assert.ok(csv.includes('""https://example.invalid""'));
  assert.ok(csv.includes('"costAmount","costCurrency"'));
  assert.ok(!csv.includes('"costAmount":0'));
});

test('unknown IDs are rejected before running a partial comparison',async()=>{
  await assert.rejects(runEvaluation({caseIds:['not-in-suite']}),/case ID/);
  await assert.rejects(runEvaluation({live:true}),/함께/);
});

test('CLI exports actual timestamps and app version to JSON and CSV without inventing costs or AI measurements',async()=>{
  const temporaryRoot=resolve(tmpdir()),directory=await mkdtemp(resolve(temporaryRoot,'seogu-evaluation-'));
  try{
    const jsonPath=resolve(directory,'result.json'),csvPath=resolve(directory,'result.csv');
    const script=new URL('../scripts/evaluate-service.mjs',import.meta.url);
    const {fileURLToPath}=await import('node:url');
    const output=execFileSync(process.execPath,[fileURLToPath(script),'--case','search-05,manual-45','--json',jsonPath,'--csv',csvPath],{encoding:'utf8',timeout:15000});
    const report=JSON.parse(await readFile(jsonPath,'utf8')),csv=await readFile(csvPath,'utf8');
    assert.equal(report.rows.length,2);
    assert.ok(Number.isFinite(Date.parse(report.startedAt)));
    assert.ok(Date.parse(report.finishedAt)>=Date.parse(report.startedAt));
    assert.ok(report.evaluator.localAppVersion);
    assert.equal(report.rows[0].cost,null);
    assert.equal(report.rows[1].status,'not_executed');
    assert.equal(report.rows[1].latencyMs,null);
    assert.equal(report.summary.models[0].status,'not_executed');
    assert.ok(csv.includes('"search-05"'));
    assert.ok(csv.includes('"manual-45"'));
    assert.equal(JSON.parse(output).jsonPath,jsonPath);
  }finally{
    // Remove only the exact temporary child directory returned above.
    assert.equal(dirname(resolve(directory)),temporaryRoot);
    assert.ok(resolve(directory).startsWith(resolve(temporaryRoot,'seogu-evaluation-')));
    await rm(directory,{recursive:true,force:true});
  }
});

