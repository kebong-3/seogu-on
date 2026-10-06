/** Build-time snapshot for spatial, slow-changing SafetyData sources.
 * Only complete, validated GeoJSON is published. Service keys stay on the server.
 */
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {readSafetyData,getSafetyKey} from '../server/city/safetydata.js';
import {SAFETY_BY_ID} from '../src/city/safety-catalog.js';
const IDS=['sd-cold','sd-heat','sd-heat-reduction','sd-civil-shelter','sd-icing','sd-flood','sd-risk'];
const MAX_PAGES=8;
const RUNNING_SITE='https://seogu-on.vercel.app';
async function readPage(id,page,key){
 if(process.env.VERCEL_ENV){try{
  const response=await fetch(RUNNING_SITE+'/api/city-data?kind='+encodeURIComponent(id)+'&dong=all&page='+page,{signal:AbortSignal.timeout(18000)});
  const result=await response.json();if(response.ok&&result.ok!==false&&result.page===page&&Array.isArray(result.geojson?.features))return result;
 }catch{} }
 if(!key)throw Error('running-site-unavailable');
 return readSafetyData(id,new URLSearchParams({dong:'all',page:String(page)}));
}
export async function collectSafetySnapshots(out){
 const dir=join(out,'data/city/safety');await mkdir(dir,{recursive:true});
 const summary=[];
 async function collectOne(id){
  const source=SAFETY_BY_ID[id];let key='';
  try{key=getSafetyKey(source);}catch{summary.push({id,state:'configuration-error'});return;}
  if(!key&&!process.env.VERCEL_ENV){summary.push({id,state:'not-configured'});return;}
  const features=new Map();let last=null,scanned=0,failed=null;
  for(let page=1;page<=MAX_PAGES;page++){
   try{
    const result=await readPage(id,page,key);
    if(result.stale||result.page!==page||!Array.isArray(result.geojson?.features))throw Error('invalid-page');
    scanned+=result.scanned;
    for(const f of result.geojson.features)features.set(String(f.properties?.id||f.id),f);
    last=result;
    if(result.complete)break;
   }catch(e){failed=e.code||e.message||'fetch-error';break;}
  }
  // Never promote a partial national scan to an apparently complete local dataset.
  if(!last?.complete||failed){summary.push({id,state:failed?'fetch-error':'incomplete',scanned,reason:failed||'page-cap'});return;}
  const metadata={state:'published',sourceName:source.sourceName,sourceUrl:source.sourceUrl,collectedAt:last.collectedAt,sourceDate:last.sourceDate,recordCount:features.size,scanned,scopeDong:'all',complete:true,note:source.note,sourceType:'SafetyData API build snapshot',coverageNote:last.coverageNote};
  await writeFile(join(dir,id+'.geojson'),JSON.stringify({type:'FeatureCollection',metadata,features:[...features.values()]}));
  summary.push({id,state:'published',features:features.size,scanned});
 }
 let next=0;
 await Promise.all(Array.from({length:3},async()=>{while(next<IDS.length){const id=IDS[next++];await collectOne(id);}}));
 summary.sort((a,b)=>IDS.indexOf(a.id)-IDS.indexOf(b.id));
 await writeFile(join(dir,'manifest.json'),JSON.stringify({collectedAt:new Date().toISOString(),datasets:summary},null,2));
 console.log('SafetyData snapshots: '+summary.map(x=>x.id+'='+x.state+(x.features===undefined?'':'('+x.features+')')).join(', '));
 return summary;
}
