/** Consistent screen-pixel emphasis in the 3D, lightweight and boundary maps. */
export const WALK_ROUTE_COLORS={direct:'#00e5ff',selected:'#ff49db'};
export function navigationLineStyle(id,active=true){
  if(id==='walk-direct'||id==='walk-selected')return {width:active?10:6,outlineWidth:3,outlineColor:'#ffffff'};
  if(id==='walk-assessment')return {width:4,outlineWidth:0};
  return null;
}
