/* teacher3d.js — Omkar Hub · the 3D AI Teacher.
 *
 * Drives the project's own avatar (avatar/model.fbx — a Ready Player Me export) as a live
 * teacher: audio-driven lip-sync, ARKit facial expressions, blinking/breathing, head turns,
 * and anatomically correct hand gestures.
 *
 * ── Why this file aims bones instead of setting Euler angles ──
 * The model has NO animation clips and rests in a T-pose, so every motion is procedural.
 * Setting bone.rotation.z/x/y directly requires knowing each bone's local axis convention —
 * guess wrong and arms fold across the chest and fingers splay instead of curling.
 * So instead we:
 *   1. DETECT which way the avatar faces and which world axis is its right (from bind pose),
 *   2. AIM each limb with quaternions at a target direction expressed in the avatar's own
 *      frame [outward, up, forward] — rig-agnostic and anatomically correct,
 *   3. DETECT the finger curl axis from the palm's own geometry, and CALIBRATE its sign
 *      at load by test-rotating a fingertip and checking which way it actually moved.
 * Result: poses are described in human terms ("arm out and slightly up") and always look right.
 *
 * classroom.js interface:
 *   setMouth(0..1)  setSpeaking(bool)  lookAt('board'|'student'|'front')
 *   setExpression(mood)  gesture(name|'auto')  resize()  dispose()
 */

const THREE_URL = 'https://esm.sh/three@0.161.0';
const FBX_URL = 'https://esm.sh/three@0.161.0/examples/jsm/loaders/FBXLoader.js';
const AVATAR_URL = (typeof window !== 'undefined' && window.OMKAR_AVATAR_URL) || '/avatar/model.fbx';

/* ─────────── Gesture library ───────────
 * Limb directions are [outward, up, forward] in the AVATAR'S OWN frame:
 *   outward = away from the body on that arm's side (so the right arm's +out points
 *             to the viewer's LEFT — which is exactly where the green board is)
 *   up      = toward the ceiling
 *   forward = out of the screen, toward the student
 * Vectors are normalised for you. Tweak these numbers to re-choreograph a gesture.
 *
 * fingers : curl preset per hand      osc: live wobble while held      hold: ms
 */
/* Resting posture. The camera frames stomach-upward, so the hands must sit at stomach/chest
   height — arms hanging at the sides would put them out of shot entirely. */
const REST = { upper: [0.30, -0.86, 0.28], fore: [0.34, -0.16, 0.90] };

