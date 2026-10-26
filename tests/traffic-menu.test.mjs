import test from 'node:test';
import assert from 'node:assert/strict';
import {LAYERS,LAYER_BY_ID,PRESETS,PATHS} from '../src/city/catalog.js';
import {regionLayers} from '../src/city/region-runtime.js';

test('bottom presets offer walking directions and no legacy traffic tab',()=>{
  assert.equal(PRESETS.some(preset=>preset.id==='traffic'||preset.label==='교통'),false);
  const walking=PRESETS.filter(preset=>preset.id==='walk');
  assert.equal(walking.length,1);
  assert.equal(walking[0].label,'도보길');
  assert.equal(walking[0].icon,'pin');
  assert.ok(PATHS[walking[0].icon]);
  assert.deepEqual(walking[0].layers,[],'Opening walking directions must not silently request unrelated traffic APIs.');
  assert.equal(new Set(PRESETS.map(preset=>preset.id)).size,PRESETS.length);
  for(const preset of PRESETS)for(const id of preset.layers)assert.ok(LAYER_BY_ID[id],`${preset.id}: ${id}`);
});

test('live traffic layers stay registered but are absent from the visible layer menu',()=>{
  const menuIds=new Set(regionLayers(undefined,LAYERS).filter(layer=>!layer.specialized).map(layer=>layer.id));
  for(const id of ['events','cctv','flow','accidents']){
    assert.ok(LAYER_BY_ID[id],`${id}: preserve adapter metadata for existing records`);
    assert.equal(LAYER_BY_ID[id].specialized,true,id);
    assert.equal(menuIds.has(id),false,id);
    assert.equal(PRESETS.some(preset=>preset.layers.includes(id)),false,id);
  }
});

test('removing the traffic tab preserves pedestrian safety and everyday destination layers',()=>{
  const menuIds=new Set(regionLayers(undefined,LAYERS).filter(layer=>!layer.specialized).map(layer=>layer.id));
  for(const id of ['local-icing','sd-icing','official-child-protection-zone','official-senior-disabled-protection-zone','infra-school','infra-bus','parks','libraries']){
    assert.ok(LAYER_BY_ID[id],id);
    assert.equal(menuIds.has(id),true,`${id}: pedestrian safety or daily destination must remain available`);
  }
});
