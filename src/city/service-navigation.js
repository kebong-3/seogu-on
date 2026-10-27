/** Service changes hide previous overlays while keeping imported/public records in memory. */
const ENTRIES={
 'decision-living-map':'living','decision-twin':'living','decision-inspection':'living',
 'decision-site-review':'living','decision-preset':'living','decision-from-question':'living',
 'walk-routes':'walk','walk-mode':'walk',
 resilience:'disaster','resilience-preset':'disaster',
 preset:'explore','infra-select':'explore','clear-layers':'explore',
};
export function createServiceNavigation({state,decision,walk,send,cancelPending=()=>{},draw=()=>{}}){
 let current=null;
 return {
  enter(action){
   const next=ENTRIES[action];if(!next||next===current)return false;
   current=next;
   cancelPending();decision()?.suspend?.();walk()?.suspend?.();
   send({type:'stop'});send({type:'clear-analysis'});
   for(const id of state.enabled){send({type:'raster',id,visible:false});}
   state.enabled.clear();state.activePreset=null;state.selected=null;state.isolate=false;
   draw();return true;
  },
 };
}
