/* room3d.js — Omkar Hub · a real 3D classroom.
 *
 * Builds an actual room in the same Three.js scene the teacher stands in, so that for the
 * first time the teacher and her surroundings share one perspective and one light rig.
 * The CSS classroom it replaces was flat layered divs: nothing could cast a shadow onto
 * anything else, which is what made it read as a poster with a person in front of it.
 *
 * ── The board hole ──
 * The lesson slides must stay CRISP HTML (they are rendered by app.js's slideHTML(), and a
 * bitmapped board is unreadable at small sizes). So the slides live in a CSS3D layer BEHIND
 * the transparent WebGL canvas, and the back wall is built as four quads around a
 * board-shaped OPENING. The WebGL canvas is transparent inside that opening, so the DOM
 * board shows through it — while anything in the room that is nearer the camera than the
 * wall, such as the teacher's outstretched arm, still draws over it correctly.
 * That gives real occlusion AND real text. Compositing the DOM board on top instead would
 * have hidden her hand every time she pointed at the board.
 *
 * Everything is in metres, y = 0 is the floor, and the camera looks toward -Z.
 */

/* ── room dimensions ── */
export const ROOM = {
  W: 9, H: 3.2, D: 6.6,          // width, height, depth
  backZ: -3.2,                   // the wall the board hangs on
  frontZ: 3.4,
  // the board-shaped opening in the back wall
  board: { x0: -2.7, x1: 0.9, y0: 0.9, y1: 2.9 },
  teacher: { x: 1.8, z: -2.35 }, // where she stands — her RIGHT arm then reaches the board
};

/* A procedural wood texture — no asset downloads, and far better than a flat colour.
   Flat untextured surfaces are the main reason simple 3D rooms look like cardboard. */