const POSES = {
  idle: { fingers: { left: 'relaxed', right: 'relaxed' } },

  // default talking posture — forearms up and forward, hands alive near the chest
  explain: {
    right: { upper: [0.34, -0.82, 0.22], fore: [0.40, -0.10, 0.88] },
    left: { upper: [0.34, -0.82, 0.22], fore: [0.40, -0.10, 0.88] },
    fingers: { left: 'relaxed', right: 'relaxed' },
  },

  /* ── directing attention at the board ── */
  point: {   // full arm extended at the board, index out
    right: { upper: [0.88, 0.16, 0.24], fore: [0.94, 0.10, 0.20] },
    fingers: { left: 'relaxed', right: 'point' }, hold: 2600,
  },
  point_up: {  // "this is the important bit!"
    right: { upper: [0.30, 0.52, 0.22], fore: [0.10, 0.96, 0.14] },
    fingers: { left: 'relaxed', right: 'point' }, hold: 2000,
  },
  present_board: {  // open palm gesturing at the board
    right: { upper: [0.78, -0.12, 0.32], fore: [0.86, 0.06, 0.44] },
    fingers: { left: 'relaxed', right: 'open' }, hold: 2400,
  },
  both_forward: {  // "look, it's simple" — both palms to the student
    right: { upper: [0.30, -0.72, 0.32], fore: [0.24, 0.06, 0.94] },
    left: { upper: [0.30, -0.72, 0.32], fore: [0.24, 0.06, 0.94] },
    fingers: { left: 'open', right: 'open' }, hold: 2200,
  },

  /* ── counting ── */
  count_one: {
    right: { upper: [0.34, -0.48, 0.30], fore: [0.18, 0.60, 0.72] },
    fingers: { left: 'relaxed', right: 'point' }, hold: 1900,
  },
  count_two: {
    right: { upper: [0.34, -0.48, 0.30], fore: [0.18, 0.60, 0.72] },
    fingers: { left: 'relaxed', right: 'two' }, hold: 1900,
  },
  count_three: {
    right: { upper: [0.34, -0.48, 0.30], fore: [0.18, 0.60, 0.72] },
    fingers: { left: 'relaxed', right: 'three' }, hold: 1900,
  },

  /* ── size & emphasis ── */
  big_spread: {   // "itna bada" — arms thrown wide
    right: { upper: [0.86, -0.22, 0.26], fore: [0.92, -0.04, 0.34] },
    left: { upper: [0.86, -0.22, 0.26], fore: [0.92, -0.04, 0.34] },
    fingers: { left: 'open', right: 'open' }, hold: 2000,
  },
  small_pinch: {  // "bas thoda sa"
    right: { upper: [0.28, -0.62, 0.36], fore: [0.20, 0.34, 0.90] },
    fingers: { left: 'relaxed', right: 'pinch' }, hold: 1900,
  },
  chop: {         // hand chopping down on a key word
    right: { upper: [0.38, -0.52, 0.34], fore: [0.32, -0.08, 0.92] },
    fingers: { left: 'relaxed', right: 'open' },
    osc: { arm: 'right', part: 'fore', axis: 'up', amp: 0.30, freq: 5.0 }, hold: 1700,
  },

  /* ── friendly & comedic ── */
  welcome: {
    right: { upper: [0.50, -0.52, 0.40], fore: [0.44, 0.18, 0.84] },
    left: { upper: [0.50, -0.52, 0.40], fore: [0.44, 0.18, 0.84] },
    fingers: { left: 'open', right: 'open' }, hold: 2400,
  },
  wave: {
    right: { upper: [0.52, 0.36, 0.26], fore: [0.30, 0.88, 0.28] },
    fingers: { left: 'relaxed', right: 'open' },
    osc: { arm: 'right', part: 'fore', axis: 'out', amp: 0.34, freq: 6.2 }, hold: 2200,
  },
  thumbs_up: {
    right: { upper: [0.34, -0.56, 0.36], fore: [0.18, 0.52, 0.80] },
    fingers: { left: 'relaxed', right: 'thumbsUp' }, hold: 2000,
  },
  wag_finger: {   // naughty "nuh-uh, boss"
    right: { upper: [0.38, 0.18, 0.30], fore: [0.14, 0.92, 0.32] },
    fingers: { left: 'relaxed', right: 'point' },
    osc: { arm: 'right', part: 'fore', axis: 'out', amp: 0.30, freq: 7.2 }, hold: 2100,
  },
  shrug: {        // "ab main kya karun"
    right: { upper: [0.62, -0.56, 0.24], fore: [0.74, 0.10, 0.62] },
    left: { upper: [0.62, -0.56, 0.24], fore: [0.74, 0.10, 0.62] },
    fingers: { left: 'open', right: 'open' }, hold: 2000,
  },
  think_chin: {   // hand drifts up to the chin
    right: { upper: [0.30, -0.64, 0.30], fore: [0.10, 0.78, 0.60] },
    fingers: { left: 'relaxed', right: 'claw' }, hold: 2400,
  },
  tap_head: {     // "dimaag lagao, boss"
    right: { upper: [0.36, -0.10, 0.22], fore: [0.12, 0.92, 0.30] },
    fingers: { left: 'relaxed', right: 'point' },
    osc: { arm: 'right', part: 'fore', axis: 'fwd', amp: 0.18, freq: 6.0 }, hold: 2100,
  },
  facepalm: {
    right: { upper: [0.32, -0.24, 0.30], fore: [0.08, 0.86, 0.48] },
    fingers: { left: 'relaxed', right: 'open' }, hold: 2200,
  },
  clap: {
    right: { upper: [0.34, -0.60, 0.36], fore: [0.22, 0.10, 0.95] },
    left: { upper: [0.34, -0.60, 0.36], fore: [0.22, 0.10, 0.95] },
    fingers: { left: 'open', right: 'open' },
    osc: { arm: 'right', part: 'fore', axis: 'out', amp: 0.22, freq: 8.0 }, hold: 2000,
  },
  namaste: {
    right: { upper: [0.26, -0.68, 0.32], fore: [0.12, 0.38, 0.92] },
    left: { upper: [0.26, -0.68, 0.32], fore: [0.12, 0.38, 0.92] },
    fingers: { left: 'open', right: 'open' }, hold: 2400,
  },

  /* ── extra teaching gestures (richer hand control) ── */
  weigh: {        // "on one hand… on the other" — palms up like scales
    right: { upper: [0.46, -0.60, 0.36], fore: [0.42, 0.02, 0.90] },
    left: { upper: [0.46, -0.44, 0.36], fore: [0.42, 0.26, 0.86] },
    fingers: { left: 'open', right: 'open' },
    osc: { arm: 'right', part: 'fore', axis: 'up', amp: 0.16, freq: 2.4 }, hold: 2300,
  },
  circle: {       // tracing a cycle / loop in the air
    right: { upper: [0.44, -0.34, 0.42], fore: [0.30, 0.44, 0.84] },
    fingers: { left: 'relaxed', right: 'point' },
    osc: { arm: 'right', part: 'fore', axis: 'out', amp: 0.26, freq: 3.2 }, hold: 2400,
  },
  step_up: {      // "and then it rises" — hand climbing
    right: { upper: [0.40, -0.20, 0.38], fore: [0.24, 0.66, 0.70] },
    fingers: { left: 'relaxed', right: 'open' },
    osc: { arm: 'right', part: 'fore', axis: 'up', amp: 0.22, freq: 2.0 }, hold: 2200,
  },
  push_away: {    // "forget that, it's wrong"
    right: { upper: [0.42, -0.48, 0.44], fore: [0.34, 0.04, 0.94] },
    left: { upper: [0.42, -0.48, 0.44], fore: [0.34, 0.04, 0.94] },
    fingers: { left: 'open', right: 'open' },
    osc: { arm: 'right', part: 'fore', axis: 'fwd', amp: 0.20, freq: 4.2 }, hold: 1800,
  },
  come_closer: {  // "now listen carefully"
    right: { upper: [0.34, -0.52, 0.34], fore: [0.22, 0.40, 0.86] },
    fingers: { left: 'relaxed', right: 'claw' },
    osc: { arm: 'right', part: 'fore', axis: 'fwd', amp: 0.22, freq: 3.6 }, hold: 2000,
  },
  one_hand_explain: {   // asymmetric talking pose — reads far more natural than mirrored hands
    right: { upper: [0.36, -0.74, 0.30], fore: [0.30, 0.22, 0.90] },
    left: { upper: [0.26, -0.88, 0.22], fore: [0.24, -0.06, 0.90] },
    fingers: { left: 'relaxed', right: 'open' },
  },

  /* ─────────── LEFT-handed beats ───────────
   * Everything above gestures with the right arm, which is why the teacher used to look
   * like she was permanently holding one hand up. These mirror the common beats onto the
   * left arm so the load alternates and neither hand parks in one place. */
  left_explain: {
    left: { upper: [0.36, -0.74, 0.30], fore: [0.30, 0.20, 0.90] },
    right: { upper: [0.26, -0.88, 0.22], fore: [0.26, -0.14, 0.88] },
    fingers: { left: 'open', right: 'relaxed' },
  },
  left_offer: {      // open palm offered out to the side
    left: { upper: [0.66, -0.42, 0.36], fore: [0.72, -0.06, 0.62] },
    right: { upper: [0.28, -0.88, 0.24], fore: [0.28, -0.20, 0.88] },
    fingers: { left: 'open', right: 'relaxed' }, hold: 2100,
  },
  left_pinch: {      // "just this much", left hand
    left: { upper: [0.30, -0.66, 0.36], fore: [0.22, 0.16, 0.92] },
    fingers: { left: 'pinch', right: 'relaxed' }, hold: 1900,
  },
  left_chop: {
    left: { upper: [0.38, -0.54, 0.34], fore: [0.32, -0.10, 0.92] },
    fingers: { left: 'open', right: 'relaxed' },
    osc: { arm: 'left', part: 'fore', axis: 'up', amp: 0.28, freq: 4.8 }, hold: 1700,
  },

  /* ─────────── low & mid beats ───────────
   * Deliberately kept at stomach-to-chest height. A talking head whose hands live up by
   * the face reads as agitated; real teachers spend most of their time down here. */
  open_low: {        // both palms low and open — the default "let me explain" rest beat
    right: { upper: [0.32, -0.88, 0.26], fore: [0.44, -0.36, 0.82] },
    left: { upper: [0.30, -0.90, 0.24], fore: [0.42, -0.40, 0.80] },
    fingers: { left: 'open', right: 'open' },
  },
  settle: {          // palms pressing down — "calm down, it's simpler than it looks"
    right: { upper: [0.38, -0.80, 0.30], fore: [0.48, -0.52, 0.70] },
    left: { upper: [0.36, -0.82, 0.28], fore: [0.46, -0.54, 0.68] },
    fingers: { left: 'open', right: 'open' },
    osc: { arm: 'right', part: 'fore', axis: 'up', amp: 0.14, freq: 2.2 }, hold: 2000,
  },
  clasp: {           // hands together low — a genuine pause beat between ideas
    right: { upper: [0.26, -0.90, 0.30], fore: [0.16, -0.30, 0.94] },
    left: { upper: [0.24, -0.92, 0.28], fore: [0.14, -0.32, 0.94] },
    fingers: { left: 'relaxed', right: 'relaxed' }, hold: 2400,
  },
  compare: {         // two hands apart at the same height — "this versus that"
    right: { upper: [0.62, -0.60, 0.34], fore: [0.66, -0.16, 0.72] },
    left: { upper: [0.60, -0.62, 0.32], fore: [0.64, -0.18, 0.70] },
    fingers: { left: 'open', right: 'open' }, hold: 2200,
  },
  narrow: {          // hands close together — "it comes down to just this"
    right: { upper: [0.28, -0.76, 0.36], fore: [0.16, -0.06, 0.96] },
    left: { upper: [0.26, -0.78, 0.34], fore: [0.14, -0.08, 0.96] },
    fingers: { left: 'open', right: 'open' }, hold: 2000,
  },
  stack: {           // one hand above the other — "this layer sits on that one"
    right: { upper: [0.40, -0.58, 0.38], fore: [0.34, 0.06, 0.90] },
    left: { upper: [0.36, -0.82, 0.30], fore: [0.32, -0.34, 0.84] },
    fingers: { left: 'open', right: 'open' }, hold: 2200,
  },
  roll_on: {         // "and so it continues" — hands rolling over each other
    right: { upper: [0.34, -0.70, 0.38], fore: [0.24, -0.04, 0.94] },
    left: { upper: [0.32, -0.74, 0.36], fore: [0.22, -0.12, 0.92] },
    fingers: { left: 'relaxed', right: 'relaxed' },
    osc: { arm: 'right', part: 'fore', axis: 'up', amp: 0.24, freq: 3.4 }, hold: 2300,
  },
  sweep: {           // sweeping across the whole idea
    right: { upper: [0.70, -0.50, 0.34], fore: [0.76, -0.20, 0.58] },
    fingers: { left: 'relaxed', right: 'open' },
    osc: { arm: 'right', part: 'fore', axis: 'fwd', amp: 0.26, freq: 2.6 }, hold: 2200,
  },
  low_point: {       // pointing down at the lower half of the board
    right: { upper: [0.74, -0.44, 0.30], fore: [0.82, -0.30, 0.44] },
    fingers: { left: 'relaxed', right: 'point' }, hold: 2200,
  },
  count_four: {
    right: { upper: [0.34, -0.52, 0.32], fore: [0.18, 0.48, 0.78] },
    fingers: { left: 'relaxed', right: 'four' }, hold: 1900,
  },
  count_five: {
    right: { upper: [0.34, -0.52, 0.32], fore: [0.18, 0.48, 0.78] },
    fingers: { left: 'relaxed', right: 'open' }, hold: 1900,
  },

  /* ─────────── idle beats (used only while she is NOT talking) ───────────
   * Without these the arms froze into one pose the moment a line ended, which is what
   * made a raised hand look stuck. These are barely-there shifts of weight. */
  idle_soft: {
    right: { upper: [0.29, -0.87, 0.27], fore: [0.32, -0.22, 0.88] },
    left: { upper: [0.27, -0.89, 0.25], fore: [0.30, -0.26, 0.86] },
    fingers: { left: 'relaxed', right: 'relaxed' },
  },
  idle_drop: {
    right: { upper: [0.26, -0.92, 0.22], fore: [0.30, -0.46, 0.80] },
    left: { upper: [0.25, -0.93, 0.20], fore: [0.28, -0.50, 0.78] },
    fingers: { left: 'relaxed', right: 'relaxed' },
  },
  idle_lean: {
    right: { upper: [0.34, -0.84, 0.30], fore: [0.38, -0.28, 0.86] },
    left: { upper: [0.24, -0.90, 0.22], fore: [0.22, -0.34, 0.88] },
    fingers: { left: 'relaxed', right: 'relaxed' },
  },
};

