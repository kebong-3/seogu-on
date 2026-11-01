import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const expectedDistricts={'서구':17,'북구':32,'동구':5,'남구':12,'광산구':20};
const acceptedCategories=new Set(['forest','park','culture','science','library','experience','landscape']);
const httpUrl=value=>{try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password;}catch{return false;}};
const fail=message=>{throw new Error('Family outing data: '+message);};

/** Checks the supplied books' complete coverage and the evidence needed to publish a map point. */
export function validateFamilyOutingCollection(collection){
 if(collection?.type!=='FeatureCollection'||!Array.isArray(collection.features))fail('expected a FeatureCollection');
 const features=collection.features,ids=new Set(),names=new Set(),districts={},sourceNumbers={'culture-map':new Set(),'forest-map':new Set()};
 let mapped=0;
 for(const feature of features){
  const p=feature.properties||{},name=String(p.name||'').trim();
  if(!p.id||ids.has(p.id)||feature.id!==p.id)fail('missing, duplicate or mismatched id '+p.id);
  ids.add(p.id);
  const uniqueName=p.district+':'+name.replace(/[\s·.]/g,'');
  if(!name||names.has(uniqueName))fail('duplicate or empty destination '+name);
  names.add(uniqueName);districts[p.district]=(districts[p.district]||0)+1;
  if(!acceptedCategories.has(p.category)||!['outdoor','indoor','mixed'].includes(p.environment))fail('invalid category/environment '+p.id);
  if(!p.summary||!p.visitNote||!Array.isArray(p.activities)||!p.activities.length||!['provided','suggestion'].includes(p.activitySource))fail('missing visitor information '+p.id);
  if(!p.address&&p.directionPolicy!=='search-only')fail('missing address without a search-only policy '+p.id);
  if(!p.sourceAddress||!Array.isArray(p.sourceRefs)||!p.sourceRefs.length)fail('missing original evidence '+p.id);
  for(const ref of p.sourceRefs){if(sourceNumbers[ref.collection])sourceNumbers[ref.collection].add(ref.number);}
  if(p.website&&!httpUrl(p.website))fail('invalid facility website '+p.id);
  if(p.recommendedForImmediateVisit===false&&p.directionPolicy!=='confirm-first')fail('restricted visit needs confirmation policy '+p.id);
  if(feature.geometry!==null){
   const point=feature.geometry;
   if(point?.type!=='Point'||point.coordinates?.length!==2||!point.coordinates.every(Number.isFinite))fail('invalid point '+p.id);
   const [lon,lat]=point.coordinates;
   if(lon<126.6||lon>127.15||lat<35||lat>35.3)fail('point outside the Gwangju view '+p.id);
   if(!['poi-matched','address-matched'].includes(p.locationStatus))fail('unverified map point '+p.id);
   if(!httpUrl(p.coordinateSource?.url)||!p.coordinateSource?.title||!p.coordinateSource?.method||!p.coordinateSource?.checkedAt||!p.positionNote)fail('missing coordinate evidence '+p.id);
   mapped++;
  }else if(p.locationStatus!=='unverified'){fail('unresolved location claims a match '+p.id);}
 }
 if(features.length!==86)fail('expected 86 destinations, found '+features.length);
 for(const [district,count] of Object.entries(expectedDistricts))if(districts[district]!==count)fail('district coverage differs: '+district);
 for(const [key,count] of [['culture-map',42],['forest-map',45]]){
  const numbers=sourceNumbers[key];
  if(numbers.size!==count||!Array.from({length:count},(_,i)=>i+1).every(n=>numbers.has(n)))fail('source list coverage differs: '+key);
 }
 for(const feature of features)for(const id of feature.properties.relatedIds||[])if(!ids.has(id))fail('unknown related place '+id);
 const coverage=collection.metadata?.coverage;
 if(coverage?.destinations!==features.length||coverage?.mappedDestinations!==mapped||coverage?.pendingLocations!==features.length-mapped)fail('coverage metadata does not match the actual features');
 return {destinations:features.length,mappedDestinations:mapped,pendingLocations:features.length-mapped,byDistrict:districts};
}

export async function validateFamilyOutings({publicRoot=fileURLToPath(new URL('../public/',import.meta.url))}={}){
 const text=await readFile(resolve(publicRoot,'data/family/gwangju-outings.geojson'),'utf8');
 return {...validateFamilyOutingCollection(JSON.parse(text)),dataSha256:createHash('sha256').update(text).digest('hex')};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await validateFamilyOutings(),null,2));
