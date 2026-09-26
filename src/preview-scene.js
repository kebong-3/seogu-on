import { seededRandom } from './data.js';
import { APP, CATEGORIES } from './config.js';
import { distanceMeters, metricAt, geometryCenter } from './geo.js';

/**
 * Offline DESIGN preview only. Every building, road, park and water shape is synthetic.
 * This renderer is never silently used as a replacement for a failed real map.
 */
export class PreviewScene {
  constructor(container, onSelect, onMapClick) {
    this.container = container; this.onSelect = onSelect; this.onMapClick = onMapClick;
    this.canvas = document.createElement('canvas'); this.canvas.className = 'preview-canvas';
    this.canvas.setAttribute('aria-label', '가상 도시 도형으로 만든 디자인 미리보기. 실제 서구 지도 아님.');
    container.replaceChildren(this.canvas); this.ctx = this.canvas.getContext('2d');
    this.camera = { center: [...APP.center], zoom: 14.7, pitch: 57, bearing: -28 };
    this.theme = 'dark'; this.features = []; this.projects = []; this.scenario = null; this.state = null;
    this.hitTargets = []; this.dragged = false;
    const rand = seededRandom(5703); this.buildings = [];
    for (let row = -31; row <= 31; row++) for (let col = -35; col <= 35; col++) {
      const x = col * 86, y = row * 100;
      const edge = (x / 3450) ** 2 + (y / 3280) ** 2;
      const river = -2450 + 200 * Math.sin(y / 900);
      const park = ((x - 900) / 550) ** 2 + ((y - 250) / 730) ** 2 < 1;
      if (edge > 1 || x < river || park || col % 9 === 0 || row % 10 === 0 || rand() < .14) continue;
      const h = rand() > .9 ? 55 + rand() * 155 : 7 + rand() * 30;
      this.buildings.push({ x: x + rand() * 9, y: y + rand() * 8, w: 34 + rand() * 35, d: 34 + rand() * 42, h, tone: rand() });
    }
    this.observer = new ResizeObserver(() => this.draw()); this.observer.observe(container);
    this.canvas.addEventListener('pointerdown', e => { this.drag = { x: e.clientX, y: e.clientY, b: this.camera.bearing }; this.dragged = false; });
    this.canvas.addEventListener('pointermove', e => {
      if (this.drag && e.buttons === 1) {
        const dx = e.clientX - this.drag.x;
        if (Math.abs(dx) > 4) this.dragged = true;
        this.camera.bearing = this.drag.b + dx * .12; this.draw();
      }
    });
    this.canvas.addEventListener('pointerup', () => { this.drag = null; });
    this.canvas.addEventListener('click', e => {
      if (this.dragged) return;
      const r = this.canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      const hit = this.hitTargets.find(p => Math.hypot(p.x - x, p.y - y) < 14);
      if (hit) this.onSelect?.(hit.feature);
      else this.onMapClick?.(this.unproject(x, y));
    });
    this.canvas.addEventListener('wheel', e => { e.preventDefault(); this.camera.zoom = Math.min(16.2, Math.max(13.7, this.camera.zoom - e.deltaY * .002)); this.draw(); }, { passive: false });
    this.draw();
  }
  world(c) { return [(c[0] - APP.center[0]) * 91000, (APP.center[1] - c[1]) * 111000]; }
  project(x, y, z = 0) {
    const c = this.world(this.camera.center), a = this.camera.bearing * Math.PI / 180;
    x -= c[0]; y -= c[1];
    const xx = x * Math.cos(a) - y * Math.sin(a), yy = x * Math.sin(a) + y * Math.cos(a);
    const s = .133 * 2 ** (this.camera.zoom - 14.7) * Math.min(1.32, this.w / 1280);
    const tilt = this.camera.pitch < 10 ? 1 : .51;
    const zscale = this.camera.pitch < 10 ? 0 : .93;
    return [this.w * .53 + xx * s, this.h * .54 + yy * s * tilt - z * s * zscale];
  }
  unproject(sx, sy) {
    const a = this.camera.bearing * Math.PI / 180, c = this.world(this.camera.center);
    const s = .133 * 2 ** (this.camera.zoom - 14.7) * Math.min(1.32, this.w / 1280);
    const xx = (sx - this.w * .53) / s, yy = (sy - this.h * .54) / s / (this.camera.pitch < 10 ? 1 : .51);
    const x = xx * Math.cos(a) + yy * Math.sin(a) + c[0], y = -xx * Math.sin(a) + yy * Math.cos(a) + c[1];
    return [APP.center[0] + x / 91000, APP.center[1] - y / 111000];
  }
  path(pts, fill, stroke, lineWidth = 1) {
    const ctx = this.ctx; ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(...p) : ctx.moveTo(...p)); ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke(); }
  }
  draw() {
    if (!this.ctx) return;
    const rect = this.container.getBoundingClientRect(); this.w = rect.width || 1400; this.h = rect.height || 850;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = this.w * dpr; this.canvas.height = this.h * dpr;
    this.canvas.style.width = `${this.w}px`; this.canvas.style.height = `${this.h}px`;
    const ctx = this.ctx; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const dark = this.theme === 'dark';
    ctx.fillStyle = dark ? '#0c1923' : '#e5eae9'; ctx.fillRect(0, 0, this.w, this.h);
    const gradient = ctx.createRadialGradient(this.w * .58, this.h * .5, 10, this.w * .58, this.h * .5, this.w * .65);
    gradient.addColorStop(0, dark ? '#193440' : '#f7f7ef'); gradient.addColorStop(1, dark ? '#09131d' : '#dce4e3');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, this.w, this.h);
    // World grid is an illustrative coordinate plane, not cadastral data.
    ctx.lineWidth = .6; ctx.strokeStyle = dark ? 'rgba(83,125,145,.13)' : 'rgba(65,91,101,.12)';
    for (let i = -5000; i <= 5000; i += 400) {
      ctx.beginPath(); ctx.moveTo(...this.project(i, -5000)); ctx.lineTo(...this.project(i, 5000)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(...this.project(-5000, i)); ctx.lineTo(...this.project(5000, i)); ctx.stroke();
    }
    const land = Array.from({ length: 70 }, (_, i) => { const a = i / 70 * Math.PI * 2; return this.project(Math.cos(a) * 3420, Math.sin(a) * 3200); });
    this.path(land, dark ? '#24343d' : '#d9dcd3', dark ? '#548f8b70' : '#adc0b8', 1.5);
    const riverLeft = [], riverRight = [];
    for (let y = -4200; y <= 4200; y += 180) { const x = -2560 + Math.sin(y / 900) * 200; riverLeft.push(this.project(x - 220, y)); riverRight.push(this.project(x + 130, y)); }
    this.path([...riverLeft, ...riverRight.reverse()], dark ? '#102d3b' : '#abc9cd', dark ? '#345769' : '#97b9c1');
    const park = Array.from({ length: 40 }, (_, i) => { const a = i / 40 * Math.PI * 2; return this.project(900 + Math.cos(a) * 550, 250 + Math.sin(a) * 730); });
    this.path(park, dark ? '#234b44' : '#b7cdb6', dark ? '#42776880' : '#a2bba3');
    // Major avenues.
    for (const row of [-2000, -1000, 0, 1000, 2000]) {
      ctx.beginPath(); ctx.moveTo(...this.project(-2700, row)); ctx.lineTo(...this.project(2900, row));
      ctx.strokeStyle = dark ? '#83949f3a' : '#fbfaf0'; ctx.lineWidth = 5; ctx.stroke();
    }
    for (const x of [-1550, -770, 0, 770, 1550, 2300]) {
      ctx.beginPath(); ctx.moveTo(...this.project(x, -2700)); ctx.lineTo(...this.project(x, 2700));
      ctx.strokeStyle = dark ? '#70869644' : '#fbfaf0'; ctx.lineWidth = 4; ctx.stroke();
    }
    const sorted = [...this.buildings].sort((a, b) => this.project(a.x, a.y)[1] - this.project(b.x, b.y)[1]);
    for (const b of sorted) {
      if (this.state?.layers?.buildings === false) continue;
      const h = b.h * (this.camera.pitch < 10 ? 0 : 1.35);
      const a = this.project(b.x, b.y), c = this.project(b.x + b.w, b.y), d = this.project(b.x + b.w, b.y + b.d), e = this.project(b.x, b.y + b.d);
      const at = this.project(b.x, b.y, h), ct = this.project(b.x + b.w, b.y, h), dt = this.project(b.x + b.w, b.y + b.d, h), et = this.project(b.x, b.y + b.d, h);
      this.path([c, d, dt, ct], dark ? '#435764' : '#b3bab9');
      this.path([d, e, et, dt], dark ? '#304450' : '#c2c7c1');
      this.path([at, ct, dt, et], dark ? (b.h > 55 ? '#79929e' : '#526d7b') : (b.h > 55 ? '#f5f4e9' : '#e2e3d9'), dark ? '#90adb42b' : '#a1afa82a', .4);
    }
    if (this.state?.layers?.projects) for (const p of this.projects) {
      const pts = p.geometry.coordinates.map(c => this.project(...this.world(c), 4));
      ctx.beginPath(); pts.forEach((c, i) => i ? ctx.lineTo(...c) : ctx.moveTo(...c));
      ctx.strokeStyle = '#ecb273'; ctx.lineWidth = 3; ctx.setLineDash([7, 4]); ctx.stroke(); ctx.setLineDash([]);
    }
    if (this.state?.radiusCenter) {
      const [x, y] = this.world(this.state.radiusCenter), radius = this.state.radiusMeters;
      const ring = Array.from({ length: 70 }, (_, i) => { const a = i / 70 * Math.PI * 2; return this.project(x + Math.cos(a) * radius, y + Math.sin(a) * radius, 3); });
      this.path(ring, '#6adbb426', '#75e6c9', 2);
    }
    this.hitTargets = [];
    const fs = [...this.features].sort((a, b) => this.project(...this.world(a.geometry.coordinates))[1] - this.project(...this.world(b.geometry.coordinates))[1]);
    for (const f of fs) {
      const [x, y] = this.world(f.geometry.coordinates), [sx, sy] = this.project(x, y, 6);
      const color = CATEGORIES[f.properties.category]?.color || '#5ed8b2';
      if (this.state?.layers?.columns && this.camera.pitch > 10) {
        const value = metricAt(f, this.state.month);
        if (value !== null) {
          const height = 55 + value * 1.8, [tx, ty] = this.project(x, y, height), width = 8;
          const g = ctx.createLinearGradient(tx - width, ty, tx + width, ty); g.addColorStop(0, color + 'ac'); g.addColorStop(.6, color); g.addColorStop(1, color + 'bf');
          ctx.fillStyle = g; ctx.fillRect(tx - width, ty, width * 2, Math.max(0, sy - ty));
          ctx.beginPath(); ctx.ellipse(tx, ty, width, 3.5, 0, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
          ctx.strokeStyle = color + '30'; ctx.lineWidth = 8; ctx.stroke();
          if (f.properties.id === this.selectedId) { ctx.fillStyle = dark ? '#e9f8f4' : '#173530'; ctx.font = 'bold 12px sans-serif'; ctx.fillText(String(value), tx + 14, ty + 4); }
        }
      }
      if (this.state?.layers?.facilities !== false) {
        ctx.beginPath(); ctx.arc(sx, sy, 4.5, 0, Math.PI * 2); ctx.fillStyle = color; ctx.shadowBlur = 12; ctx.shadowColor = color; ctx.fill(); ctx.shadowBlur = 0;
        ctx.strokeStyle = dark ? '#0c2531' : '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
        if (f.properties.id === this.selectedId) { ctx.beginPath(); ctx.arc(sx, sy, 11, 0, Math.PI * 2); ctx.strokeStyle = color; ctx.stroke(); }
        this.hitTargets.push({ x: sx, y: sy, feature: f });
      }
    }
    if (this.scenario) {
      const [sx, sy] = this.project(...this.world(this.scenario), 4);
      ctx.strokeStyle = '#f9e3a0'; ctx.setLineDash([4, 4]); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(sx, sy, 42, 21, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#f9e3a0'; ctx.font = 'bold 12px sans-serif'; ctx.fillText('가상 시설', sx + 9, sy - 12);
    }
    // A permanent disclosure is part of the canvas (also survives screenshots).
    ctx.save(); ctx.fillStyle = dark ? '#d8e9ee' : '#30464c'; ctx.font = '11px sans-serif';
    ctx.textAlign = 'center'; ctx.globalAlpha = .9;
    ctx.fillText('DESIGN PREVIEW  ·  가상 도시 도형 — 실제 서구 지도·건물 아님', this.w * .55, this.h - 172); ctx.restore();
  }
  update(features, projects, state) { this.features = features; this.projects = projects; this.state = state; this.theme = state.theme; this.scenario = state.scenario; this.selectedId = state.selectedId; this.draw(); }
  flyTo(camera) { this.camera = { ...this.camera, ...camera }; this.draw(); }
  setPitch(value) { this.camera.pitch = value; this.draw(); }
  zoomBy(value) { this.camera.zoom = Math.max(13.7, Math.min(16.2, this.camera.zoom + value)); this.draw(); }
  rotate(value) { this.camera.bearing += value; this.draw(); }
  screenshot() { return this.canvas.toDataURL('image/png'); }
  destroy() { this.observer.disconnect(); this.container.replaceChildren(); }
}