function woodTexture(THREE, light, dark, planks = 8) {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = light; g.fillRect(0, 0, 512, 512);
  const step = 512 / planks;
  for (let i = 0; i < planks; i++) {
    // alternate plank tone so the floor has visible boards
    g.fillStyle = i % 2 ? dark : light;
    g.fillRect(0, i * step, 512, step);
    // grain
    for (let k = 0; k < 26; k++) {
      g.strokeStyle = `rgba(0,0,0,${0.02 + Math.random() * 0.05})`;
      g.lineWidth = 0.5 + Math.random();
      g.beginPath();
      const y = i * step + Math.random() * step;
      g.moveTo(0, y);
      g.bezierCurveTo(170, y + (Math.random() - 0.5) * 6, 340, y + (Math.random() - 0.5) * 6, 512, y);
      g.stroke();
    }
    // seam between planks
    g.fillStyle = 'rgba(0,0,0,.22)';
    g.fillRect(0, i * step, 512, 1.5);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/* Faint mottling for painted plaster, so the walls aren't a dead flat fill. */
function plasterTexture(THREE, base) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  for (let k = 0; k < 2600; k++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.035})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/* Build the room into `scene`. Returns { dispose }. */
export function buildRoom(THREE, scene) {
  const junk = [];                       // everything to dispose of later
  const add = (m) => { scene.add(m); junk.push(m); return m; };

  const B = ROOM.board;
  const floorTex = woodTexture(THREE, '#b9905c', '#a67f4e', 9);
  floorTex.repeat.set(6, 5);
  const wallTex = plasterTexture(THREE, '#d8a184');
  wallTex.repeat.set(4, 2);

  const matFloor = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.72, metalness: 0 });
  const matWall = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.94, metalness: 0 });
  const matCeil = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.96 });
  const matWood = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.6 });
  const matWoodLight = new THREE.MeshStandardMaterial({ color: 0xb98a55, roughness: 0.62 });
  const matMetal = new THREE.MeshStandardMaterial({ color: 0x8b98b3, roughness: 0.42, metalness: 0.75 });

  /* ── floor & ceiling ── */
  const floor = add(new THREE.Mesh(new THREE.PlaneGeometry(ROOM.W, ROOM.D), matFloor));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, (ROOM.backZ + ROOM.frontZ) / 2);
  floor.receiveShadow = true;

  const ceil = add(new THREE.Mesh(new THREE.PlaneGeometry(ROOM.W, ROOM.D), matCeil));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, ROOM.H, (ROOM.backZ + ROOM.frontZ) / 2);

  /* ── the back wall, as four quads around the board opening ──
     This hole is what lets the crisp DOM board show through from behind. */
  const wallQuad = (w, h, x, y) => {
    const m = add(new THREE.Mesh(new THREE.PlaneGeometry(w, h), matWall));
    m.position.set(x, y, ROOM.backZ);
    m.receiveShadow = true;
    return m;
  };
  const halfW = ROOM.W / 2;
  wallQuad(B.x0 + halfW, ROOM.H, (-halfW + B.x0) / 2, ROOM.H / 2);            // left of board
  wallQuad(halfW - B.x1, ROOM.H, (B.x1 + halfW) / 2, ROOM.H / 2);             // right of board
  wallQuad(B.x1 - B.x0, B.y0, (B.x0 + B.x1) / 2, B.y0 / 2);                   // under board
  wallQuad(B.x1 - B.x0, ROOM.H - B.y1, (B.x0 + B.x1) / 2, (B.y1 + ROOM.H) / 2); // over board

  /* ── side walls ── */
  const sideGeo = new THREE.PlaneGeometry(ROOM.D, ROOM.H);
  const wallL = add(new THREE.Mesh(sideGeo, matWall));
  wallL.rotation.y = Math.PI / 2;
  wallL.position.set(-halfW, ROOM.H / 2, (ROOM.backZ + ROOM.frontZ) / 2);
  wallL.receiveShadow = true;

  const wallR = add(new THREE.Mesh(sideGeo, matWall));
  wallR.rotation.y = -Math.PI / 2;
  wallR.position.set(halfW, ROOM.H / 2, (ROOM.backZ + ROOM.frontZ) / 2);
  wallR.receiveShadow = true;

  /* ── windows on the right wall ── bright panes, and the light source that matches them.
     Side daylight is the single most classroom-looking light there is. */
  const paneMat = new THREE.MeshStandardMaterial({
    color: 0xdff0ff, emissive: 0xcfe6ff, emissiveIntensity: 1.5, roughness: 0.1,
  });
  for (let i = 0; i < 2; i++) {
    const z = -1.5 + i * 2.3;
    const pane = add(new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.35), paneMat));
    pane.rotation.y = -Math.PI / 2;
    pane.position.set(halfW - 0.02, 1.75, z);
    // frame
    const fr = add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.5, 1.85), matWoodLight));
    fr.position.set(halfW - 0.05, 1.75, z);
    const mullion = add(new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.4, 0.06), matWoodLight));
    mullion.position.set(halfW - 0.08, 1.75, z);
  }

  /* ── the board's wooden frame + chalk tray, around the opening ── */
  const fw = 0.12;                                        // frame thickness
  const frameBox = (w, h, x, y) => {
    const m = add(new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.10), matWood));
    m.position.set(x, y, ROOM.backZ + 0.05);
    m.castShadow = true;
    return m;
  };
  frameBox(B.x1 - B.x0 + fw * 2, fw, (B.x0 + B.x1) / 2, B.y1 + fw / 2);   // top rail
  frameBox(B.x1 - B.x0 + fw * 2, fw, (B.x0 + B.x1) / 2, B.y0 - fw / 2);   // bottom rail
  frameBox(fw, B.y1 - B.y0 + fw * 2, B.x0 - fw / 2, (B.y0 + B.y1) / 2);   // left stile
  frameBox(fw, B.y1 - B.y0 + fw * 2, B.x1 + fw / 2, (B.y0 + B.y1) / 2);   // right stile

  const tray = add(new THREE.Mesh(new THREE.BoxGeometry(B.x1 - B.x0, 0.05, 0.16), matWood));
  tray.position.set((B.x0 + B.x1) / 2, B.y0 - 0.18, ROOM.backZ + 0.11);
  tray.castShadow = true;
  // sticks of chalk on the tray
  const chalkCols = [0xfdfdf6, 0xffe9a8, 0xbfe8ff];
  chalkCols.forEach((col, i) => {
    const ch = add(new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.014, 0.1, 8),
      new THREE.MeshStandardMaterial({ color: col, roughness: 0.9 })));
    ch.rotation.z = Math.PI / 2;
    ch.position.set(B.x0 + 0.5 + i * 0.28, B.y0 - 0.13, ROOM.backZ + 0.15);
  });

  /* ── cabinets under the board ── */
  const cab = add(new THREE.Mesh(new THREE.BoxGeometry(B.x1 - B.x0, 0.8, 0.5), matWoodLight));
  cab.position.set((B.x0 + B.x1) / 2, 0.4, ROOM.backZ + 0.3);
  cab.castShadow = true; cab.receiveShadow = true;
  const cabTop = add(new THREE.Mesh(new THREE.BoxGeometry(B.x1 - B.x0 + 0.06, 0.05, 0.56), matWood));
  cabTop.position.set((B.x0 + B.x1) / 2, 0.82, ROOM.backZ + 0.3);
  cabTop.castShadow = true;
  // door handles
  for (let i = 0; i < 4; i++) {
    const h = add(new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.03, 0.03), matMetal));
    h.position.set(B.x0 + 0.45 + i * 0.9, 0.55, ROOM.backZ + 0.56);
  }

  /* ── lockers against the left wall ── */
  for (let i = 0; i < 3; i++) {
    const lk = add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.9, 0.45), matMetal));
    lk.position.set(-halfW + 0.28, 0.95, ROOM.backZ + 0.7 + i * 0.5);
    lk.castShadow = true; lk.receiveShadow = true;
  }

  /* ── corkboard on the back wall, right of the board ── */
  const cork = add(new THREE.Mesh(
    new THREE.PlaneGeometry(1.0, 0.7),
    new THREE.MeshStandardMaterial({ color: 0xc19a5b, roughness: 0.95 })));
  cork.position.set(2.5, 2.1, ROOM.backZ + 0.02);
  const corkFrame = add(new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.8, 0.05), matWood));
  corkFrame.position.set(2.5, 2.1, ROOM.backZ + 0.005);
  // sticky notes
  [{ c: 0xf6d365, x: -0.28, y: 0.14 }, { c: 0xf2879e, x: 0.10, y: 0.06 }, { c: 0x8fd3c9, x: 0.30, y: -0.16 }]
    .forEach((n) => {
      const s = add(new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2),
        new THREE.MeshStandardMaterial({ color: n.c, roughness: 0.9 })));
      s.position.set(2.5 + n.x, 2.1 + n.y, ROOM.backZ + 0.04);
      s.rotation.z = (Math.random() - 0.5) * 0.16;
    });

  /* ── skirting board where the walls meet the floor ──
     Real rooms never have a wall meeting a floor at a bare seam; that hard join is one of
     the strongest tells that a 3D room was thrown together. */
  const skirt = new THREE.MeshStandardMaterial({ color: 0xf0e7d8, roughness: 0.75 });
  const skBack = add(new THREE.Mesh(new THREE.BoxGeometry(ROOM.W, 0.12, 0.03), skirt));
  skBack.position.set(0, 0.06, ROOM.backZ + 0.02);
  [-1, 1].forEach((s) => {
    const sk = add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, ROOM.D), skirt));
    sk.position.set(s * (halfW - 0.02), 0.06, (ROOM.backZ + ROOM.frontZ) / 2);
  });

  /* ── a couple of wall charts, to break up the bare plaster ── */
  const chartMat = (a, b) => {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 340;
    const g2 = cv.getContext('2d');
    g2.fillStyle = '#f7f3e8'; g2.fillRect(0, 0, 256, 340);
    g2.fillStyle = a; g2.fillRect(0, 0, 256, 54);
    // fake headings and rows, readable as "a chart" from across the room
    for (let r = 0; r < 8; r++) {
      g2.fillStyle = r % 2 ? b : '#cfc7b4';
      g2.fillRect(20, 78 + r * 30, 100 + Math.random() * 110, 12);
    }
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.92 });
  };
  const chartA = add(new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.82), chartMat('#4a6fb5', '#8fa8d8')));
  chartA.position.set(-3.55, 1.85, ROOM.backZ + 0.02);
  const chartB = add(new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.82), chartMat('#b5644a', '#d8a08f')));
  chartB.position.set(-3.55, 0.92, ROOM.backZ + 0.02);

  /* ── student desks in the foreground, for depth ──
     Kept low and to the sides so they frame the shot without hiding the teacher. */
  const deskTopMat = matWoodLight, legMat = matMetal;
  for (let row = 0; row < 2; row++) {
    for (let col = -1; col <= 1; col++) {
      if (row === 0 && col === 0) continue;         // keep the centre sight-line clear
      const x = col * 2.5, z = 0.6 + row * 1.5;
      const top = add(new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.05, 0.55), deskTopMat));
      top.position.set(x, 0.72, z);
      top.castShadow = true; top.receiveShadow = true;
      [[-0.5, -0.22], [0.5, -0.22], [-0.5, 0.22], [0.5, 0.22]].forEach(([dx, dz]) => {
        const leg = add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.7, 0.05), legMat));
        leg.position.set(x + dx, 0.35, z + dz);
      });
    }
  }

  /* ── ceiling light panels (emissive — they read as lit without costing a light each) ── */
  for (let i = 0; i < 2; i++) {
    const p = add(new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 0.5),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e2, emissiveIntensity: 2.2 })));
    p.rotation.x = Math.PI / 2;
    p.position.set(-1.2 + i * 2.6, ROOM.H - 0.02, -0.9 + i * 1.4);
  }

  return {
    dispose() {
      junk.forEach((m) => {
        scene.remove(m);
        if (m.geometry) m.geometry.dispose();
        [].concat(m.material || []).forEach((mm) => {
          if (!mm) return;
          for (const k in mm) { const v = mm[k]; if (v && v.isTexture && v.dispose) v.dispose(); }
          mm.dispose && mm.dispose();
        });
      });
      junk.length = 0;
    },
  };
}

