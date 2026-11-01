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

test('returning home suspends the family map while closing or widening its panel preserves it',()=>{
 const state={enabled:new Set(),entries:new Map()},events=[];
 const family={suspend(){events.push('suspend-family')}};
 const nav=createServiceNavigation({state,decision:()=>null,walk:()=>null,family:()=>family,send:()=>{},cancelPending:()=>events.push('close-panel')});
 assert.equal(nav.enter('family-outings'),true);
 events.length=0;
 assert.equal(nav.enter('family-map-wide'),false);
 assert.equal(nav.enter('close-detail'),false);
 assert.deepEqual(events,[],'panel-only actions retain the family markers and viewport');
 assert.equal(nav.enter('resident-home'),true);
 assert.deepEqual(events,['close-panel','suspend-family'],'home completes family cleanup before its registered handler opens home');
 assert.equal(nav.enter('resident-home'),false,'repeated home entry does not repeat cleanup');
});
