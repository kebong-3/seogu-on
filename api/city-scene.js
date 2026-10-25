import {gate,origin,requireKey,fail,HttpError} from '../server/city/common.js';
import {loadRegionProfile} from '../server/region-profile.js';
import {frameFor} from '../src/city/camera.js';
const attr=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export default async function handler(req,res){if(!gate(req,res))return;try{const key=requireKey(process.env.VWORLD_BROWSER_KEY,'브이월드 3D'),domain=origin();const sdk=new URL('https://map.vworld.kr/js/webglMapInit.js.do');sdk.searchParams.set('version','3.0');sdk.searchParams.set('apiKey',key);sdk.searchParams.set('domain',domain);
 const url=new URL(req.url||'/api/city-scene','https://local.invalid');
 const profile=await loadRegionProfile({regionId:url.searchParams.has('region')?url.searchParams.get('region'):undefined});
 const [west,south,east,north]=profile.bounds;
 const pose=frameFor({type:'Polygon',coordinates:[[[west,south],[east,south],[east,north],[west,north],[west,south]]]},'overview');
 const region=JSON.stringify({id:profile.id,name:profile.name,center:profile.center,range:pose.range}).replace(/</g,'\\u003c');
 res.statusCode=200;res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${attr(profile.name)} · 브이월드 3D</title><style>html,body,#vmap{margin:0;width:100%;height:100%;overflow:hidden;background:#102532}#notice{position:absolute;bottom:3px;left:165px;right:70px;text-align:right;pointer-events:none;font:10px sans-serif;color:white;text-shadow:0 1px 3px #000}</style><script>window.SEO_REGION=${region};</script><script src="${attr(sdk)}"></script></head><body><div id="vmap"></div><div id="notice">${attr(profile.name)} · 실제 브이월드 지형·건물 수신 중</div><script type="module" src="/src/city/scene.js"></script></body></html>`);
 }catch(e){fail(res,e.status===400?new HttpError(400,e.message,e.code):e);}}
