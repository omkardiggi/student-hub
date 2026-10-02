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
const GLTF_URL = 'https://esm.sh/three@0.161.0/examples/jsm/loaders/GLTFLoader.js';
const CSS3D_URL = 'https://esm.sh/three@0.161.0/examples/jsm/renderers/CSS3DRenderer.js';
/* A procedurally GENERATED environment — no HDRI file to download, and it is what stops
   skin, wood and metal reading as flat plastic. */
const ROOMENV_URL = 'https://esm.sh/three@0.161.0/examples/jsm/environments/RoomEnvironment.js';
/* Swap the teacher by setting window.OMKAR_AVATAR_URL before the classroom opens.
   Both formats are accepted, chosen by extension:
     • .fbx  — the bundled avatar (a Ready Player Me export)
     • .glb  — paste a Ready Player Me / Avaturn URL straight in, e.g.
               https://models.readyplayer.me/<id>.glb?morphTargets=ARKit&textureAtlas=1024
   Either way the rig must use standard bone names (Hips, Spine, RightArm, RightHand,
   RightHandIndex1 …) and ARKit blendshapes (jawOpen, mouthSmileLeft, eyeBlinkLeft …),
   which both Ready Player Me and Avaturn already produce. */
const AVATAR_URL = (typeof window !== 'undefined' && window.OMKAR_AVATAR_URL) || '/avatar/model.fbx';
const AVATAR_IS_GLB = /\.gl(b|tf)(\?|#|$)/i.test(AVATAR_URL);

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
/* Resting posture. Hands held comfortably at stomach/chest height in front of the body. */
const REST = { upper: [0.22, -0.65, 0.38], fore: [0.18, 0.28, 0.86] };

const POSES = {
  idle: {
    right: { upper: [0.22, -0.68, 0.36], fore: [0.18, 0.22, 0.88] },
    left: { upper: [0.22, -0.68, 0.36], fore: [0.18, 0.22, 0.88] },
    fingers: { left: 'relaxed', right: 'relaxed' }
  },

  // default talking posture — forearms up and forward, hands alive near chest
  explain: {
    right: { upper: [0.24, -0.52, 0.44], fore: [0.20, 0.46, 0.82] },
    left: { upper: [0.24, -0.52, 0.44], fore: [0.20, 0.46, 0.82] },
    fingers: { left: 'open', right: 'open' },
    osc: { arm: 'right', part: 'fore', axis: 'up', amp: 0.12, freq: 3.2 }, hold: 2600,
  },

  /* ── directing attention at the board ── */
  point: {   // arm extended toward the board on viewer's left, index pointing
    right: { upper: [0.46, -0.16, 0.38], fore: [0.54, 0.26, 0.48] },
    left: { upper: [0.20, -0.68, 0.34], fore: [0.16, 0.20, 0.88] },
    fingers: { left: 'relaxed', right: 'point' }, hold: 2800,
  },
  point_up: {  // "this is the important bit!"
    right: { upper: [0.26, 0.28, 0.36], fore: [0.14, 0.82, 0.42] },
    left: { upper: [0.20, -0.68, 0.34], fore: [0.16, 0.20, 0.88] },
    fingers: { left: 'relaxed', right: 'point' }, hold: 2200,
  },
  present_board: {  // open palm gesturing at the board
    right: { upper: [0.42, -0.22, 0.40], fore: [0.52, 0.22, 0.54] },
    left: { upper: [0.20, -0.68, 0.34], fore: [0.16, 0.20, 0.88] },
    fingers: { left: 'relaxed', right: 'open' }, hold: 2600,
  },
  both_forward: {  // "look, it's simple" — both palms to the student
    right: { upper: [0.22, -0.48, 0.46], fore: [0.18, 0.38, 0.88] },
    left: { upper: [0.22, -0.48, 0.46], fore: [0.18, 0.38, 0.88] },
    fingers: { left: 'open', right: 'open' }, hold: 2400,
  },

  /* ── counting ── */
  count_one: {
    right: { upper: [0.24, -0.42, 0.42], fore: [0.14, 0.62, 0.68] },
    left: { upper: [0.20, -0.68, 0.34], fore: [0.16, 0.20, 0.88] },
    fingers: { left: 'relaxed', right: 'point' }, hold: 2000,
  },
  count_two: {
    right: { upper: [0.24, -0.42, 0.42], fore: [0.14, 0.62, 0.68] },
    left: { upper: [0.20, -0.68, 0.34], fore: [0.16, 0.20, 0.88] },
    fingers: { left: 'relaxed', right: 'two' }, hold: 2000,
  },
  count_three: {
    right: { upper: [0.24, -0.42, 0.42], fore: [0.14, 0.62, 0.68] },
    left: { upper: [0.20, -0.68, 0.34], fore: [0.16, 0.20, 0.88] },
    fingers: { left: 'relaxed', right: 'three' }, hold: 2000,
  },

  /* ── size & emphasis ── */
  big_spread: {   // arms open wide to emphasize
    right: { upper: [0.55, -0.32, 0.38], fore: [0.48, 0.12, 0.72] },
    left: { upper: [0.55, -0.32, 0.38], fore: [0.48, 0.12, 0.72] },
    fingers: { left: 'open', right: 'open' }, hold: 2200,
  },
  small_pinch: {  // "bas thoda sa"
    right: { upper: [0.24, -0.52, 0.42], fore: [0.18, 0.44, 0.84] },
    left: { upper: [0.20, -0.68, 0.34], fore: [0.16, 0.20, 0.88] },
    fingers: { left: 'relaxed', right: 'pinch' }, hold: 2000,
  },
  chop: {         // hand chopping down on a key word
    right: { upper: [0.26, -0.46, 0.44], fore: [0.22, 0.30, 0.88] },
    left: { upper: [0.20, -0.68, 0.34], fore: [0.16, 0.20, 0.88] },
    fingers: { left: 'relaxed', right: 'open' },
    osc: { arm: 'right', part: 'fore', axis: 'up', amp: 0.24, freq: 4.8 }, hold: 1800,
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
   * Kept at stomach-to-chest height in front of the body with hands visible. */
  open_low: {        // both palms low and open — "let me explain" rest beat
    right: { upper: [0.24, -0.62, 0.40], fore: [0.20, 0.28, 0.86] },
    left: { upper: [0.24, -0.62, 0.40], fore: [0.20, 0.28, 0.86] },
    fingers: { left: 'open', right: 'open' },
    osc: { arm: 'right', part: 'fore', axis: 'up', amp: 0.10, freq: 2.8 }, hold: 2400,
  },
  settle: {          // palms pressing down — "it's simpler than it looks"
    right: { upper: [0.26, -0.58, 0.42], fore: [0.22, 0.18, 0.90] },
    left: { upper: [0.26, -0.58, 0.42], fore: [0.22, 0.18, 0.90] },
    fingers: { left: 'open', right: 'open' },
    osc: { arm: 'right', part: 'fore', axis: 'up', amp: 0.12, freq: 2.4 }, hold: 2000,
  },
  clasp: {           // hands together in front
    right: { upper: [0.20, -0.66, 0.38], fore: [0.14, 0.26, 0.90] },
    left: { upper: [0.20, -0.66, 0.38], fore: [0.14, 0.26, 0.90] },
    fingers: { left: 'relaxed', right: 'relaxed' }, hold: 2400,
  },
  compare: {         // two hands apart at the same height — "this versus that"
    right: { upper: [0.38, -0.46, 0.44], fore: [0.28, 0.32, 0.82] },
    left: { upper: [0.38, -0.46, 0.44], fore: [0.28, 0.32, 0.82] },
    fingers: { left: 'open', right: 'open' }, hold: 2200,
  },
  narrow: {          // hands close together — "it comes down to just this"
    right: { upper: [0.20, -0.56, 0.42], fore: [0.14, 0.36, 0.90] },
    left: { upper: [0.20, -0.56, 0.42], fore: [0.14, 0.36, 0.90] },
    fingers: { left: 'open', right: 'open' }, hold: 2000,
  },
  stack: {           // one hand above the other
    right: { upper: [0.26, -0.48, 0.42], fore: [0.18, 0.46, 0.84] },
    left: { upper: [0.22, -0.64, 0.38], fore: [0.16, 0.18, 0.90] },
    fingers: { left: 'open', right: 'open' }, hold: 2200,
  },
  roll_on: {         // hands rolling over each other
    right: { upper: [0.24, -0.54, 0.44], fore: [0.18, 0.34, 0.90] },
    left: { upper: [0.22, -0.58, 0.42], fore: [0.16, 0.28, 0.90] },
    fingers: { left: 'relaxed', right: 'relaxed' },
    osc: { arm: 'right', part: 'fore', axis: 'up', amp: 0.18, freq: 3.6 }, hold: 2300,
  },
  sweep: {           // sweeping across the whole idea
    right: { upper: [0.44, -0.32, 0.42], fore: [0.42, 0.22, 0.72] },
    left: { upper: [0.20, -0.66, 0.38], fore: [0.16, 0.20, 0.88] },
    fingers: { left: 'relaxed', right: 'open' },
    osc: { arm: 'right', part: 'fore', axis: 'fwd', amp: 0.20, freq: 2.8 }, hold: 2200,
  },
  low_point: {       // pointing down toward lower board
    right: { upper: [0.46, -0.30, 0.38], fore: [0.50, -0.06, 0.60] },
    left: { upper: [0.20, -0.66, 0.38], fore: [0.16, 0.20, 0.88] },
    fingers: { left: 'relaxed', right: 'point' }, hold: 2200,
  },
  count_four: {
    right: { upper: [0.24, -0.42, 0.42], fore: [0.14, 0.62, 0.68] },
    left: { upper: [0.20, -0.68, 0.34], fore: [0.16, 0.20, 0.88] },
    fingers: { left: 'relaxed', right: 'four' }, hold: 1900,
  },
  count_five: {
    right: { upper: [0.24, -0.42, 0.42], fore: [0.14, 0.62, 0.68] },
    left: { upper: [0.20, -0.68, 0.34], fore: [0.16, 0.20, 0.88] },
    fingers: { left: 'relaxed', right: 'open' }, hold: 1900,
  },

  /* ─────────── idle beats (used only while NOT talking) ─────────── */
  idle_soft: {
    right: { upper: [0.22, -0.66, 0.36], fore: [0.18, 0.22, 0.88] },
    left: { upper: [0.22, -0.66, 0.36], fore: [0.18, 0.22, 0.88] },
    fingers: { left: 'relaxed', right: 'relaxed' },
  },
  idle_drop: {
    right: { upper: [0.20, -0.70, 0.34], fore: [0.16, 0.16, 0.90] },
    left: { upper: [0.20, -0.70, 0.34], fore: [0.16, 0.16, 0.90] },
    fingers: { left: 'relaxed', right: 'relaxed' },
  },
  idle_lean: {
    right: { upper: [0.24, -0.62, 0.38], fore: [0.20, 0.26, 0.86] },
    left: { upper: [0.18, -0.72, 0.32], fore: [0.14, 0.14, 0.92] },
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

export async function createTeacher3D(host, opts = {}) {
  if (!hasWebGL()) throw new Error('WebGL unavailable');
  // framing: 'bust'  stomach→head (the default, for a narrow side panel)
  //          'stand' mid-thigh→head (a ¾ figure behind a counter)
  //          'full'  ground→head — the whole standing figure, feet included, so the
  //                  teacher can stand ON the classroom floor with nothing hiding her legs.
  const framing = opts.framing || 'bust';
  /* How many metres of horizontal room the shot must guarantee, for arms thrown wide.
     On a NARROW panel this is what decides the zoom: demand too much width and the camera
     retreats until the teacher is a small figure adrift in the middle of the frame. The
     per-framing defaults suit a wide panel, so a caller with a tall thin panel should pass
     its own smaller value. */
  const needWidthOpt = typeof opts.needWidth === 'number' ? opts.needWidth : null;
  /* room: true builds a real 3D classroom in this same scene and puts the teacher inside
     it, instead of rendering her alone on a transparent canvas over CSS scenery.
     boardEl is the existing DOM board — it is mounted as a CSS3D object behind the WebGL
     canvas and shows through the opening in the back wall, so slide text stays real HTML. */
  const wantRoom = !!opts.room;
  const boardEl = opts.boardEl || null;

  const THREE = await import(THREE_URL);

  const W = () => host.clientWidth || 480;
  const H = () => host.clientHeight || 520;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  // Cap the render resolution. A retina/4K panel at devicePixelRatio 2 quadruples the pixels
  // the GPU shades every frame — the single biggest cause of the choppy avatar. 1.5 keeps it
  // crisp while roughly halving that cost on high-DPI screens.
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(W(), H());
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = wantRoom ? 0.95 : 1.05;
  if (wantRoom) {
    // Shadows are the single biggest realism win — without one under her feet she looks
    // pasted onto the room rather than standing in it.
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }
  renderer.domElement.style.cssText = 'position:absolute;inset:0;z-index:2;pointer-events:none';

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(wantRoom ? 34 : 30, W() / H(), 0.05, 100);

  /* ── room mode: real classroom, real lights, generated environment ── */
  let room = null, roomLights = null, cssRenderer = null, cssScene = null, ROOM = null;
  if (wantRoom) {
    const [roomMod, envMod, cssMod] = await Promise.all([
      import('./room3d.js?v=18'), import(ROOMENV_URL), import(CSS3D_URL),
    ]);
    ROOM = roomMod.ROOM;
    room = roomMod.buildRoom(THREE, scene);
    roomLights = roomMod.buildLights(THREE, scene);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new envMod.RoomEnvironment(renderer);
    scene.environment = pmrem.fromScene(envScene, 0.04).texture;
    pmrem.dispose();

    cssScene = new THREE.Scene();
    cssRenderer = new cssMod.CSS3DRenderer();
    cssRenderer.setSize(W(), H());
    cssRenderer.domElement.style.cssText = 'position:absolute;inset:0;z-index:1;pointer-events:none';
    host.appendChild(cssRenderer.domElement);
    if (boardEl) {
      const B = ROOM.board;
      boardEl.style.pointerEvents = 'auto';
      const obj = new cssMod.CSS3DObject(boardEl);
      const px = opts.boardPx || 1480;
      obj.scale.setScalar(((B.x1 - B.x0) + 0.10) / px);
      obj.position.set((B.x0 + B.x1) / 2, (B.y0 + B.y1) / 2, ROOM.backZ + 0.012);
      cssScene.add(obj);
    }
  } else {
    scene.add(new THREE.HemisphereLight(0xffffff, 0x2a2a3a, 1.5));
    const key = new THREE.DirectionalLight(0xfff1e0, 2.4); key.position.set(1.6, 2.6, 2.4); scene.add(key);
    const fill = new THREE.DirectionalLight(0x9fb0ff, 1.0); fill.position.set(-2.2, 1.4, 1.6); scene.add(fill);
    const rim = new THREE.DirectionalLight(0x5b4ff0, 1.8); rim.position.set(-0.6, 2.2, -2.6); scene.add(rim);
  }

  // Load the avatar with the loader that matches its format.
  let fbx = null;
  try {
    fbx = await withTimeout(new Promise((res, rej) => {
      const onErr = (e) => rej(new Error('avatar load failed: ' + ((e && e.message) || AVATAR_URL)));
      if (AVATAR_IS_GLB) {
        import(GLTF_URL)
          .then(({ GLTFLoader }) => new GLTFLoader().load(AVATAR_URL,
            (gltf) => res(gltf.scene || (gltf.scenes && gltf.scenes[0])), undefined, onErr))
          .catch(onErr);
      } else {
        import(FBX_URL)
          .then(({ FBXLoader }) => new FBXLoader().load(AVATAR_URL, res, undefined, onErr))
          .catch(onErr);
      }
    }), 25000);
  } catch (err) {
    try { renderer.dispose(); } catch (_) {}
    throw err;
  }
  if (!fbx) {
    try { renderer.dispose(); } catch (_) {}
    throw new Error('avatar had no scene');
  }

  // normalise to ~1.7 m and stand on y = 0
  const b0 = new THREE.Box3().setFromObject(fbx);
  fbx.scale.setScalar(1.7 / Math.max(0.0001, b0.max.y - b0.min.y));
  fbx.updateMatrixWorld(true);
  const b1 = new THREE.Box3().setFromObject(fbx);
  fbx.position.y -= b1.min.y;
  if (wantRoom && ROOM) fbx.position.set(ROOM.teacher.x, fbx.position.y, ROOM.teacher.z);
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
      o.visible = true;
      if (wantRoom) o.castShadow = true;
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(m => {
          m.side = THREE.DoubleSide;
          if (m.opacity < 0.1) m.opacity = 1;
          m.needsUpdate = true;
        });
      }
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
  // reused by applyCurl so finger curls never allocate on the animation hot-path
  const _axisLocal = new THREE.Vector3(), _curlQ = new THREE.Quaternion();
  function aimBone(bone, child, targetDir) {
    if (!bone || !child) return;
    const name = bone.name.replace(/^mixamorig[:_]?/i, '');
    const bq = bind.get(name);
    if (bq) bone.quaternion.copy(bq);
    bone.updateWorldMatrix(true, false);
    child.updateWorldMatrix(true, false);
    _a.setFromMatrixPosition(bone.matrixWorld);
    _c.setFromMatrixPosition(child.matrixWorld);
    const curDir = _c.sub(_a).normalize();
    if (!isFinite(curDir.x) || curDir.lengthSq() < 1e-8) return;
    _q.setFromUnitVectors(curDir, targetDir);          // world-space correction
    bone.getWorldQuaternion(_bq);
    if (bone.parent) {
      bone.parent.getWorldQuaternion(_pq);
      bone.quaternion.copy(_pq.invert().multiply(_q.multiply(_bq)));
    } else {
      bone.quaternion.copy(_q.multiply(_bq));
    }
  }

  /* ── finger curl: detect the axis from the palm, calibrate its sign ── */
  const FN = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
  const curlAxis = {};   // side -> THREE.Vector3 (world)
  const curlSign = {};
  // Precompute the {bone, bindQuat} for every finger joint once. The old code rebuilt the
  // bone-name string (`${side}Hand${finger}${j}`) and hit the bones Map on every frame a
  // gesture was in motion — 30 string allocations + lookups per frame. Now it's a flat array.
  const fingerChain = { Left: {}, Right: {} };
  ['Left', 'Right'].forEach((side) => FN.forEach((f) => {
    const arr = [];
    for (let j = 1; j <= 3; j++) { const nm = `${side}Hand${f}${j}`; arr.push({ b: bones.get(nm), bq: bind.get(nm) }); }
    fingerChain[side][f] = arr;
  }));
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
    const chain = fingerChain[side][finger];
    if (!chain) return;
    const ang = deg * Math.PI / 180 * curlSign[side] * (finger === 'Thumb' ? 0.7 : 1);
    for (let j = 0; j < 3; j++) {
      const b = chain[j].b, bq = chain[j].bq;
      if (!b || !bq) continue;
      b.parent.getWorldQuaternion(_pq);
      _axisLocal.copy(axisW).applyQuaternion(_pq.invert()).normalize();
      b.quaternion.copy(_curlQ.setFromAxisAngle(_axisLocal, ang).multiply(bq));
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
  // Frame the shot off the real bones so it holds for any model scale.
  //   'bust'  → stomach to just above the crown (head-and-hands fill a narrow panel)
  //   'stand' → mid-thigh to above the crown (a standing ¾ figure for the room scene;
  //             the classroom counter hides everything below the frame)
  /* ── room mode camera ──────────────────────────────────────────────────────────────
   * In a real room the camera is a camera IN that room, not a portrait framing bolted to
   * the avatar. Seats are preset viewpoints the student can switch between; drag orbits
   * within hard limits so they can never end up outside the walls or under the floor.
   * Unclamped orbit in a teaching scene just gets people lost. */
  const SEATS = {
    front: { pos: [-0.15, 1.62, 2.55], look: [-0.30, 1.62, -3.1], fov: 34 },
    centre: { pos: [-0.10, 1.70, 3.30], look: [-0.20, 1.55, -3.1], fov: 32 },
    side: { pos: [2.45, 1.60, 1.70], look: [-0.60, 1.60, -3.1], fov: 36 },
    board: { pos: [-0.90, 1.75, 0.60], look: [-0.90, 1.85, -3.2], fov: 30 },
    teacher: { pos: [1.55, 1.62, 0.30], look: [1.80, 1.45, -2.4], fov: 30 },
  };
  let seat = 'front';
  let yaw = 0, pitch = 0, dolly = 0;        // student's own look-around, added to the seat
  const camTarget = new THREE.Vector3();
  const _camPos = new THREE.Vector3();

  function applyRoomCamera(instant) {
    const s = SEATS[seat] || SEATS.front;
    const look = new THREE.Vector3(s.look[0], s.look[1], s.look[2]);
    const base = new THREE.Vector3(s.pos[0], s.pos[1], s.pos[2]);
    // orbit the seat position around its look-at point by the student's yaw/pitch
    const off = base.clone().sub(look);
    const r = Math.max(0.8, off.length() + dolly);
    const az = Math.atan2(off.x, off.z) + yaw;
    const el = Math.asin(Math.max(-0.99, Math.min(0.99, off.y / off.length()))) + pitch;
    const ce = Math.cos(el);
    _camPos.set(look.x + Math.sin(az) * ce * r, look.y + Math.sin(el) * r, look.z + Math.cos(az) * ce * r);
    // never let the camera leave the room or sink through the floor
    _camPos.x = Math.max(-4.2, Math.min(4.2, _camPos.x));
    _camPos.y = Math.max(0.85, Math.min(ROOM.H - 0.25, _camPos.y));
    _camPos.z = Math.max(ROOM.backZ + 0.9, Math.min(ROOM.frontZ - 0.3, _camPos.z));

    if (instant) camera.position.copy(_camPos);
    else camera.position.lerp(_camPos, 0.12);       // glide between seats
    camTarget.lerp(look, instant ? 1 : 0.12);
    camera.lookAt(camTarget);
    camera.fov += ((s.fov) - camera.fov) * (instant ? 1 : 0.12);
    camera.aspect = W() / H();
    camera.updateProjectionMatrix();
  }

  /* drag to look around, wheel to lean in — both clamped */
  let dragging = false, lastX = 0, lastY = 0;
  function onDown(e) { dragging = true; lastX = e.clientX; lastY = e.clientY; }
  function onUp() { dragging = false; }
  function onMove(e) {
    if (!dragging) return;
    yaw -= (e.clientX - lastX) * 0.0045;
    pitch += (e.clientY - lastY) * 0.0030;
    lastX = e.clientX; lastY = e.clientY;
    yaw = Math.max(-0.55, Math.min(0.55, yaw));      // ±31° — enough to feel free, not lost
    pitch = Math.max(-0.22, Math.min(0.30, pitch));
  }
  function onWheel(e) {
    e.preventDefault();
    dolly = Math.max(-1.4, Math.min(2.0, dolly + Math.sign(e.deltaY) * 0.22));
  }
  if (wantRoom) {
    const dom = renderer.domElement;
    dom.style.cursor = 'grab';
    dom.style.pointerEvents = 'auto';
    dom.addEventListener('pointerdown', onDown);
    dom.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointermove', onMove);
  }

  function frameCamera() {
    if (wantRoom) { applyRoomCamera(true); return; }
    fbx.updateMatrixWorld(true);
    const headP = headBone ? wpos(headBone) : new THREE.Vector3(0, 1.55, 0);

    let botY, needWidth;
    if (framing === 'full') {
      // The model was normalised so its lowest point sits on y = 0, so the ground plane
      // IS y = 0. A hair below it keeps the soles inside the frame rather than on the edge.
      botY = -0.02;
      needWidth = 1.30;              // a standing figure with arms thrown wide
    } else if (framing === 'stand') {
      const hipBone = bones.get('Hips') || bones.get('Spine') || bones.get('Spine1');
      const hipP = hipBone ? wpos(hipBone) : new THREE.Vector3(0, headP.y - 0.65, 0);
      botY = hipP.y - 0.55;          // down to mid/lower thigh — the counter covers the rest
      needWidth = 1.15;              // room for arms thrown wide while standing
    } else {
      const midBone = bones.get('Spine1') || bones.get('Spine') || bones.get('Hips');
      const midP = midBone ? wpos(midBone) : new THREE.Vector3(0, headP.y - 0.45, 0);
      botY = midP.y - 0.10;          // down to waist so gesturing hands are clearly in view
      needWidth = 1.15;              // spacious width for teaching hand gestures
    }

    const topY = headP.y + (framing === 'bust' ? 0.15 : 0.20);   // air above head
    const centerY = (topY + botY) / 2;
    const span = Math.max(0.42, topY - botY) * (framing === 'bust' ? 1.08 : 1.12);              // breathing room

    const vFov = camera.fov * Math.PI / 180;
    const aspect = Math.max(0.2, Math.min(5, W() / H()));
    let dist = (span / 2) / Math.tan(vFov / 2);
    // on a narrow panel, pull back just enough that gesturing hands don't get cropped
    if (needWidthOpt !== null) needWidth = needWidthOpt;
    const hSpan = 2 * dist * Math.tan(vFov / 2) * aspect;
    if (hSpan < needWidth && hSpan > 1e-4) dist *= needWidth / hSpan;
    dist = Math.max(0.6, Math.min(3.5, dist));

    camera.position.set(0.02, centerY + 0.03, dist);
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
  const _headQ = new THREE.Quaternion(), _headE = new THREE.Euler();   // reused each frame

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
    // Fast attack (0.85) so lip movements sync with speech audio, smooth release
    let effectiveMouthTarget = mouthTarget;
    let effectiveRoundTarget = roundTarget;
    let effectiveWideTarget = wideTarget;

    mouthNow += (effectiveMouthTarget - mouthNow) * (effectiveMouthTarget > mouthNow ? 0.85 : 0.40);
    roundNow += (effectiveRoundTarget - roundNow) * 0.35;
    wideNow += (effectiveWideTarget - wideNow) * 0.35;
    const m = mouthNow;
    // When m is near zero (silent / pause), all mouth shapes MUST be 0 so lips rest completely natural and relaxed!
    if (m < 0.02) {
      setShape('jawOpen', 0);
      setShape('mouthClose', 0);
      setShape('mouthFunnel', 0);
      setShape('mouthPucker', 0);
      setShape('mouthStretchLeft', 0);
      setShape('mouthStretchRight', 0);
      setShape('mouthDimpleLeft', 0);
      setShape('mouthDimpleRight', 0);
      setShape('mouthLowerDownLeft', 0);
      setShape('mouthLowerDownRight', 0);
      setShape('jawForward', 0);
      setShape('mouthRollLower', 0);
      setShape('mouthRollUpper', 0);
    } else {
      const dom = roundNow - wideNow;                 // >0 rounded, <0 spread
      const r = Math.max(0, dom) * m;
      const w = Math.max(0, -dom) * m;

      setShape('jawOpen', Math.min(0.65, m * 0.65));
      setShape('mouthClose', 0);
      setShape('mouthFunnel', Math.min(0.18, r * 0.25));
      setShape('mouthPucker', 0); // No duck lips or puckering!
      setShape('mouthStretchLeft', Math.min(0.25, w * 0.30));
      setShape('mouthStretchRight', Math.min(0.25, w * 0.30));
      setShape('mouthDimpleLeft', 0);
      setShape('mouthDimpleRight', 0);
      setShape('mouthLowerDownLeft', Math.min(0.22, m * 0.22));
      setShape('mouthLowerDownRight', Math.min(0.22, m * 0.22));
      setShape('jawForward', 0);
      setShape('mouthRollLower', 0);
      setShape('mouthRollUpper', 0);
    }
    // hold sneer/shrug at zero
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
    const sway = Math.sin(t * 0.55) * 0.035, nod = speaking ? Math.sin(t * 3.2) * 0.030 : 0;
    const head = bones.get('Head'), neck = bones.get('Neck');
    if (head && bind.get('Head')) {
      head.quaternion.copy(bind.get('Head')).multiply(
        _headQ.setFromEuler(_headE.set(nod, lookNow * 0.62 + sway, 0, 'XYZ')));
    }
    if (neck && bind.get('Neck')) {
      neck.quaternion.copy(bind.get('Neck')).multiply(
        _headQ.setFromEuler(_headE.set(0, lookNow * 0.38 + sway * 0.5, 0, 'XYZ')));
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

    /* ── keep the arms and hands moving while explaining ── */
    if (!holding) {
      autoTimer -= dt;
      if (autoTimer <= 0) {
        if (speaking) {
          // Dynamic conversational gesture cycling (every 2.0 to 3.4 seconds)
          autoTimer = 2.0 + Math.random() * 1.4;
          const g = pickGesture(); noteGesture(g); applyPose(g);
        } else {
          autoTimer = 4.2 + Math.random() * 2.8;
          const g = IDLE_GESTURES[(Math.random() * IDLE_GESTURES.length) | 0];
          if (g !== currentGesture) applyPose(g);
        }
      }
    }

    /* ── drive the arms: ease toward the target directions, then aim ── */
    ['Right', 'Left'].forEach(side => {
      const c = armCur[side], g = armTgt[side];
      const ease = 0.08;
      c.upper.lerp(g.upper, ease).normalize();
      c.fore.lerp(g.fore, ease).normalize();

      let foreDir = c.fore;
      // liveliness: wobble the forearm target while an osc gesture holds
      if (activeOsc && activeOsc.arm === side.toLowerCase()) {
        const v = Math.sin(t * activeOsc.freq) * activeOsc.amp;
        const ax = activeOsc.axis === 'up' ? UP : activeOsc.axis === 'fwd' ? FWD : RIGHT;
        foreDir = _tmp.copy(c.fore).addScaledVector(ax, v).normalize();
      }
      
      // conversational speech pulse: hands and forearms gently articulate in rhythm with speech
      const speakBounce = speaking ? Math.sin(t * 4.2 + (side === 'Right' ? 0 : 1.2)) * 0.06 : 0;
      const drift = Math.sin(t * 0.9 + (side === 'Right' ? 0 : 1.7)) * (speaking ? 0.035 : 0.015);

      aimBone(bones.get(side + 'Arm'), bones.get(side + 'ForeArm'),
        _tmpUpper.copy(c.upper).addScaledVector(UP, drift + speakBounce * 0.4).normalize());
      aimBone(bones.get(side + 'ForeArm'), bones.get(side + 'Hand'),
        _tmp.copy(foreDir).addScaledVector(UP, speakBounce).normalize());

      // keep the hand and wrist bone naturally straight along the forearm
      const handBone = bones.get(side + 'Hand');
      const handBind = bind.get(side + 'Hand');
      if (handBone && handBind) handBone.quaternion.copy(handBind);
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

    if (wantRoom) applyRoomCamera(false);      // glide toward the chosen seat / look
    renderer.render(scene, camera);
    // the CSS3D board shares the SAME camera, so it stays glued to the wall as you look round
    if (cssRenderer) cssRenderer.render(cssScene, camera);
  }
  frame();
  // Attach canvas to host now that scene and avatar are fully loaded and rendered
  host.appendChild(renderer.domElement);

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

  function resize() {
    renderer.setSize(W(), H());
    if (cssRenderer) cssRenderer.setSize(W(), H());
    frameCamera();
  }

  return {
    kind: wantRoom ? '3d-room' : '3d-fbx',
    gestures: Object.keys(POSES),
    /* room-mode extras — classroom.js wires these to the seat buttons */
    hasRoom: wantRoom,
    seats: Object.keys(SEATS),
    setSeat(name) { if (SEATS[name]) { seat = name; yaw = pitch = dolly = 0; } },
    resetView() { yaw = pitch = dolly = 0; },
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
      else if (!holding) { applyPose('explain'); autoTimer = 1.6; }
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
      // room-mode listeners live on window, so they MUST come off or they leak per class
      if (wantRoom) {
        renderer.domElement.removeEventListener('pointerdown', onDown);
        renderer.domElement.removeEventListener('wheel', onWheel);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointermove', onMove);
      }
      if (room) { try { room.dispose(); } catch (_) {} }
      if (roomLights) { try { roomLights.dispose(); } catch (_) {} }
      if (scene.environment && scene.environment.dispose) { try { scene.environment.dispose(); } catch (_) {} }
      /* Hand the board element back to the page before the CSS3D layer is torn down,
         otherwise it is removed along with it and the next class opens with no board. */
      if (cssRenderer) {
        if (boardEl && boardEl.parentNode) boardEl.parentNode.removeChild(boardEl);
        if (cssRenderer.domElement.parentNode) cssRenderer.domElement.parentNode.removeChild(cssRenderer.domElement);
      }
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
    _debug: { fbx, bones, armCur, armTgt, get currentGesture() { return currentGesture; }, RIGHT, UP, FWD, dirFor }
  };
}

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('avatar load timed out')), ms))]);
}
