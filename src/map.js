import { APP, CATEGORIES } from './config.js';
import { collection, circlePolygon, metricAt, pointFeature } from './geo.js';
import { PreviewScene } from './preview-scene.js';

function loadClassicScript(src, timeoutMs = 9000) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = src; script.async = true;
    const timer = setTimeout(() => { script.remove(); reject(new Error('지도 라이브러리 접속 시간 초과')); }, timeoutMs);
    script.onload = () => { clearTimeout(timer); resolve(); };
    script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('지도 라이브러리 접속 실패')); };
    document.head.append(script);
  });
}
async function ensureMapLibre() {
  if (window.maplibregl?.Map) return window.maplibregl;
  let lastError;
  for (const host of ['https://unpkg.com', 'https://cdn.jsdelivr.net/npm']) {
    const base = `${host}/maplibre-gl@${APP.mapVersion}/dist/`;
    try {
      await loadClassicScript(`${base}maplibre-gl.js`);
      if (!window.maplibregl?.Map) throw new Error('지도 라이브러리 형식 확인 실패');
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = `${base}maplibre-gl.css`; document.head.append(css);
      return window.maplibregl;
    } catch (error) { lastError = error; }
  }
  throw lastError;
}

export class CityMap {
  constructor(container, callbacks) {
    this.container = container; this.callbacks = callbacks; this.mode = null; this.map = null; this.preview = null; this.frame = null;
    this.ready = false; this.generation = 0; this.last = null; this.boundary = null; this.markers = [];
    this.messageListener = event => {
      if (!this.frame || event.origin !== location.origin || event.source !== this.frame.contentWindow || !event.data?.seoOn) return;
      if (event.data.type === 'ready') { this.ready = true; this.callbacks.status('connected', '브이월드 3D 연결 · 자료 최신성 별도 확인'); if (this.last) this.update(...this.last); }
      if (event.data.type === 'error') this.callbacks.status('error', String(event.data.message || '브이월드 연결 실패'));
      if (event.data.type === 'select') {
        const f = this.last?.[0].find(f => f.properties.id === event.data.id); if (f) this.callbacks.select(f);
      }
      if (event.data.type === 'click' && Array.isArray(event.data.coordinates)) this.callbacks.click(event.data.coordinates);
    };
    window.addEventListener('message', this.messageListener);
  }
  async start(mode, theme) {
    const run = ++this.generation; this.cleanup(); this.mode = mode; this.theme = theme; this.ready = false;
    if (mode === 'preview') {
      this.preview = new PreviewScene(this.container, this.callbacks.select, this.callbacks.click); this.ready = true;
      this.callbacks.status('preview', '디자인 미리보기 · 가상 도시 / 실제 지도 아님');
      if (this.last) this.update(...this.last); return;
    }
    if (mode === 'vworld') {
      this.callbacks.status('loading', '브이월드 인증·3D 지도 연결 중');
      this.frame = document.createElement('iframe'); this.frame.className = 'vworld-frame'; this.frame.title = '브이월드 3D 서구 지도'; this.frame.src = '/api/vworld-scene';
      this.container.append(this.frame);
      this.frameTimeout = setTimeout(() => { if (!this.ready) this.callbacks.status('error', '브이월드 연결 대기 초과 · 키/도메인/서비스 승인 확인'); }, 20000);
      return;
    }
    this.callbacks.status('loading', '실제 서구 지도 연결 중 · OpenStreetMap');
    try {
      const gl = await ensureMapLibre(); if (run !== this.generation) return;
      // MapLibre 5.6.1 does not export maplibregl.supported(). The Map constructor
      // performs WebGL initialization; its errors are handled by the catch below.
      if (typeof gl.Map !== 'function') throw new Error('지도 라이브러리 초기화에 실패했습니다.');
      const response = await fetch(`https://tiles.openfreemap.org/styles/${theme === 'dark' ? 'dark' : 'positron'}`, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('기본 지도 서버에서 지도를 받지 못했습니다.');
      const style = await response.json(); if (run !== this.generation) return;
      // Declutter small POI text; labels and roads remain real provider data.
      style.layers = style.layers.filter(layer => !/poi|housenumber/i.test(layer.id));
      for (const layer of style.layers) if (layer.type === 'fill-extrusion') layer.layout = { ...layer.layout, visibility: 'none' };
      this.map = new gl.Map({ container: this.container, style, center: APP.center, zoom: 14.5, pitch: 57, bearing: -28,
        maxPitch: 70, minZoom: 11, maxZoom: 18.5, maxBounds: APP.bounds,
        canvasContextAttributes: { antialias: true, preserveDrawingBuffer: true }, attributionControl: false });
      this.map.addControl(new gl.AttributionControl({ compact: false }), 'bottom-right');
      this.map.addControl(new gl.ScaleControl({ maxWidth: 90, unit: 'metric' }), 'bottom-left');
      this.map.once('load', () => {
        if (run !== this.generation) return;
        try { this.addLayers(); this.ready = true; this.callbacks.status('connected', '실제 지도 · OSM 건물 / 높이는 추정 포함'); if (this.last) this.update(...this.last); }
        catch (e) { this.callbacks.status('error', e.message || '지도 레이어 초기화 실패'); }
      });
      let tileErrors = 0;
      this.map.on('error', event => {
        tileErrors++;
        if (!this.ready || tileErrors > 5) this.callbacks.status('error', '지도 또는 일부 타일을 불러오지 못했습니다. 네트워크를 확인하세요.');
        console.warn('Map provider error', event.error?.name || 'MapError');
      });
      this.map.on('click', event => {
        if (!this.ready) return;
        const selected = this.map.queryRenderedFeatures(event.point, { layers: ['facility-dot', 'metric-columns'] });
        if (selected.length) {
          const feature = this.last?.[0].find(f => f.properties.id === selected[0].properties?.id);
          if (feature) { this.callbacks.select(feature); return; }
        }
        this.callbacks.click([event.lngLat.lng, event.lngLat.lat]);
      });
      this.map.on('mouseenter', 'facility-dot', () => { this.map.getCanvas().style.cursor = 'pointer'; });
      this.map.on('mouseleave', 'facility-dot', () => { this.map.getCanvas().style.cursor = ''; });
      this.loadTimeout = setTimeout(() => { if (!this.ready) this.callbacks.status('error', '지도 초기화 시간이 초과되었습니다. 네트워크나 WebGL 설정을 확인하세요.'); }, 22000);
    } catch (error) { if (run === this.generation) this.callbacks.status('error', error.message || '지도 연결 실패'); }
  }
  addLayers() {
    const map = this.map;
    map.addSource('seo-buildings', { type: 'vector', url: 'https://tiles.openfreemap.org/planet' });
    map.addLayer({ id: 'seo-buildings', source: 'seo-buildings', 'source-layer': 'building', type: 'fill-extrusion', minzoom: 13,
      filter: ['!=', ['get', 'hide_3d'], true], paint: {
        'fill-extrusion-color': this.theme === 'dark' ? '#5b7482' : '#d6dacf',
        'fill-extrusion-height': ['case', ['has', 'render_height'], ['max', 3, ['to-number', ['get', 'render_height'], 8]], 8],
        'fill-extrusion-base': ['max', 0, ['to-number', ['get', 'render_min_height'], 0]],
        'fill-extrusion-opacity': .9, 'fill-extrusion-vertical-gradient': true,
      } });
    for (const name of ['facilities', 'columns', 'radius', 'projects', 'scenario', 'boundary']) map.addSource(name, { type: 'geojson', data: collection() });
    map.addLayer({ id: 'boundary-line', type: 'line', source: 'boundary', paint: { 'line-color': '#68d4c0', 'line-width': 2, 'line-opacity': .85 } });
    map.addLayer({ id: 'radius-fill', type: 'fill', source: 'radius', paint: { 'fill-color': '#66dec0', 'fill-opacity': .12 } });
    map.addLayer({ id: 'radius-line', type: 'line', source: 'radius', paint: { 'line-color': '#6fe8c6', 'line-width': 2, 'line-dasharray': [3, 2] } });
    map.addLayer({ id: 'project-lines', type: 'line', source: 'projects', paint: { 'line-color': '#f0bc6b', 'line-width': 4, 'line-dasharray': [3, 2] } });
    map.addLayer({ id: 'metric-columns', type: 'fill-extrusion', source: 'columns', paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'renderHeight'], 'fill-extrusion-opacity': .86, 'fill-extrusion-vertical-gradient': true } });
    map.addLayer({ id: 'facility-glow', type: 'circle', source: 'facilities', paint: { 'circle-color': ['get', 'color'], 'circle-radius': 11, 'circle-blur': 1, 'circle-opacity': .5 } });
    map.addLayer({ id: 'facility-dot', type: 'circle', source: 'facilities', paint: { 'circle-color': ['get', 'color'], 'circle-radius': ['case', ['get', 'selected'], 7, 4.5], 'circle-stroke-color': this.theme === 'dark' ? '#172c37' : '#fff', 'circle-stroke-width': 1.8 } });
    map.addLayer({ id: 'scenario-dot', type: 'circle', source: 'scenario', paint: { 'circle-color': '#e7cb89', 'circle-radius': 10, 'circle-stroke-width': 3, 'circle-stroke-color': '#fff5c9', 'circle-opacity': .6 } });
  }
  update(features, projects, state) {
    this.last = [features, projects, state];
    if (!this.ready) return;
    if (this.preview) { this.preview.update(features, projects, state); return; }
    if (this.frame) { this.send({ type: 'update', features: features.slice(0, 500), projects, state }); return; }
    if (!this.map) return;
    const draw = features.slice(0, 1000).map(f => ({ ...f, properties: { id: f.properties.id, name: f.properties.name, color: CATEGORIES[f.properties.category].color, selected: f.properties.id === state.selectedId } }));
    this.map.getSource('facilities').setData(collection(draw));
    const cols = features.slice(0, 500).filter(f => metricAt(f, state.month) !== null).map(f => ({ type: 'Feature', geometry: circlePolygon(f.geometry.coordinates, 33, 16), properties: {
      id: f.properties.id, color: CATEGORIES[f.properties.category].color, renderHeight: Math.min(600, 40 + metricAt(f, state.month) * 1.8),
    } }));
    this.map.getSource('columns').setData(collection(cols));
    this.map.getSource('radius').setData(state.radiusCenter ? collection([{ type: 'Feature', properties: {}, geometry: circlePolygon(state.radiusCenter, state.radiusMeters) }]) : collection());
    this.map.getSource('projects').setData(collection(projects));
    this.map.getSource('scenario').setData(state.scenario ? collection([pointFeature(state.scenario)]) : collection());
    const vis = (id, value) => this.map.setLayoutProperty(id, 'visibility', value ? 'visible' : 'none');
    vis('seo-buildings', state.layers.buildings); vis('metric-columns', state.layers.columns && state.is3D);
    vis('facility-dot', state.layers.facilities); vis('facility-glow', state.layers.facilities); vis('project-lines', state.layers.projects);
    if (this.boundary) this.map.getSource('boundary').setData(this.boundary);
  }
  send(message) { this.frame?.contentWindow?.postMessage({ seoOn: true, ...message }, location.origin); }
  flyTo(camera) {
    if (this.preview) this.preview.flyTo(camera);
    else if (this.frame) this.send({ type: 'camera', camera });
    else this.map?.flyTo({ ...camera, duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1800, essential: false });
  }
  set3D(is3D) { if (this.preview) this.preview.setPitch(is3D ? 57 : 0); else if (this.frame) this.send({ type: 'tilt', is3D }); else this.map?.easeTo({ pitch: is3D ? 57 : 0, duration: 700 }); }
  zoomBy(value) { if (this.preview) this.preview.zoomBy(value); else if (this.frame) this.send({ type: 'zoom', value }); else this.map?.zoomTo(this.map.getZoom() + value, { duration: 350 }); }
  rotate(value = 20) { if (this.preview) this.preview.rotate(value); else if (this.frame) this.send({ type: 'rotate', value }); else if (this.map) this.map.easeTo({ bearing: this.map.getBearing() + value, duration: 900 }); }
  setBoundary(data) { this.boundary = data; if (this.map?.getSource('boundary')) this.map.getSource('boundary').setData(data); if (this.frame) this.send({ type: 'boundary', data }); }
  screenshot() { try { return this.preview?.screenshot() || this.map?.getCanvas().toDataURL('image/png') || null; } catch { return null; } }
  cleanup() {
    clearTimeout(this.frameTimeout); clearTimeout(this.loadTimeout); this.preview?.destroy(); this.preview = null;
    this.map?.remove(); this.map = null; this.frame?.remove(); this.frame = null; this.container.replaceChildren(); this.ready = false;
  }
  destroy() { this.generation++; this.cleanup(); window.removeEventListener('message', this.messageListener); }
}
