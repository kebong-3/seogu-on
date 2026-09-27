/* Trusted, pinned LOCAL asset archive. No network download, npm install, or secrets. */
import {readFile,writeFile,mkdir,rename,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export async function ensureRuntime(root=ROOT) {
 const manifest=JSON.parse(await readFile(resolve(root,'vendor/cesium-manifest.json'),'utf8'));
 const target=resolve(root,'public/vendor/cesium'),archive=await readFile(resolve(root,'vendor/cesium-1.121.0.tar.gz'));
 if(createHash('sha256').update(archive).digest('hex')!==manifest.sha256)throw Error('Cesium 실행자료 SHA-256 불일치: 배포 파일을 다시 확인하세요.');
 const data=gunzipSync(archive,{maxOutputLength:64*1024*1024});
 const stage=target+'-building-'+process.pid;await rm(stage,{recursive:true,force:true});await mkdir(stage,{recursive:true});let count=0;
 try {
  for(let offset=0;offset+512<=data.length;){const head=data.subarray(offset,offset+512);if(head.every(x=>x===0))break;
   const txt=(start,end)=>head.subarray(start,end).toString('utf8').split('\0')[0];
   const name=[txt(345,500),txt(0,100)].filter(Boolean).join('/');
   const size=parseInt(txt(124,136).trim()||'0',8),type=head[156];offset+=512;
   if(type!==0&&type!==48)throw Error('실행자료에 파일 이외의 항목이 포함되어 있습니다.');
   if(!Number.isSafeInteger(size)||size<0||offset+size>data.length||name.startsWith('/')||name.includes('\\')||name.split('/').some(p=>p==='..'||p==='.')||/\.(ttf|otf|woff2?|eot)$/i.test(name)||++count>1000)throw Error('실행자료 경로·크기 검증 실패');
   const dest=resolve(stage,name);if(!dest.startsWith(stage+'/'))throw Error('실행자료 경로 오류');
   await mkdir(dirname(dest),{recursive:true});await writeFile(dest,data.subarray(offset,offset+size));offset+=Math.ceil(size/512)*512;
  }
  await readFile(resolve(stage,'Cesium.js'));await readFile(resolve(stage,'LICENSE.md'));
  await writeFile(resolve(stage,'.runtime-sha256'),manifest.sha256+'\n');await rm(target,{recursive:true,force:true});await rename(stage,target);
 }catch(e){await rm(stage,{recursive:true,force:true});throw e;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await ensureRuntime();
