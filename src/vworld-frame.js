/* Official VWorld 3.0 SDK bridge. Authentication and coverage must be tested on the registered deployment domain. */
(() => {
  let sdkMap, viewer, overlays, initialized = false, attempts = 0, poll, cachedMessage, boundarySource, pendingBoundary, pendingCamera, boundaryGeneration=0, lastState={};
  let cameraState={center:[126.859,35.151],zoom:14.5,pitch:57,bearing:-28};
  const notice = document.getElementById('frame-notice');
  const colorMap = { park: '#58d6b2', recycle: '#f6bb61', shelter: '#76b9ff', care: '#b29afa',admin:'#7fcbd6',parking:'#c4b06e',health:'#f29baa',culture:'#83bdeb',toilet:'#9fc9b4' };
  const tell = (type, data = {}) => parent.postMessage({ seoOn: true, type, ...data }, location.origin);
  function fail(message) { notice.textContent = message; tell('error', { message }); }
  // Documented in V-world's 2026 training sample; no private primitive-name guessing.
  function nativeBuildings(show){
    try { const layer=sdkMap?.getLayerElement?.('facility_build');
      if(!layer||typeof layer.show!=='function'||typeof layer.hide!=='function')return false;
      if(show)layer.show();else layer.hide();return true;
    }catch{return false;}
  }
  function initViewer() {
    if (initialized || !window.Cesium || !window.ws3d?.viewer) return false;
    const C = window.Cesium; viewer = window.ws3d.viewer;
    if (!viewer.entities || !viewer.scene) return false;
    initialized = true; clearInterval(poll); overlays = new C.CustomDataSource('seo-on-administration'); viewer.dataSources.add(overlays);
    // Do not remove or hide provider logos and attribution.
    notice.textContent = '브이월드 3D · 건물·지형 제공범위와 기준일 확인 필요';
    const handler = new C.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction(event => {
      const picks=viewer.scene.drillPick?.(event.position,10)||[viewer.scene.pick(event.position)];
      if(!lastState.pickMode){
        for(const picked of picks){const id=picked?.id?.properties?.facilityId?.getValue?.();if(id){tell('select',{id});return;}}
        for(const picked of picks){const id=picked?.id?.properties?.dongId?.getValue?.();if(id){tell('dong',{id});return;}}
      }
      const ray = viewer.camera.getPickRay(event.position), point = ray && viewer.scene.globe.pick(ray, viewer.scene);
      if (point) { const c = C.Cartographic.fromCartesian(point); tell('click', { coordinates: [C.Math.toDegrees(c.longitude), C.Math.toDegrees(c.latitude)] }); }
    }, C.ScreenSpaceEventType.LEFT_CLICK);
    tell('ready');
    if (cachedMessage) update(cachedMessage);if(pendingBoundary)setBoundary(pendingBoundary);if(pendingCamera)cameraTo(pendingCamera);
    tell('diagnostics',{details:{engine:'vworld',sdkReady:true,nativeBuildingStatus:'unverified',nativeBuildingControl:nativeBuildings(true),note:'SDK 초기화만 확인. 타일 수신·도메인 인증·건물 최신성은 실제 화면에서 확인.'}});
    return true;
  }
  function cameraTo(camera) {
    cameraState={...cameraState,...camera};camera=cameraState;
    const C = window.Cesium, target = C.Cartesian3.fromDegrees(camera.center[0], camera.center[1], 0);
    const range = Math.max(220, Math.min(30000, 4800 / 2 ** ((camera.zoom || 14.7) - 14.7)));
    viewer.camera.flyToBoundingSphere(new C.BoundingSphere(target, 50), { duration: 1.5,
      offset: new C.HeadingPitchRange(C.Math.toRadians(camera.bearing || 0), -C.Math.toRadians(90-Math.max(0,Math.min(70,camera.pitch??57))), range) });
  }
  function update(message) {
    if (!initialized) { cachedMessage = message; return; }
    const C = window.Cesium, { features = [], projects = [], state = {} } = message;
    lastState=state;styleBoundary();nativeBuildings(state.layers?.buildings!==false);overlays.entities.removeAll();
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
    if(state.layers?.projects)for(const p of projects.slice(0,100)){
      if(p.geometry?.type==='LineString')overlays.entities.add({name:p.properties?.name||'',polyline:{positions:C.Cartesian3.fromDegreesArray(p.geometry.coordinates.flat()),width:4,clampToGround:true,material:C.Color.fromCssColorString('#f0bc6b')}});
      const polygons=p.geometry?.type==='Polygon'?[p.geometry.coordinates]:p.geometry?.type==='MultiPolygon'?p.geometry.coordinates:[];
      for(const rings of polygons)overlays.entities.add({name:p.properties?.name||'',polygon:{hierarchy:new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(rings[0].flat()),rings.slice(1).map(r=>new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(r.flat())))),material:C.Color.fromCssColorString('#f0bc6b').withAlpha(.22),heightReference:C.HeightReference.CLAMP_TO_GROUND,outline:true,outlineColor:C.Color.fromCssColorString('#f0bc6b')}});
      if(p.geometry?.type==='Point')overlays.entities.add({name:p.properties?.name||'',position:C.Cartesian3.fromDegrees(...p.geometry.coordinates),point:{pixelSize:10,color:C.Color.GOLD,heightReference:C.HeightReference.CLAMP_TO_GROUND}});
    }
    if (state.radiusCenter) overlays.entities.add({ position: C.Cartesian3.fromDegrees(...state.radiusCenter), ellipse: { semiMajorAxis: state.radiusMeters, semiMinorAxis: state.radiusMeters, material: C.Color.fromCssColorString('#6ee1c5').withAlpha(.18), outline: true, outlineColor: C.Color.fromCssColorString('#6ee1c5'), heightReference: C.HeightReference.CLAMP_TO_GROUND } });
    if (state.candidate||state.scenario) overlays.entities.add({ position: C.Cartesian3.fromDegrees(...(state.candidate||state.scenario)), point: { pixelSize: 16, color: C.Color.GOLD, outlineColor: C.Color.WHITE, outlineWidth: 2, heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY }, label: { text: state.candidate?'좌표 후보':'가상 시설', font: '13px sans-serif', pixelOffset: new C.Cartesian2(0, -23), heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY } });
    // Native buildings are controlled only through the documented facility_build layer API.
    notice.textContent = `${state.dataset === 'demo' ? '시설·통계·사업은 합성 시연자료 · ' : '등록자료는 미검수 · '}브이월드 원본 건물 스타일·표시 설정은 제공 API에 따릅니다.`;
    viewer.scene.requestRender?.();
  }
  function styleBoundary(){
    if(!boundarySource)return;const C=window.Cesium;
    boundarySource.show=lastState.layers?.boundaries!==false;
    for(const entity of boundarySource.entities.values){
      const selected=entity.properties?.dongId?.getValue?.()===lastState.dongId;
      if(entity.polygon){entity.polygon.material=C.Color.AQUAMARINE.withAlpha(selected ? .22 : .035);entity.polygon.outline=true;entity.polygon.outlineColor=C.Color.AQUAMARINE.withAlpha(selected?1:.6);}
    }
    viewer.scene.requestRender?.();
  }
  async function setBoundary(data){
    pendingBoundary=data;if(!initialized)return;const generation=++boundaryGeneration,C=window.Cesium;
    try{
      const next=await C.GeoJsonDataSource.load(data,{clampToGround:true,stroke:C.Color.AQUAMARINE,strokeWidth:2,fill:C.Color.TRANSPARENT});
      if(generation!==boundaryGeneration)return;
      for(const f of data.features||[]){const p=f.properties||{};if(p.labelPoint)next.entities.add({properties:{dongId:p.dongId},position:C.Cartesian3.fromDegrees(...p.labelPoint),label:{text:String(p.dongName||''),font:'13px sans-serif',fillColor:C.Color.WHITE,outlineColor:C.Color.BLACK,outlineWidth:3,style:C.LabelStyle.FILL_AND_OUTLINE,heightReference:C.HeightReference.CLAMP_TO_GROUND,disableDepthTestDistance:Number.POSITIVE_INFINITY}});}
      if(boundarySource)viewer.dataSources.remove(boundarySource,true);
      boundarySource=next;await viewer.dataSources.add(next);styleBoundary();
    }catch{tell('error',{message:'행정동 경계 표현 실패. 기본 웹지도로 확인하세요.'});}
  }
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== parent || !event.data?.seoOn) return;
    const m = event.data;
    if (m.type === 'update') { update(m); return; }
    if(m.type==='boundary'){setBoundary(m.data);return;}
    if(m.type==='camera'){pendingCamera=m.camera;if(initialized)cameraTo(m.camera);return;}
    if (!initialized) return;
    if (m.type === 'zoom') viewer.camera[m.value > 0 ? 'zoomIn' : 'zoomOut'](viewer.camera.positionCartographic.height * .28);
    if (m.type === 'rotate') viewer.camera.rotateRight(window.Cesium.Math.toRadians(m.value));
    if(m.type==='tilt')cameraTo({...cameraState,pitch:m.is3D?57:0});

  });
  try {
    if (!window.vw?.Map) throw new Error('브이월드 SDK를 받지 못했습니다. 키·등록 도메인·네트워크를 확인하세요.');
    window.vw.ws3dInitCallBack = initViewer;
    const map = sdkMap = new window.vw.Map();
    map.setOption({ mapId: 'vmap', initPosition: new window.vw.CameraPosition(new window.vw.CoordZ(126.859, 35.128, 3200), new window.vw.Direction(0, -45, 0)), logo: true, navigation: false });
    map.start();
    poll = setInterval(() => { if (!initViewer() && ++attempts > 80) { clearInterval(poll); fail('브이월드 초기화 대기 초과. 발급 키·도메인·서비스 승인을 확인하세요.'); } }, 250);
  } catch (error) { fail(error.message || '브이월드 초기화 실패'); }
})();
