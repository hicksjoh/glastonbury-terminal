/**
 * The armillary: a Blender-made instrument (rings, polar axis, glowing core)
 * with orbs on tilted orbits around it. Ported from the Telos page.
 *
 * Framework-free on purpose: the React wrapper (components/armillary/Armillary)
 * imports this module dynamically, so three.js only loads on pages that show it.
 *
 * Each orb is an ArmillaryBody. `weight` (0..1) sets its size and glow; on the
 * dashboard it is that piece's share of net worth. Bodies are laid out on
 * orbits in the order given, innermost first.
 */
import type * as T from 'three';

export interface ArmillaryBody {
  id: string;
  /** Shown next to the orb when labels are on; omit for plain orbs. */
  label?: string;
  /** Any CSS hex color. */
  color: string;
  /** 0..1: size and glow. */
  weight: number;
}

export interface ArmillaryOptions {
  host: HTMLElement;
  canvas: HTMLCanvasElement;
  /** Absolutely positioned layer for orb labels; omit to draw no labels. */
  labels?: HTMLElement | null;
  modelUrl: string;
  bodies: ArmillaryBody[];
  /** Polar-axis latitude in degrees (Telos uses the city you're in). */
  latitude?: number;
  /** Drag to turn, tap an orb to select it. */
  interactive?: boolean;
  /** Multiplies the camera distance: above 1 pulls back. */
  zoom?: number;
  /** Moves the instrument sideways, as a fraction of the canvas width, at or above minWidth px. */
  shift?: { minWidth: number; value: number };
  /** Raises the instrument, as a fraction of the canvas height, below maxWidth px. */
  lift?: { maxWidth: number; value: number };
  reducedMotion?: boolean;
  onSelect?: (id: string | null) => void;
}

export interface ArmillaryHandle {
  setBodies(bodies: ArmillaryBody[]): void;
  select(id: string | null): void;
  dispose(): void;
}

const INCLINATIONS = [6, -9, 13, -4, 9, -12, 3, -7];

let modelPromise: Promise<ArrayBuffer> | null = null;
function loadModel(url: string): Promise<ArrayBuffer> {
  if (!modelPromise) {
    modelPromise = fetch(url)
      .then(r => { if (!r.ok) throw new Error(`model ${r.status}`); return r.json(); })
      .then((j: { glb?: string }) => {
        const bin = atob(String(j.glb || ''));
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        return u8.buffer;
      });
    modelPromise.catch(() => { modelPromise = null; }); // let a later mount retry
  }
  return modelPromise;
}

/** True when this browser can make a WebGL context. Checked first so three.js never logs a failure. */
export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

/**
 * Builds the scene. Resolves null when WebGL is unavailable (the caller keeps
 * its poster image up). Rejects only if the model can't be loaded.
 */
