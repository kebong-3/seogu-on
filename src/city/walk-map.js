/** TMAP overlays stay outside the application's saved layers and report records. */
export function createWalkMap({send,now=Date.now,schedule=setTimeout,cancel=clearTimeout,lifetimeMs=30*60*1000}) {
  const ids=['walk-direct','walk-selected','walk-points'];
  let layers=[],expiresAt=0,timer;
  const clear=()=>{cancel(timer);timer=undefined;layers=[];expiresAt=0;for(const id of ids)send({type:'layer',id,features:[],visible:false});};
  const replay=()=>{if(!layers.length)return;if(now()>=expiresAt){clear();return;}for(const layer of layers)send(layer);};
  function paint(routes,activeId,points=[]) {
    clear();
    const direct=routes.find(r=>r.role==='direct'),active=routes.find(r=>r.id===activeId)||direct||routes[0];
    const feature=(f,id,color)=>({...f,properties:{...f.properties,id,name:id,displayColor:color,sourceName:'TMAP 보행자 경로',ephemeral:true}});
    for(const [id,route,color]of [['walk-direct',direct,'#1769b3'],['walk-selected',active?.id!==direct?.id?active:null,'#c65c00']]) {
      if(route?.geojson?.features?.length)layers.push({type:'layer',id,color,visible:true,features:route.geojson.features.map((f,i)=>feature(f,`${id}-${i}`,color))});
    }
    const valid=points.filter(p=>Array.isArray(p.coordinate)&&p.coordinate.length===2&&p.coordinate.every(Number.isFinite));
    if(valid.length)layers.push({type:'layer',id:'walk-points',visible:true,features:valid.map((p,i)=>({type:'Feature',geometry:{type:'Point',coordinates:p.coordinate.slice()},properties:{id:p.id||`walk-point-${i}`,name:p.name||'경로 지점',displayColor:p.role==='start'?'#167747':p.role==='end'?'#b32e55':'#c65c00',sourceName:'선택한 도보 지점',ephemeral:true}}))});
    if(!layers.length)return;
    expiresAt=now()+Math.min(lifetimeMs,30*60*1000);timer=schedule(clear,Math.max(0,expiresAt-now()));replay();
  }
  return {paint,replay,clear,destroy:clear};
}
