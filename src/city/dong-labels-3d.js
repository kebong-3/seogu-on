/**
 * 3D 지도(브이월드·밝은 도시모형)의 동 이름표.
 * 카메라가 움직일 때마다 화면 좌표를 다시 구해 label-layout.js의 배치 결과를 적용한다.
 * 브이월드 SDK 내부 객체는 건드리지 않고 공개 Cesium 엔티티 속성만 바꾼다.
 */
import {planLabels,labelFontPx} from './label-layout.js';

const LAYOUT_INTERVAL_MS = 140; // 카메라 이동 중 재배치 최소 간격

export function createDongLabels3D({C, viewer, source, requestRender, clampToGround = true}) {
  let entries = [], selectedDong = 'all', lastSignature = '', lastRun = 0, dirty = false, lastCounts = null;
  const toWindow = C.SceneTransforms.worldToWindowCoordinates || C.SceneTransforms.wgs84ToWindowCoordinates;
  const hex = (value, alpha) => C.Color.fromCssColorString(value).withAlpha(alpha);

  function clear() {
    for (const entry of entries) source.entities.remove(entry.entity);
    entries = [];
    lastCounts = {name: 0, hidden: 0};
  }

  /** 경계를 다시 그릴 때 호출한다. visible=false면 이름표를 만들지 않는다. */
  function set(features, {dong = 'all', visible = true} = {}) {
    clear();
    selectedDong = dong;
    if (!visible) return;
    entries = features.filter(feature => Array.isArray(feature.properties?.labelPoint)).map(feature => {
      const p = feature.properties, point = p.labelPoint;
      const entity = source.entities.add({
        id: `label-${p.dongId}`,
        properties: {dongId: p.dongId, layerId: 'dong'},
        position: C.Cartesian3.fromDegrees(point[0], point[1]),
        label: {
          text: p.dongName,
          font: '14px sans-serif',
          fillColor: hex('#ffffff', 1),
          showBackground: true,
          backgroundColor: hex('#102b46', 0.94),
          backgroundPadding: new C.Cartesian2(8, 5),
          horizontalOrigin: C.HorizontalOrigin.CENTER,
          verticalOrigin: C.VerticalOrigin.CENTER,
          // 지형이 없는 도시모형은 높이 0에 그대로 둔다(지면 고정을 쓰면 먼 거리에서 글자가 어긋난다).
          heightReference: clampToGround ? C.HeightReference.CLAMP_TO_GROUND : C.HeightReference.NONE,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          show: false // 배치 계산 전에는 겹친 채로 보이지 않게 한다.
        }
      });
      return {entity, id: p.dongId, name: p.dongName, point};
    });
    dirty = true;
    layout(true);
  }

  function cameraSignature() {
    const camera = viewer.camera, canvas = viewer.scene.canvas, p = camera.positionWC;
    return [p.x, p.y, p.z].map(v => Math.round(v)).join(',') + '|' + [camera.heading, camera.pitch].map(v => v.toFixed(3)).join(',') + '|' + canvas.clientWidth + 'x' + canvas.clientHeight;
  }

  function screenPoint(entry) {
    const cartographic = C.Cartographic.fromDegrees(entry.point[0], entry.point[1]);
    let height = 0;
    try { const sampled = viewer.scene.globe.getHeight(cartographic); if (Number.isFinite(sampled)) height = sampled; } catch { /* 지형 미수신: 타원체 높이 사용 */ }
    const world = C.Cartesian3.fromDegrees(entry.point[0], entry.point[1], height);
    try { return toWindow(viewer.scene, world) || null; } catch { return null; }
  }

  function layout(force = false) {
    if (!entries.length) return;
    const now = Date.now(), signature = cameraSignature();
    if (!force && !dirty && signature === lastSignature) return;
    if (!force && now - lastRun < LAYOUT_INTERVAL_MS) { dirty = true; return; }
    lastRun = now; lastSignature = signature; dirty = false;

    const canvas = viewer.scene.canvas, viewport = {width: canvas.clientWidth, height: canvas.clientHeight};
    if (!viewport.width || !viewport.height) return;
    const fontPx = labelFontPx(viewport.width);
    const items = entries.map(entry => {
      const p = screenPoint(entry);
      return {id: entry.id, x: p ? p.x : NaN, y: p ? p.y : NaN, name: entry.name, priority: entry.id === selectedDong ? 1 : 0};
    });
    if (items.every(item => !Number.isFinite(item.x))) { fallback(fontPx); return; }
    const plan = planLabels(items, viewport, {fontPx});
    const byId = new Map(plan.labels.map(label => [label.id, label]));
    let changed = false;
    for (const entry of entries) {
      const planned = byId.get(entry.id), label = entry.entity.label, selected = entry.id === selectedDong;
      const key = `${planned.mode}|${Math.round(planned.dx)}|${Math.round(planned.dy)}|${fontPx}|${selected}`;
      if (entry.key === key) continue;
      entry.key = key; changed = true;
      label.show = planned.mode !== 'hidden';
      if (planned.mode === 'hidden') continue;
      label.text = planned.text;
      label.font = `${selected ? 'bold ' : ''}${fontPx}px sans-serif`;
      label.backgroundColor = hex(selected ? '#0752a7' : '#102b46', 0.94);
      label.pixelOffset = new C.Cartesian2(planned.dx, planned.dy);
    }
    lastCounts = plan.counts;
    if (changed) {
      // 글자 그림(glyph)은 몇 프레임에 걸쳐 만들어진다. 요청 때만 그리는 모드에서도 끝까지 그려지도록 다시 요청한다.
      requestRender();
      for (const delay of [80, 300, 900]) setTimeout(requestRender, delay);
    }
  }

  /**
   * 화면 좌표를 구하지 못하는 SDK(구버전 등)에서의 대비책.
   * 겹침을 판단할 수 없으므로 선택한 동의 전체 이름만 표시한다.
   */
  function fallback(fontPx) {
    for (const entry of entries) {
      const selected = entry.id === selectedDong, key = `fallback|${fontPx}|${selected}`;
      if (entry.key === key) continue;
      entry.key = key;
      const label = entry.entity.label;
      label.show = selected;
      label.text = entry.name;
      label.font = `${selected ? 'bold ' : ''}${fontPx}px sans-serif`;
      label.backgroundColor = hex(selected ? '#0752a7' : '#102b46', 0.94);
      label.pixelOffset = new C.Cartesian2(0, 0);
    }
    const shown = entries.filter(entry => entry.id === selectedDong).length;
    lastCounts = {name: shown, hidden: entries.length - shown};
    requestRender();
  }

  const onPostRender = () => layout(false);
  viewer.scene.postRender?.addEventListener(onPostRender);
  // requestRenderMode에서는 화면이 멈춰 있으면 postRender가 오지 않으므로, 미뤄 둔 재배치를 주기적으로 확인한다.
  const timer = setInterval(() => { if (dirty) layout(true); }, 400);

  return {
    set,
    layout,
    counts: () => lastCounts,
    destroy() { clearInterval(timer); viewer.scene.postRender?.removeEventListener(onPostRender); clear(); }
  };
}