/* Finger curl in degrees: [thumb, index, middle, ring, pinky]. 0 = straight. */
const FINGERS = {
  relaxed: [14, 20, 24, 26, 28],
  open: [6, 4, 4, 6, 10],
  fist: [55, 88, 90, 90, 88],
  point: [30, 2, 88, 90, 88],
  two: [46, 3, 4, 90, 88],
  three: [16, 3, 4, 6, 88],
  four: [52, 3, 4, 6, 8],
  thumbsUp: [2, 90, 90, 90, 88],
  pinch: [42, 40, 74, 78, 78],
  claw: [26, 34, 36, 36, 34],
};

const EXPRESSIONS = {
  neutral: { mouthSmileLeft: 0.12, mouthSmileRight: 0.12 },
  smile: { mouthSmileLeft: 0.55, mouthSmileRight: 0.55, cheekSquintLeft: 0.30, cheekSquintRight: 0.30, eyeSquintLeft: 0.18, eyeSquintRight: 0.18, browInnerUp: 0.15 },
  explain: { mouthSmileLeft: 0.22, mouthSmileRight: 0.22, browInnerUp: 0.35, browOuterUpLeft: 0.25, browOuterUpRight: 0.25, eyeWideLeft: 0.15, eyeWideRight: 0.15 },
  think: { browDownLeft: 0.45, browDownRight: 0.45, eyeSquintLeft: 0.35, eyeSquintRight: 0.35, mouthPressLeft: 0.30, mouthPressRight: 0.30, mouthRollLower: 0.20 },
  cheeky: { mouthSmileLeft: 0.62, mouthSmileRight: 0.14, mouthDimpleLeft: 0.40, browOuterUpLeft: 0.45, browDownRight: 0.25, eyeSquintLeft: 0.30, cheekSquintLeft: 0.35 },
  laugh: { mouthSmileLeft: 0.80, mouthSmileRight: 0.80, jawOpen: 0.28, cheekSquintLeft: 0.60, cheekSquintRight: 0.60, eyeSquintLeft: 0.55, eyeSquintRight: 0.55, browInnerUp: 0.30 },
  wink: { eyeBlinkLeft: 0.95, mouthSmileLeft: 0.60, mouthSmileRight: 0.30, cheekSquintLeft: 0.50, browOuterUpRight: 0.30 },
  surprised: { eyeWideLeft: 0.70, eyeWideRight: 0.70, browInnerUp: 0.70, browOuterUpLeft: 0.50, browOuterUpRight: 0.50, jawOpen: 0.20 },
  proud: { mouthSmileLeft: 0.50, mouthSmileRight: 0.50, browOuterUpLeft: 0.30, browOuterUpRight: 0.30, cheekSquintLeft: 0.35, cheekSquintRight: 0.35 },
};