export async function createArmillary(opts: ArmillaryOptions): Promise<ArmillaryHandle | null> {
  if (!webglAvailable()) return null;
  const [THREE, { GLTFLoader }, { RoomEnvironment }, { EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
    import('three'),
    import('three/examples/jsm/loaders/GLTFLoader.js'),
    import('three/examples/jsm/environments/RoomEnvironment.js'),
    import('three/examples/jsm/postprocessing/EffectComposer.js'),
    import('three/examples/jsm/postprocessing/RenderPass.js'),
    import('three/examples/jsm/postprocessing/UnrealBloomPass.js'),
    import('three/examples/jsm/postprocessing/OutputPass.js'),
  ]);
  const glb = await loadModel(opts.modelUrl);

  const { host, canvas } = opts;
  const reduce = !!opts.reducedMotion;
  const interactive = opts.interactive !== false;
  let disposed = false;

  let renderer: T.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
  } catch {
    return null;
  }
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.setClearColor(0x06070d, 1);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x06070d, 0.028);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envTarget.texture;

  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200);
  const camDir = new THREE.Vector3(4.4, 2.1, 6.6).normalize();

  scene.add(new THREE.AmbientLight(0x8890c0, 0.25));
  const key = new THREE.DirectionalLight(0xdfe6ff, 1.6);
  key.position.set(4, 5, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9c8cff, 0.8);
  rim.position.set(-5, 2, -4);
  scene.add(rim);
  const sun = new THREE.PointLight(0xff8a45, 6, 6, 1.6);
  scene.add(sun);

  // stars
  const pts: number[] = [];
  for (let i = 0; i < 900; i++) {
    const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, rr = 26 + Math.random() * 30;
    const s = Math.sqrt(1 - u * u);
    pts.push(rr * s * Math.cos(t), rr * u, rr * s * Math.sin(t));
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xc9d2ff, size: 0.09, transparent: true, opacity: 0.7, fog: false });
  scene.add(new THREE.Points(starGeo, starMat));

  const world = new THREE.Group();
  scene.add(world);

  // the instrument
  const gltf = await new Promise<{ scene: T.Group }>((res, rej) => new GLTFLoader().parse(glb.slice(0), '', res as never, rej));
  const armillary = gltf.scene;
  armillary.scale.setScalar(0.92);
  world.add(armillary);
  const mount = armillary.getObjectByName('PolarMount') || null;
  const celestial = armillary.getObjectByName('Celestial') || null;
  let coreMat: T.MeshStandardMaterial | null = null;
  armillary.traverse(n => {
    const m = (n as T.Mesh).material as T.MeshStandardMaterial | undefined;
    if (!(n as T.Mesh).isMesh || !m) return;
    if (m.metalness > 0.5) m.envMapIntensity = 0.55;
    if (m.name === 'MAT_SunriseCore') { coreMat = m; m.emissive = new THREE.Color(0xff6a2a); }
  });
  const tilt = THREE.MathUtils.degToRad(90 - (opts.latitude ?? 37.8));
  if (mount) mount.rotation.x = tilt;

  // orbs
  type Orb = {
    id: string; plane: T.Group; mesh: T.Mesh; mat: T.MeshStandardMaterial; line: T.LineLoop; hit: T.Mesh;
    label: HTMLDivElement | null; labelW: number; r: number; size: number; speed: number; angle: number; weight: number; shown: number;
  };
  let orbs: Orb[] = [];
  let selected: string | null = null;
  const hitTargets: T.Object3D[] = [];
  const sphereGeo = new THREE.SphereGeometry(1, 32, 16);
  const hitGeo = new THREE.SphereGeometry(1, 8, 6);
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });

  function clearOrbs() {
    for (const o of orbs) {
      world.remove(o.plane);
      o.mat.dispose();
      o.line.geometry.dispose();
      (o.line.material as T.Material).dispose();
      o.label?.remove();
    }
    orbs = [];
    hitTargets.length = 0;
  }
  function buildOrbs(bodies: ArmillaryBody[]) {
    clearOrbs();
    const n = bodies.length;
    bodies.forEach((b, i) => {
      const r = n <= 1 ? 2.3 : 1.95 + (i * (3.3 - 1.95)) / (n - 1);
      const inc = INCLINATIONS[i % INCLINATIONS.length];
      const plane = new THREE.Group();
      plane.rotation.x = THREE.MathUtils.degToRad(inc);
      plane.rotation.z = THREE.MathUtils.degToRad(inc * 0.4);
      world.add(plane);
      const col = new THREE.Color(b.color);
      const ring = new THREE.EllipseCurve(0, 0, r, r).getPoints(160).map(p => new THREE.Vector3(p.x, 0, p.y));
      const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ring),
        new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.1 }));
      plane.add(line);
      const mat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.6, roughness: 0.35, metalness: 0.1 });
      const mesh = new THREE.Mesh(sphereGeo, mat);
      plane.add(mesh);
      const w = Math.max(0, Math.min(1, b.weight));
      const size = 0.07 + 0.16 * Math.sqrt(w);
      const hit = new THREE.Mesh(hitGeo, hitMat);
      hit.scale.setScalar(Math.max(0.3, size * 2.4) / size); // child of the mesh, so undo its scale
      hit.userData.id = b.id;
      mesh.add(hit);
      hitTargets.push(hit);
      let label: HTMLDivElement | null = null;
      if (opts.labels && b.label) {
        label = document.createElement('div');
        label.className = 'armillary-label';
        label.textContent = b.label;
        opts.labels.append(label);
      }
      orbs.push({ id: b.id, plane, mesh, mat, line, hit, label, labelW: label ? label.offsetWidth : 0, r, size, speed: 0.16 * Math.pow(1.95 / r, 1.5),
        angle: i * 2.39 + 0.3, weight: w, shown: 0 });
    });
    applySelection();
  }
  function applySelection() {
    for (const o of orbs) {
      const on = o.id === selected;
      (o.line.material as T.LineBasicMaterial).opacity = on ? 0.42 : 0.1;
      o.label?.classList.toggle('sel', on);
    }
  }

  // post: soft bloom so the orbs glow
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(512, 512), 0.5, 0.32, 0.86));
  composer.addPass(new OutputPass());

  let width = 0, height = 0;
  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    width = w; height = h;
    // big canvases (a full-screen login backdrop) render at a lower ratio to stay smooth
    const dpr = Math.min(window.devicePixelRatio || 1, w * h > 900_000 ? 1.5 : 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(dpr);
    composer.setSize(w, h);
    camera.aspect = w / h;
    const dist = (w < 520 ? 9.4 : 8.1) * (opts.zoom ?? 1);
    camera.position.copy(camDir).multiplyScalar(dist);
    camera.lookAt(0, -0.05, 0);
    const sh = opts.shift && w >= opts.shift.minWidth ? opts.shift.value : 0;
    const lf = opts.lift && w < opts.lift.maxWidth ? opts.lift.value : 0;
    if (sh || lf) camera.setViewOffset(w, h, -sh * w, lf * h, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    if (reduce || !running) renderOnce();
  }

  // input
  let dragging = false, lastX = 0, vel = 0, downX = 0, downY = 0, yaw = -0.35;
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const onDown = (e: PointerEvent) => {
    dragging = true; lastX = downX = e.clientX; downY = e.clientY;
    canvas.setPointerCapture?.(e.pointerId);
    canvas.style.cursor = 'grabbing';
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    const dx = e.clientX - lastX; lastX = e.clientX;
    yaw += dx * 0.006; vel = dx * 0.006;
    if (reduce) renderOnce();
  };
  const onUp = (e: PointerEvent) => {
    dragging = false; canvas.style.cursor = 'grab';
    if (Math.hypot(e.clientX - downX, e.clientY - downY) < 6 && opts.onSelect) {
      const rect = canvas.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(hitTargets, false)[0];
      const id = hit ? String(hit.object.userData.id) : null;
      opts.onSelect(id && id === selected ? null : id);
    }
  };
  const onCancel = () => { dragging = false; };
  if (interactive) {
    canvas.style.cursor = 'grab';
    canvas.style.touchAction = 'pan-y';
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onCancel);
  }

  // frame
  const v = new THREE.Vector3();
  let t0 = performance.now(), visible = true, running = false, raf = 0;
  function step(dt: number, t: number) {
    if (!dragging) { yaw += vel; vel *= 0.94; if (!reduce) yaw += dt * 0.035; }
    world.rotation.y = yaw;
    if (celestial && !reduce) celestial.rotation.y += dt * 0.09;
    if (coreMat) (coreMat as T.MeshStandardMaterial).emissiveIntensity = 1.5 + 0.25 * Math.sin(t * 0.9);
    for (const o of orbs) {
      if (!reduce) o.angle += dt * o.speed;
      o.mesh.position.set(Math.cos(o.angle) * o.r, 0, Math.sin(o.angle) * o.r);
      o.shown += (o.weight - o.shown) * (reduce ? 1 : Math.min(1, dt * 1.5));
      const sel = o.id === selected ? 0.5 : 0;
      o.mat.emissiveIntensity = 0.35 + o.shown * 1.4 + sel;
      o.mesh.scale.setScalar(o.size * (0.7 + 0.3 * Math.min(1, o.shown / Math.max(o.weight, 0.001))));
      if (o.label) {
        o.mesh.getWorldPosition(v);
        v.y += o.size * 1.9 + 0.08;
        v.project(camera);
        // keep the whole label inside the frame
        const half = o.labelW / 2 + 4;
        const lx = Math.min(Math.max((v.x * 0.5 + 0.5) * width, half), Math.max(half, width - half));
        o.label.style.transform = `translate(${lx.toFixed(1)}px, ${((-v.y * 0.5 + 0.5) * height).toFixed(1)}px) translate(-50%, -100%)`;
        o.label.style.visibility = v.z < 1 ? 'visible' : 'hidden';
      }
    }
  }
  function renderOnce() { if (disposed) return; step(0, performance.now() / 1000); composer.render(); }
  function loop(now: number) {
    if (disposed || !visible || document.hidden) { running = false; return; }
    const dt = Math.min(0.05, (now - t0) / 1000);
    t0 = now;
    step(dt, now / 1000);
    composer.render();
    raf = requestAnimationFrame(loop);
  }
  function kick() {
    if (!disposed && !running && visible && !document.hidden && !reduce) {
      running = true; t0 = performance.now(); raf = requestAnimationFrame(loop);
    }
  }
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  const io = new IntersectionObserver(es => { visible = es[0]?.isIntersecting ?? true; kick(); });
  io.observe(host);
  document.addEventListener('visibilitychange', kick);

  buildOrbs(opts.bodies);
  resize();
  if (reduce) renderOnce(); else kick();

  return {
    setBodies(bodies) {
      if (disposed) return;
      const same = bodies.length === orbs.length && bodies.every((b, i) => b.id === orbs[i].id && b.label === (orbs[i].label?.textContent ?? undefined));
      if (same) {
        bodies.forEach((b, i) => { orbs[i].weight = Math.max(0, Math.min(1, b.weight)); orbs[i].size = 0.07 + 0.16 * Math.sqrt(orbs[i].weight); orbs[i].mat.color.set(b.color); orbs[i].mat.emissive.set(b.color); });
      } else {
        buildOrbs(bodies);
      }
      if (reduce || !running) renderOnce();
    },
    select(id) {
      selected = id;
      applySelection();
      if (reduce || !running) renderOnce();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', kick);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      clearOrbs();
      sphereGeo.dispose(); hitGeo.dispose(); hitMat.dispose();
      starGeo.dispose(); starMat.dispose();
      armillary.traverse(n => {
        const m = n as T.Mesh;
        if (!m.isMesh) return;
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        mats.forEach(x => x?.dispose());
      });
      envTarget.dispose();
      pmrem.dispose();
      composer.dispose();
      renderer.dispose();
    },
  };
}
