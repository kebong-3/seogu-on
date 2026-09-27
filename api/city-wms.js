import {gate,fail} from '../server/city/common.js';
import {readWms} from '../server/city/wms.js';
const cache=new Map();
export default async function handler(req,res){if(!gate(req,res,700))return;try{const q=new URL(req.url,'https://local').searchParams,id=q.toString();let r=cache.get(id);if(!r||Date.now()-r.at>60000){r={...await readWms(q),at:Date.now()};if(cache.size>180)cache.delete(cache.keys().next().value);cache.set(id,r);}res.statusCode=200;res.setHeader('Content-Type','image/png');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','public, max-age=60');res.setHeader('X-Seogu-WMS',r.outside?'outside-query-bounds':'upstream-image');res.end(r.data);}catch(e){fail(res,e);}}
