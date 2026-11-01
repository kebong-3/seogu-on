/** Viewport only. This never replaces the administrative geometry used by analysis. */
export const FAMILY_VIEW_BOUNDS=Object.freeze([126.6,35.0,127.15,35.3]);
export function familyViewGeometry(){
 const [west,south,east,north]=FAMILY_VIEW_BOUNDS;
 return {type:'Polygon',coordinates:[[[west,south],[east,south],[east,north],[west,north],[west,south]]]};
}
