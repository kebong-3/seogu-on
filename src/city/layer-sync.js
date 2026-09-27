/** Stable input references prevent full geometry rebuilds on every UI click. */
export class LayerSync {
  constructor(){this.reset();}
  reset(){this.cache=new Map();this.revision=0;}
  sync({entries,enabled,selected,isolate,scoped},send) {
    let sent=0;
    for(const[id]of entries) {
      const visible=enabled.has(id)&&(!isolate||selected?.layer===id);
      const old=this.cache.get(id);
      if(!visible){if(old?.visible){send({type:'layer',id,visible:false});sent++;this.cache.set(id,{...old,visible:false});}continue;}
      const input=scoped(id),isolateId=isolate&&selected?String(selected.id):null;
      const selectedId=selected?.layer===id?String(selected.id):null;
      const changed=!old||old.input!==input||old.isolateId!==isolateId||old.selectedId!==selectedId;
      if(changed) {
        const features=isolateId===null?input:input.filter(f=>String(f.properties?.id??f.id)===isolateId);
        send({type:'layer',id,features,visible:true,selectedId,revision:++this.revision});sent++;
      } else if(!old.visible){send({type:'layer',id,visible:true});sent++;}
      this.cache.set(id,{input,isolateId,selectedId,visible:true});
    }
    for(const[id,old]of this.cache)if(!entries.has(id)){if(old.visible){send({type:'layer',id,visible:false});sent++;}this.cache.delete(id);}
    return sent;
  }
}
/** Keep only the latest state while the iframe is loading, but preserve explicit actions. */
export class PendingMessages {
  constructor(limit=96){this.items=new Map();this.actions=[];this.limit=limit;}
  add(m) {
    const key=m.type==='layer'||m.type==='raster'?`${m.type}:${m.id}`:['boundaries','camera','quality','visual','building-style','resize','sun'].includes(m.type)?m.type:null;
    if(key){const old=this.items.get(key);this.items.set(key,m.type==='layer'&&!m.features&&old?{...old,...m}:m);return;}
    if(this.actions.length>=this.limit)throw Error('지도 초기화 대기 중 요청이 많습니다. 지도 준비 후 다시 실행하세요.');
    this.actions.push(m);
  }
  drain(){const rank=m=>m.type==='boundaries'?0:m.type==='quality'||m.type==='visual'||m.type==='building-style'?1:m.type==='camera'?4:2;
    const result=[...this.items.values()].sort((a,b)=>rank(a)-rank(b)).concat(this.actions);this.clear();return result;}
  clear(){this.items.clear();this.actions=[];}
}