/* The talking pool is deliberately weighted toward LOW, two-handed and left-handed beats.
   The old pool was almost entirely right-arm-up poses, so the teacher spent the whole
   lesson with one hand hovering near her face. */
const TALK_GESTURES = ['explain', 'one_hand_explain', 'left_explain', 'open_low', 'open_low',
  'present_board', 'both_forward', 'compare', 'narrow', 'stack', 'settle', 'clasp', 'roll_on',
  'sweep', 'left_offer', 'left_pinch', 'left_chop', 'low_point', 'small_pinch', 'chop',
  'big_spread', 'weigh', 'circle', 'step_up', 'come_closer', 'push_away', 'think_chin'];
/* Poses that raise a hand up near the head. Still used — just never twice in a row, and
   never more than one in three beats, which is roughly how often a real teacher does it. */
const HIGH_GESTURES = new Set(['point_up', 'count_one', 'count_two', 'count_three', 'count_four',
  'count_five', 'wag_finger', 'tap_head', 'facepalm', 'point', 'wave']);
const ACCENT_GESTURES = ['point_up', 'count_one', 'count_two', 'count_three', 'count_four'];
const FUN_GESTURES = ['wag_finger', 'tap_head', 'shrug', 'thumbs_up', 'facepalm', 'clap'];
const IDLE_GESTURES = ['idle_soft', 'idle_drop', 'idle_lean', 'clasp'];

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (_) { return false; }
}

