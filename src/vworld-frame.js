/* Official VWorld 3.0 SDK bridge. Authentication and coverage must be tested on the registered deployment domain. */
(() => {
  let viewer, overlays, initialized = false, attempts = 0, poll, cachedMessage;
  const notice = document.getElementById('frame-notice');
  const colorMap = { park: '#58d6b2', recycle: '#f6bb61', shelter: '#76b9ff', care: '#b29afa' };
  const tell = (type, data = {}) => parent.postMessage({ seoOn: true, type, ...data }, location.origin);
  function fail(message) { notice.textContent = message; tell('error', { message }); }
  function initViewer() {
    if (initialized || !window.Cesium || !window.ws3d?.viewer) return false;
    const C = window.Cesium; viewer = window.ws3d.viewer;
    if (!viewer.entities || !viewer.scene) return false;
    initialized = true; clearInterval(poll); overlays = new C.CustomDataSource('seo-on-administration'); viewer.dataSources.add(overlays);
    // Do not remove or hide provider logos and attribution.
    notice.textContent = '브이월드 3D · 건물·지형 제공범위와 기준일 확인 필요';
    const handler = new C.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction(event => {
      const picked = viewer.scene.pick(event.position);
      const id = picked?.id?.properties?.facilityId?.getValue?.();
      if (id) { tell('select', { id }); return; }
      const ray = viewer.camera.getPickRay(event.position), point = ray && viewer.scene.globe.pick(ray, viewer.scene);
      if (point) { const c = C.Cartographic.fromCartesian(point); tell('click', { coordinates: [C.Math.toDegrees(c.longitude), C.Math.toDegrees(c.latitude)] }); }
    }, C.ScreenSpaceEventType.LEFT_CLICK);
    tell('ready');
    if (cachedMessage) update(cachedMessage);
    return true;
  }
  function cameraTo(camera) {
    const C = window.Cesium, target = C.Cartesian3.fromDegrees(camera.center[0], camera.center[1], 0);
    const range = Math.max(700, Math.min(12000, 4800 / 2 ** ((camera.zoom || 14.7) - 14.7)));
    viewer.camera.flyToBoundingSphere(new C.BoundingSphere(target, 50), { duration: 1.5,
      offset: new C.HeadingPitchRange(C.Math.toRadians(camera.bearing || 0), -C.Math.toRadians(camera.pitch === 0 ? 90 : 40), range) });
  }
  function update(message) {
    if (!initialized) { cachedMessage = message; return; }
    const C = window.Cesium, { features = [], projects = [], state = {} } = message;
    overlays.entities.removeAll();
    for (const f of features.slice(0, 500)) {
      const coords = f.geometry?.coordinates, p = f.properties || {};
      if (f.geometry?.type !== 'Point' || !coords || !coords.every(Number.isFinite)) continue;
      const [lon, lat] = coords, color = C.Color.fromCssColorString(colorMap[p.category] || '#58d6b2');
      const carto = C.Cartographic.fromDegrees(lon, lat), terrainHeight = viewer.scene.globe.getHeight(carto) || 0;
      if (state.layers?.facilities !== false) overlays.entities.add({
        id: `dot-${p.id}`, name: String(p.name || ''), properties: { facilityId: p.id }, position: C.Cartesian3.fromDegrees(lon, lat, 0),
        point: { pixelSize: p.id === state.selectedId ? 12 : 8, color, outlineColor: C.Color.WHITE.withAlpha(.8), outlineWidth: 1, heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY },
      });
      const value = p.monthly?.[state.month];
      if (state.layers?.columns && state.is3D && Number.isFinite(value) && value >= 0) {
        const length = Math.min(600, 40 + value * 1.8);
        overlays.entities.add({ id: `column-${p.id}`, properties: { facilityId: p.id }, position: C.Cartesian3.fromDegrees(lon, lat, terrainHeight + length / 2), cylinder: { length, topRadius: 33, bottomRadius: 33, material: color.withAlpha(.8), numberOfVerticalLines: 0 } });
      }
    }
    if (state.layers?.projects) for (const p of projects.slice(0, 100)) if (p.geometry?.type === 'LineString') overlays.entities.add({ name: p.properties?.name || '', polyline: { positions: C.Cartesian3.fromDegreesArray(p.geometry.coordinates.flat()), width: 4, clampToGround: true, material: C.Color.fromCssColorString('#f0bc6b') } });
    if (state.radiusCenter) overlays.entities.add({ position: C.Cartesian3.fromDegrees(...state.radiusCenter), ellipse: { semiMajorAxis: state.radiusMeters, semiMinorAxis: state.radiusMeters, material: C.Color.fromCssColorString('#6ee1c5').withAlpha(.18), outline: true, outlineColor: C.Color.fromCssColorString('#6ee1c5'), heightReference: C.HeightReference.CLAMP_TO_GROUND } });
    if (state.scenario) overlays.entities.add({ position: C.Cartesian3.fromDegrees(...state.scenario), point: { pixelSize: 16, color: C.Color.GOLD, outlineColor: C.Color.WHITE, outlineWidth: 2, heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY }, label: { text: '가상 시설', font: '13px sans-serif', pixelOffset: new C.Cartesian2(0, -23), heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY } });
    // SDK buildings cannot safely be controlled by guessing internal primitives.
    notice.textContent = `${state.dataset === 'demo' ? '시설·통계·사업은 합성 시연자료 · ' : '등록자료는 미검수 · '}브이월드 원본 건물 스타일·표시 설정은 제공 API에 따릅니다.`;
    viewer.scene.requestRender?.();
  }
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== parent || !event.data?.seoOn) return;
    const m = event.data;
    if (m.type === 'update') { update(m); return; }
    if (!initialized) return;
    if (m.type === 'camera') cameraTo(m.camera);
    if (m.type === 'zoom') viewer.camera[m.value > 0 ? 'zoomIn' : 'zoomOut'](viewer.camera.positionCartographic.height * .28);
    if (m.type === 'rotate') viewer.camera.rotateRight(window.Cesium.Math.toRadians(m.value));
    if (m.type === 'tilt') { const c = viewer.camera.positionCartographic; cameraTo({ center: [window.Cesium.Math.toDegrees(c.longitude), window.Cesium.Math.toDegrees(c.latitude)], zoom: 14.7, pitch: m.is3D ? 55 : 0 }); }
    if (m.type === 'boundary') window.Cesium.GeoJsonDataSource.load(m.data, { clampToGround: true, stroke: window.Cesium.Color.AQUAMARINE, strokeWidth: 3, fill: window.Cesium.Color.TRANSPARENT }).then(source => viewer.dataSources.add(source)).catch(() => tell('error', { message: '경계 자료 표현 실패' }));
  });
  try {
    if (!window.vw?.Map) throw new Error('브이월드 SDK를 받지 못했습니다. 키·등록 도메인·네트워크를 확인하세요.');
    window.vw.ws3dInitCallBack = initViewer;
    const map = new window.vw.Map();
    map.setOption({ mapId: 'vmap', initPosition: new window.vw.CameraPosition(new window.vw.CoordZ(126.859, 35.128, 3200), new window.vw.Direction(0, -45, 0)), logo: true, navigation: false });
    map.start();
    poll = setInterval(() => { if (!initViewer() && ++attempts > 80) { clearInterval(poll); fail('브이월드 초기화 대기 초과. 발급 키·도메인·서비스 승인을 확인하세요.'); } }, 250);
  } catch (error) { fail(error.message || '브이월드 초기화 실패'); }
})();
