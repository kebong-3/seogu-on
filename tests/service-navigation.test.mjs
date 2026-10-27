import test from 'node:test';
import assert from 'node:assert/strict';
import {createServiceNavigation} from '../src/city/service-navigation.js';

test('changing services hides previous layers and cancels work without deleting imported records',()=>{
 const imported={features:[{id:'user-record'}]},state={enabled:new Set(['parks','import-user','decision-twin-results']),entries:new Map([['import-user',imported]]),activePreset:'parks',selected:{id:'old'},isolate:true};
 let cancelled=0,decision=0,walk=0,draws=0;const sent=[];
 const nav=createServiceNavigation({state,decision:()=>({suspend(){decision++}}),walk:()=>({suspend(){walk++}}),send:m=>sent.push(m),cancelPending:()=>cancelled++,draw:()=>draws++});
 assert.equal(nav.enter('decision-living-map'),true);assert.equal(state.enabled.size,0);assert.equal(state.entries.get('import-user'),imported);assert.equal(state.activePreset,null);assert.equal(state.selected,null);assert.equal(state.isolate,false);
 assert.equal(cancelled,1);assert.equal(decision,1);assert.equal(walk,1);assert.equal(draws,1);
 assert.ok(sent.some(m=>m.type==='raster'&&m.id==='import-user'&&m.visible===false));
 state.enabled.add('decision-twin-results');assert.equal(nav.enter('walk-routes'),true);assert.equal(state.enabled.size,0);assert.equal(state.entries.get('import-user'),imported);
 assert.equal(nav.enter('walk-mode'),false,'mode changes use the same navigation lifecycle');
 assert.equal(nav.enter('walk-swap'),false,'ordinary controls must not reset endpoints');
 assert.equal(nav.enter('resilience'),true);assert.equal(cancelled,3);
});

test('map category and analysis entry transitions also suspend stale service overlays',()=>{
 const state={enabled:new Set(),entries:new Map()};let pauses=0;
 const nav=createServiceNavigation({state,decision:()=>({suspend(){pauses++}}),walk:()=>null,send:()=>{}});
 nav.enter('decision-living-map');nav.enter('preset');nav.enter('decision-preset');nav.enter('walk-routes');
 assert.equal(pauses,4);
});