/* ── the light rig ──
 * Three.js r155+ uses physically-based light units, so these values are deliberately
 * modest; the environment map does most of the soft filling.
 */
export function buildLights(THREE, scene) {
  const junk = [];
  const add = (l) => { scene.add(l); junk.push(l); return l; };

  add(new THREE.HemisphereLight(0xf3f6ff, 0x6b4a33, 0.85));

  // the "sun" through the right-hand windows — the only shadow caster, which keeps the
  // shadows readable and the cost down
  const sun = add(new THREE.DirectionalLight(0xfff2dc, 2.8));
  sun.position.set(5.5, 3.4, 1.2);
  sun.target.position.set(-0.6, 1.2, ROOM.backZ);
  scene.add(sun.target); junk.push(sun.target);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  // Tight shadow-camera bounds are what make a shadow map crisp instead of blocky.
  const s = 6.5;
  sun.shadow.camera.left = -s; sun.shadow.camera.right = s;
  sun.shadow.camera.top = s; sun.shadow.camera.bottom = -s;
  sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 18;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;

  // cool bounce from the left so the shadow side isn't dead black
  const fill = add(new THREE.DirectionalLight(0xbfd0ff, 0.7));
  fill.position.set(-4.5, 2.6, 2.0);

  // a warm kicker on the teacher so she separates from the wall behind her
  const kick = add(new THREE.SpotLight(0xffe6c4, 18, 8, Math.PI / 7, 0.6, 2));
  kick.position.set(ROOM.teacher.x + 1.2, 3.0, ROOM.teacher.z + 2.2);
  kick.target.position.set(ROOM.teacher.x, 1.4, ROOM.teacher.z);
  scene.add(kick.target); junk.push(kick.target);

  return {
    dispose() { junk.forEach((l) => { scene.remove(l); l.dispose && l.dispose(); }); junk.length = 0; },
  };
}