export async function createTeacher3D(host) {
  if (!hasWebGL()) throw new Error('WebGL unavailable');

  const THREE = await import(THREE_URL);
  const { FBXLoader } = await import(FBX_URL);

  const W = () => host.clientWidth || 480;
  const H = () => host.clientHeight || 520;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(W(), H());
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, W() / H(), 0.05, 100);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x2a2a3a, 1.5));
  const key = new THREE.DirectionalLight(0xfff1e0, 2.4); key.position.set(1.6, 2.6, 2.4); scene.add(key);
  const fill = new THREE.DirectionalLight(0x9fb0ff, 1.0); fill.position.set(-2.2, 1.4, 1.6); scene.add(fill);
  const rim = new THREE.DirectionalLight(0x5b4ff0, 1.8); rim.position.set(-0.6, 2.2, -2.6); scene.add(rim);

  const fbx = await withTimeout(new Promise((res, rej) => {
    new FBXLoader().load(AVATAR_URL, res, undefined,
      (e) => rej(new Error('avatar load failed: ' + ((e && e.message) || AVATAR_URL))));
  }), 25000);

  // normalise to ~1.7 m and stand on y = 0
  const b0 = new THREE.Box3().setFromObject(fbx);
  fbx.scale.setScalar(1.7 / Math.max(0.0001, b0.max.y - b0.min.y));
  fbx.updateMatrixWorld(true);
  const b1 = new THREE.Box3().setFromObject(fbx);
  fbx.position.y -= b1.min.y;
  fbx.updateMatrixWorld(true);
  scene.add(fbx);

  /* ── collect blendshapes + bones ── */
  const shapeRefs = new Map(), bones = new Map();
  fbx.traverse((o) => {
    if (o.isBone || o.type === 'Bone') {
      const short = o.name.replace(/^mixamorig[:_]?/i, '');
      if (!bones.has(short)) bones.set(short, o);
    }
    if (o.isMesh) {
      o.frustumCulled = false;
      if (o.morphTargetDictionary) {
        for (const n in o.morphTargetDictionary) {
          if (!shapeRefs.has(n)) shapeRefs.set(n, []);
          shapeRefs.get(n).push({ mesh: o, i: o.morphTargetDictionary[n] });
        }
      }
    }
  });
  if (!bones.get('RightArm') || !bones.get('RightForeArm')) throw new Error('avatar has no arm rig');

  const setShape = (n, v) => {
    const r = shapeRefs.get(n); if (!r) return;
    for (const x of r) if (x.mesh.morphTargetInfluences) x.mesh.morphTargetInfluences[x.i] = v;
  };

  // bind-pose quaternions — every pose is applied relative to these
  const bind = new Map();
  bones.forEach((b, n) => bind.set(n, b.quaternion.clone()));

  /* ── detect the avatar's own frame from its bind pose ── */
  const wpos = (b) => new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);
  fbx.updateMatrixWorld(true);
  const rHand = wpos(bones.get('RightHand') || bones.get('RightForeArm'));
  const lHand = wpos(bones.get('LeftHand') || bones.get('LeftForeArm'));
  // in a T-pose the hands are far apart on the side axis: that vector IS "avatar right"
  const RIGHT = rHand.clone().sub(lHand).setY(0).normalize();          // avatar's right
  const UP = new THREE.Vector3(0, 1, 0);
  const FWD = new THREE.Vector3().crossVectors(RIGHT, UP).normalize(); // faces the student
  // ensure FWD points at the camera (+Z side), flip if the rig faces away
  if (FWD.z < 0) FWD.negate();

  // build a world direction from [outward, up, forward] for a given arm
  function dirFor(side, v) {
    const out = RIGHT.clone().multiplyScalar(side === 'Right' ? v[0] : -v[0]);
    return out.add(UP.clone().multiplyScalar(v[1])).add(FWD.clone().multiplyScalar(v[2])).normalize();
  }

  /* ── aim a bone so it points along a world direction (rig-agnostic) ── */
  const _q = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _bq = new THREE.Quaternion();
  const _a = new THREE.Vector3(), _c = new THREE.Vector3();
  function aimBone(bone, child, targetDir) {
    if (!bone || !child) return;
    bone.updateWorldMatrix(true, false);
    child.updateWorldMatrix(true, false);
    _a.setFromMatrixPosition(bone.matrixWorld);
    _c.setFromMatrixPosition(child.matrixWorld);
    const curDir = _c.sub(_a).normalize();
    if (!isFinite(curDir.x) || curDir.lengthSq() < 1e-8) return;
    _q.setFromUnitVectors(curDir, targetDir);          // world-space correction
    bone.getWorldQuaternion(_bq);
    bone.parent.getWorldQuaternion(_pq);
    bone.quaternion.copy(_pq.invert().multiply(_q.multiply(_bq)));
  }

  /* ── finger curl: detect the axis from the palm, calibrate its sign ── */
  const FN = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
  const curlAxis = {};   // side -> THREE.Vector3 (world)
  const curlSign = {};
  ['Left', 'Right'].forEach(side => {
    const i1 = bones.get(`${side}HandIndex1`), p1 = bones.get(`${side}HandPinky1`), i3 = bones.get(`${side}HandIndex3`);
    if (!i1 || !p1) { curlAxis[side] = RIGHT.clone(); curlSign[side] = 1; return; }
    // fingers bend about the axis running ACROSS the palm (index → pinky)
    const across = wpos(p1).sub(wpos(i1)).normalize();
    curlAxis[side] = across;
    // calibrate: rotate a little and see whether the tip moved toward the palm or away
    curlSign[side] = 1;
    if (i3) {
      const before = wpos(i3);
      const palmN = new THREE.Vector3().crossVectors(across, wpos(i3).sub(wpos(i1)).normalize()).normalize();
      applyCurl(side, 'Index', 25);
      fbx.updateMatrixWorld(true);
      const after = wpos(i3);
      const moved = after.sub(before).normalize();
      // curling must move the tip toward the palm side; if it went the other way, flip
      if (moved.dot(palmN) < 0) curlSign[side] = -1;
      applyCurl(side, 'Index', 0);
      fbx.updateMatrixWorld(true);
    }
  });

  function applyCurl(side, finger, deg) {
    const axisW = curlAxis[side];
    if (!axisW) return;
    for (let j = 1; j <= 3; j++) {
      const nm = `${side}Hand${finger}${j}`;
      const b = bones.get(nm), bq = bind.get(nm);
      if (!b || !bq) continue;
      b.parent.getWorldQuaternion(_pq);
      const axisLocal = axisW.clone().applyQuaternion(_pq.invert()).normalize();
      const ang = deg * Math.PI / 180 * curlSign[side] * (finger === 'Thumb' ? 0.7 : 1);
      b.quaternion.copy(new THREE.Quaternion().setFromAxisAngle(axisLocal, ang).multiply(bq));
    }
  }

  /* ── pose state ── */
  const armCur = { Right: { upper: dirFor('Right', REST.upper), fore: dirFor('Right', REST.fore) },
                   Left: { upper: dirFor('Left', REST.upper), fore: dirFor('Left', REST.fore) } };
  const armTgt = { Right: { upper: armCur.Right.upper.clone(), fore: armCur.Right.fore.clone() },
                   Left: { upper: armCur.Left.upper.clone(), fore: armCur.Left.fore.clone() } };
  const fingCur = { Left: [...FINGERS.relaxed], Right: [...FINGERS.relaxed] };
  const fingTgt = { Left: [...FINGERS.relaxed], Right: [...FINGERS.relaxed] };
  let activeOsc = null, currentGesture = 'idle';

  function applyPose(name) {
    const p = POSES[name] || POSES.idle;
    ['Right', 'Left'].forEach(side => {
      const spec = p[side.toLowerCase()] || REST;
      armTgt[side].upper.copy(dirFor(side, spec.upper || REST.upper));
      armTgt[side].fore.copy(dirFor(side, spec.fore || REST.fore));
    });
    const f = p.fingers || { left: 'relaxed', right: 'relaxed' };
    fingTgt.Left = [...(FINGERS[f.left] || FINGERS.relaxed)];
    fingTgt.Right = [...(FINGERS[f.right] || FINGERS.relaxed)];
    activeOsc = p.osc || null;
    currentGesture = name;
  }
  applyPose('idle');

  /* ── camera framing ── */
  const headBone = bones.get('Head');
  // Frame the shot from the STOMACH to just above the crown, measured off the real
  // bones so it holds for any model scale — head-and-hands fill the panel, no legs.
  function frameCamera() {
    fbx.updateMatrixWorld(true);
    const headP = headBone ? wpos(headBone) : new THREE.Vector3(0, 1.55, 0);
    const midBone = bones.get('Spine1') || bones.get('Spine') || bones.get('Hips');
    const midP = midBone ? wpos(midBone) : new THREE.Vector3(0, headP.y - 0.45, 0);

    const topY = headP.y + 0.17;               // a little air above the head
    const botY = midP.y - 0.02;                // stomach / navel line
    const centerY = (topY + botY) / 2;
    const span = Math.max(0.42, topY - botY) * 1.12;   // breathing room

    const vFov = camera.fov * Math.PI / 180;
    const aspect = W() / H();
    let dist = (span / 2) / Math.tan(vFov / 2);
    // on a narrow panel, pull back just enough that gesturing hands don't get cropped
    const needWidth = 0.95;
    const hSpan = 2 * dist * Math.tan(vFov / 2) * aspect;
    if (hSpan < needWidth) dist *= needWidth / hSpan;

    camera.position.set(0.04, centerY + 0.02, dist);
    camera.lookAt(0, centerY, 0);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  }
  frameCamera();

  /* ── animation state ── */
  let mouthTarget = 0, mouthNow = 0, lookTarget = 0, lookNow = 0;
  let roundTarget = 0, roundNow = 0, wideTarget = 0, wideNow = 0;
  let speaking = false, disposed = false, holding = false;
  let exprNow = {}, exprTgt = { ...EXPRESSIONS.neutral };
  let blinkAt = performance.now() + 1200, blinkPhase = 0;
  let t = 0, autoTimer = 2.5, gestureHold = 0, baseY = null;
  const clock = new THREE.Clock();
  const _tmp = new THREE.Vector3(), _tmpUpper = new THREE.Vector3();

  function frame() {
    if (disposed) return;
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    t += dt;
    const now = performance.now();

    /* ── lip-sync: viseme blending from the audio spectrum ──
       open  = how far the jaw drops        (loudness)
       round = lips funnel/pucker  (o, u)   (low-frequency energy)
       wide  = lips stretch/spread (ee, s)  (mid+high energy)
       Rounding and spreading are mutually exclusive, so the stronger one wins.

       ── Which shapes are allowed to move ──
       Speech happens on the JAW and the LOWER lip. The upper lip barely travels: on a real
       face it is anchored to the skull. mouthUpperUp* is a SNEER — it drags the upper lip
       up toward the nostrils — and mouthShrugUpper pushes it up and out. Driving either of
       them from speech is what makes an avatar look like it is curling its lip at you, so
       neither is touched here. Same reason mouthPucker is kept low: at high values it
       balloons the lips forward past the nose line. */
    mouthNow += (mouthTarget - mouthNow) * 0.45;
    roundNow += (roundTarget - roundNow) * 0.30;
    wideNow += (wideTarget - wideNow) * 0.30;
    const m = mouthNow;
    const dom = roundNow - wideNow;                 // >0 rounded, <0 spread
    const r = Math.max(0, dom) * (0.35 + m * 0.65);
    const w = Math.max(0, -dom) * (0.35 + m * 0.65);

    setShape('jawOpen', m * 0.82);
    setShape('mouthClose', Math.max(0, 0.16 - m * 0.16));
    // rounding: funnel shapes the opening, pucker only nudges it forward
    setShape('mouthFunnel', r * 0.62);
    setShape('mouthPucker', r * 0.30 * (1 - m * 0.5));
    // spreading: the corners pull sideways — this is a stretch, never a lift
    setShape('mouthStretchLeft', w * 0.55);
    setShape('mouthStretchRight', w * 0.55);
    setShape('mouthDimpleLeft', w * 0.18);
    setShape('mouthDimpleRight', w * 0.18);
    // the lower lip follows the jaw down; the upper lip stays where it belongs
    setShape('mouthLowerDownLeft', m * 0.30);
    setShape('mouthLowerDownRight', m * 0.30);
    // a touch of jaw-forward on rounded sounds keeps the profile from looking flat
    setShape('jawForward', r * 0.18);
    // hold these at zero: they are sneer/shrug shapes, not speech shapes
    setShape('mouthUpperUpLeft', 0);
    setShape('mouthUpperUpRight', 0);
    setShape('mouthShrugUpper', 0);
    setShape('noseSneerLeft', 0);
    setShape('noseSneerRight', 0);

    /* expression */
    const keys = new Set([...Object.keys(exprNow), ...Object.keys(exprTgt)]);
    keys.forEach(k => {
      exprNow[k] = (exprNow[k] || 0) + ((exprTgt[k] || 0) - (exprNow[k] || 0)) * 0.07;
      if (speaking && /^mouthSmile/.test(k)) setShape(k, exprNow[k] * 0.5);
      else if (speaking && /^(mouth|jaw)/.test(k)) { /* lip-sync owns it */ }
      else setShape(k, exprNow[k]);
    });

    /* blink */
    if (now > blinkAt) { blinkPhase = 0.001; blinkAt = now + 2200 + Math.random() * 3200; }
    if (blinkPhase > 0) {
      const b = Math.sin(blinkPhase * Math.PI);
      setShape('eyeBlinkLeft', b); setShape('eyeBlinkRight', b);
      blinkPhase += dt * 8.5;
      if (blinkPhase >= 1) { blinkPhase = 0; setShape('eyeBlinkLeft', 0); setShape('eyeBlinkRight', 0); }
    }

    /* head / neck (quaternion, relative to bind) */
    lookNow += (lookTarget - lookNow) * 0.055;
    const sway = Math.sin(t * 0.55) * 0.035, nod = speaking ? Math.sin(t * 2.6) * 0.022 : 0;
    const head = bones.get('Head'), neck = bones.get('Neck');
    if (head && bind.get('Head')) {
      head.quaternion.copy(bind.get('Head')).multiply(
        new THREE.Quaternion().setFromEuler(new THREE.Euler(nod, lookNow * 0.62 + sway, 0, 'XYZ')));
    }
    if (neck && bind.get('Neck')) {
      neck.quaternion.copy(bind.get('Neck')).multiply(
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, lookNow * 0.38 + sway * 0.5, 0, 'XYZ')));
    }
    const eye = Math.max(-1, Math.min(1, lookNow * 1.6));
    setShape('eyeLookOutLeft', Math.max(0, -eye) * 0.6);
    setShape('eyeLookInLeft', Math.max(0, eye) * 0.6);
    setShape('eyeLookInRight', Math.max(0, -eye) * 0.6);
    setShape('eyeLookOutRight', Math.max(0, eye) * 0.6);

    /* breathing */
    const breath = Math.sin(t * 1.25);
    if (baseY === null) baseY = fbx.position.y;
    fbx.position.y = baseY + breath * 0.004;

    /* ── keep the arms moving ──
       While talking, cycle through the gesture pool. While NOT talking the arms used to
       freeze wherever the last gesture left them — which is why a raised hand could sit
       there indefinitely — so idle now drifts between calm low poses too. */
    if (!holding) {
      autoTimer -= dt;
      if (autoTimer <= 0) {
        if (speaking) {
          autoTimer = 2.4 + Math.random() * 2.2;
          const g = pickGesture(); noteGesture(g); applyPose(g);
        } else {
          autoTimer = 4.5 + Math.random() * 3.5;
          const g = IDLE_GESTURES[(Math.random() * IDLE_GESTURES.length) | 0];
          if (g !== currentGesture) applyPose(g);
        }
      }
    }

    /* ── drive the arms: ease toward the target directions, then aim ── */
    ['Right', 'Left'].forEach(side => {
      const c = armCur[side], g = armTgt[side];
      c.upper.lerp(g.upper, 0.09).normalize();
      c.fore.lerp(g.fore, 0.09).normalize();

      let foreDir = c.fore;
      // liveliness: wobble the forearm target while an osc gesture holds
      if (activeOsc && activeOsc.arm === side.toLowerCase()) {
        const v = Math.sin(t * activeOsc.freq) * activeOsc.amp;
        const ax = activeOsc.axis === 'up' ? UP : activeOsc.axis === 'fwd' ? FWD : RIGHT;
        foreDir = _tmp.copy(c.fore).addScaledVector(ax, v).normalize();
      }
      // subtle idle drift so the pose never looks frozen
      const drift = Math.sin(t * 0.9 + (side === 'Right' ? 0 : 1.7)) * (speaking ? 0.035 : 0.015);

      aimBone(bones.get(side + 'Arm'), bones.get(side + 'ForeArm'),
        _tmpUpper.copy(c.upper).addScaledVector(UP, drift).normalize());
      aimBone(bones.get(side + 'ForeArm'), bones.get(side + 'Hand'), foreDir);
    });

    /* fingers */
    ['Left', 'Right'].forEach(side => {
      let changed = false;
      for (let i = 0; i < 5; i++) {
        const d = fingTgt[side][i] - fingCur[side][i];
        if (Math.abs(d) > 0.15) { fingCur[side][i] += d * 0.14; changed = true; }
      }
      if (changed) for (let i = 0; i < 5; i++) applyCurl(side, FN[i], fingCur[side][i]);
    });

    renderer.render(scene, camera);
  }
  frame();

  /* Remembering only the CURRENT gesture meant the same three or four kept resurfacing and
     the teacher looked stuck. Keep a short history instead, and rate-limit the poses that
     put a hand up by the face so one never follows another. */
  const recent = [];
  function pickGesture() {
    const r = Math.random();
    const pool = r < 0.14 ? FUN_GESTURES : r < 0.24 ? ACCENT_GESTURES : TALK_GESTURES;
    let fallback = null;
    for (let i = 0; i < 14; i++) {
      const g = pool[(Math.random() * pool.length) | 0];
      if (!POSES[g] || g === currentGesture || recent.includes(g)) continue;
      fallback = fallback || g;
      // never two raised-hand beats back to back
      if (HIGH_GESTURES.has(g) && HIGH_GESTURES.has(currentGesture)) continue;
      return g;
    }
    return fallback || 'open_low';
  }
  function noteGesture(name) {
    recent.push(name);
    while (recent.length > 5) recent.shift();
  }

  function resize() { renderer.setSize(W(), H()); frameCamera(); }

  return {
    kind: '3d-fbx',
    gestures: Object.keys(POSES),
    setMouth(v) { mouthTarget = Math.max(0, Math.min(1, v)); },
    // richer driver used by classroom.js: jaw + lip rounding/spreading from the audio spectrum
    setViseme(v) {
      if (!v) return;
      mouthTarget = Math.max(0, Math.min(1, v.open || 0));
      roundTarget = Math.max(0, Math.min(1, v.round || 0));
      wideTarget = Math.max(0, Math.min(1, v.wide || 0));
    },
    setSpeaking(on) {
      speaking = on;
      if (!on) { mouthTarget = roundTarget = wideTarget = 0; if (!holding) { applyPose('idle_soft'); autoTimer = 3.0; } }
      else if (!holding) { applyPose('open_low'); autoTimer = 1.6; }
    },
    lookAt(w) { lookTarget = w === 'board' ? -0.62 : w === 'student' ? 0.22 : 0; },
    setExpression(mood) { exprTgt = { ...(EXPRESSIONS[mood] || EXPRESSIONS.neutral) }; },
    gesture(kind) {
      clearTimeout(gestureHold);
      if (kind === 'auto') kind = pickGesture();
      if (!POSES[kind]) kind = 'open_low';
      noteGesture(kind);
      applyPose(kind);
      const spec = POSES[kind] || {};
      if (spec.hold) {
        holding = true;
        // release into a LOW pose, never back into a raised hand
        gestureHold = setTimeout(() => {
          holding = false;
          autoTimer = speaking ? 0.6 : 2.5;      // pick a fresh beat soon after
          applyPose(speaking ? 'open_low' : 'idle_soft');
        }, spec.hold);
      } else holding = false;
    },
    resize,
    dispose() {
      disposed = true;
      clearTimeout(gestureHold);
      try { renderer.dispose(); renderer.forceContextLoss && renderer.forceContextLoss(); } catch (_) {}
      if (renderer.domElement && renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      scene.traverse(o => {
        if (o.geometry && o.geometry.dispose) o.geometry.dispose();
        if (o.material) [].concat(o.material).forEach(mm => {
          if (!mm) return;
          for (const k in mm) { const v = mm[k]; if (v && v.isTexture && v.dispose) v.dispose(); }
          mm.dispose && mm.dispose();
        });
      });
    },
  };
}

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('avatar load timed out')), ms))]);
}
