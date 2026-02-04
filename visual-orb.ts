
import {LitElement, css, html} from 'lit';
import {customElement, property} from 'lit/decorators.js';

@customElement('gdm-visual-orb')
export class GdmVisualOrb extends LitElement {
  @property({type: Number}) amp = 0;
  @property({type: Number}) out = 0;

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private mesh = this.buildSphereMesh(18, 28);
  private orbState = { baseR: 80, r: 80, spin: 0 };

  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }
    canvas {
      width: 100%;
      height: 100%;
      display: block;
    }
  `;

  private buildSphereMesh(latSteps = 18, lonSteps = 28) {
    const verts = [];
    const faces = [];
    for (let i = 0; i <= latSteps; i++) {
      const v = i / latSteps;
      const phi = (v - 0.5) * Math.PI;
      const cp = Math.cos(phi), sp = Math.sin(phi);
      for (let j = 0; j <= lonSteps; j++) {
        const u = j / lonSteps;
        const theta = u * Math.PI * 2;
        const ct = Math.cos(theta), st = Math.sin(theta);
        verts.push({ x: cp * ct, y: sp, z: cp * st, u, v });
      }
    }
    const row = lonSteps + 1;
    for (let i = 0; i < latSteps; i++) {
      for (let j = 0; j < lonSteps; j++) {
        const a = i * row + j;
        const b = a + 1;
        const c = a + row;
        const d = c + 1;
        faces.push([a, b, d, c]);
      }
    }
    return { verts, faces };
  }

  private rotate(p: any, ax: number, ay: number, az: number) {
    let x = p.x, y = p.y, z = p.z;
    let c, s, y1, z1, x2, z2, x3, y3;

    c = Math.cos(ax); s = Math.sin(ax);
    y1 = y * c - z * s; z1 = y * s + z * c;
    y = y1; z = z1;

    c = Math.cos(ay); s = Math.sin(ay);
    x2 = x * c + z * s; z2 = -x * s + z * c;
    x = x2; z = z2;

    c = Math.cos(az); s = Math.sin(az);
    x3 = x * c - y * s; y3 = x * s + y * c;
    x = x3; y = y3;

    return { x, y, z, u: p.u, v: p.v };
  }

  private project(p: any, cx: number, cy: number) {
    const dist = 3.2;
    const z = p.z + dist;
    const f = 420 / z;
    return { x: cx + p.x * f, y: cy + p.y * f, z };
  }

  private lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
  private clamp(v: number, a: number, b: number) { return Math.max(a, Math.min(b, v)); }

  protected firstUpdated() {
    this.canvas = this.shadowRoot!.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.renderLoop(0);
  }

  private resize() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.clientWidth * dpr;
    this.canvas.height = this.clientHeight * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private renderLoop(t: number) {
    const w = this.clientWidth, h = this.clientHeight;
    const cx = w / 2, cy = h / 2;
    const time = t * 0.001;

    this.ctx.clearRect(0, 0, w, h);

    this.orbState.spin += 0.008 + this.amp * 0.03 + this.out * 0.02;
    const targetR = this.orbState.baseR * (1 + this.amp * 0.95 + this.out * 0.55);
    this.orbState.r = this.lerp(this.orbState.r, targetR, 0.24);

    // Glow
    const glowR = this.orbState.r * (2.1 + (this.amp + this.out) * 0.9);
    const glow = this.ctx.createRadialGradient(cx, cy, this.orbState.r * 0.2, cx, cy, glowR);
    glow.addColorStop(0, `rgba(255, 120, 0, ${0.18 + (this.amp + this.out) * 0.30})`);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    this.ctx.fillStyle = glow;
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
    this.ctx.fill();

    const ax = 0.55 + Math.sin(time * 0.7) * 0.12 + (this.amp + this.out) * 0.18;
    const ay = this.orbState.spin;
    const az = 0.25 + Math.cos(time * 0.6) * 0.10 + (this.amp + this.out) * 0.10;

    const tv = new Array(this.mesh.verts.length);
    for (let i = 0; i < this.mesh.verts.length; i++) {
      const p = this.mesh.verts[i];
      const wob = (Math.sin((p.u * 8 + time * 2.2) * Math.PI) + Math.sin((p.v * 10 - time * 1.7) * Math.PI)) * 0.06;
      const inflate = 1 + wob * (0.7 + (this.amp + this.out) * 2.3) + (this.amp + this.out) * 0.08;
      const rp = { x: p.x * inflate, y: p.y * inflate, z: p.z * inflate, u: p.u, v: p.v };
      const r = this.rotate(rp, ax, ay, az);
      const scaled = {
        x: (r.x * this.orbState.r) / this.orbState.baseR,
        y: (r.y * this.orbState.r) / this.orbState.baseR,
        z: (r.z * this.orbState.r) / this.orbState.baseR,
      };
      tv[i] = this.project(scaled, cx, cy);
    }

    const order = this.mesh.faces.map((f, idx) => {
      const z = (tv[f[0]].z + tv[f[1]].z + tv[f[2]].z + tv[f[3]].z) / 4;
      return { idx, z };
    }).sort((a, b) => b.z - a.z);

    this.ctx.lineWidth = 1.0 + (this.amp + this.out) * 2.2;
    for (const it of order) {
      const f = this.mesh.faces[it.idx];
      const a = tv[f[0]], b = tv[f[1]], c = tv[f[2]], d = tv[f[3]];
      const depth = this.clamp((it.z - 2.6) / 2.2, 0, 1);
      const alpha = 0.16 + (1 - depth) * 0.58 + (this.amp + this.out) * 0.22;

      this.ctx.strokeStyle = `rgba(255, 140, 30, ${alpha})`;
      this.ctx.beginPath();
      this.ctx.moveTo(a.x, a.y); this.ctx.lineTo(b.x, b.y);
      this.ctx.lineTo(d.x, d.y); this.ctx.lineTo(c.x, c.y);
      this.ctx.closePath();
      this.ctx.stroke();
    }

    requestAnimationFrame((t) => this.renderLoop(t));
  }

  protected render() { return html`<canvas></canvas>`; }
}
