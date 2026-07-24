/* debate-arena.js — Omkar Hub · Debate Arena.
 *
 * A full-screen, Meet/Zoom-style overlay that opens OVER the dashboard (never scrolls the
 * page). Three ways in:
 *   • Create a room   → get a code, others join (peer-to-peer video via PeerJS)
 *   • Join a room     → enter a code
 *   • Debate the AI   → solo, a real structured debate against a voice AI opponent
 *
 * Whatever the mode, an AI COORDINATOR runs the debate as classic timed rounds —
 * Opening statements → Rebuttals → Closing statements — announcing each phase and whose
 * turn it is, giving everyone an equal, protected slot, with pause/play and skip controls.
 * At the end the AI judge scores everyone: strengths, key points, real-world accuracy with
 * an example, and the winner.
 *
 * Public API:  window.DebateArena.open(me)  /  .close()  /  .isOpen()
 */
(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // classic-debate phases and how long each speaker's human slot lasts (seconds)
  const PHASES = [
    { key: 'opening', label: 'Opening', secs: 60, say: 'opening statement' },
    { key: 'rebuttal', label: 'Rebuttal', secs: 45, say: 'rebuttal' },
    { key: 'closing', label: 'Closing', secs: 40, say: 'closing statement' },
  ];

  let root = null, opened = false, me = null;
  let A = null;   // arena state (null when not in a live debate)

  /* ═══════════════════════ open / close ═══════════════════════ */
  function open(user) {
    if (opened) return;
    me = user || window.me || { name: 'Student', email: '' };
    buildShell();
    document.body.style.overflow = 'hidden';
    opened = true;
    requestAnimationFrame(() => root.classList.add('is-open'));
    showEntry();
  }

  function close() {
    teardownDebate();
    document.body.style.overflow = '';
    if (root) { root.classList.remove('is-open'); const r = root; setTimeout(() => r.remove(), 320); root = null; }
    opened = false;
  }

  const isOpen = () => opened;

  /* ═══════════════════════ shell DOM ═══════════════════════ */
  function buildShell() {
    root = el('div', 'dba');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Debate Arena');
    root.innerHTML = `
      <div class="dba__top">
        <span class="dba__brand"><span class="mark">⚖</span><span>Debate Arena<small>Student Hub · live debate</small></span></span>
        <span class="dba__sp"></span>
        <span class="dba__pill" id="dbaLive" hidden><span class="dot"></span> LIVE</span>
        <span class="dba__pill" id="dbaCode" hidden></span>
        <button class="dba__x" id="dbaX" title="Exit (Esc)"><svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button>
      </div>
      <div class="dba__body" style="flex:1;min-height:0;display:flex;"></div>`;
    document.body.appendChild(root);
    $('#dbaX', root).onclick = () => {
      if (A && A.running && !confirm('Leave the debate? It will end without a result.')) return;
      close();
    };
    onKey.handler = (e) => { if (e.key === 'Escape') { if (A && A.running) return; close(); } };
    document.addEventListener('keydown', onKey.handler);
  }
  const onKey = {};

  function body() { return $('.dba__body', root); }

  /* ═══════════════════════ ENTRY screen ═══════════════════════ */
  function showEntry() {
    teardownDebate();
    setLive(false);
    const name = (me.name || '').trim();
    const id = (me.email || '').trim();
    body().innerHTML = `
      <div class="dba-entry"><div class="dba-entry__in">
        <div class="dba-entry__head">
          <h1>Step into the arena.</h1>
          <p>Debate live with classmates, or sharpen up against an AI opponent. A coordinator keeps it fair.</p>
        </div>
        <div class="dba-id">
          <div class="dba-field"><label>Your name</label>
            <input class="dba-input" id="dbaName" placeholder="e.g. Om Diggi" value="${esc(name)}"></div>
          <div class="dba-field"><label>Student ID <span style="color:var(--dba-mut);font-weight:500">(roll / USN)</span></label>
            <input class="dba-input" id="dbaId" placeholder="e.g. 1TE25CS183" value="${esc(id)}"></div>
        </div>
        <div class="dba-cards">
          <button class="dba-card dba-card--create" id="dbaCreate">
            <span class="dba-card__ic">🚀</span>
            <h3>Create a room</h3>
            <p>Get an instant room code and host a live debate. Share it with your friends to let them join.</p>
            <span class="dba-card__cta">Start hosting →</span>
          </button>
          <div class="dba-card dba-card--join">
            <span class="dba-card__ic">🔑</span>
            <h3>Join a room</h3>
            <p>Got a code from a friend? Drop it in and jump straight into their debate.</p>
            <div class="dba-joinrow">
              <input class="dba-input" id="dbaJoinCode" placeholder="Room code" autocomplete="off">
              <button class="dba-mini" id="dbaJoin">Join</button>
            </div>
          </div>
          <button class="dba-card dba-card--ai" id="dbaAI">
            <span class="dba-card__ic">🤖</span>
            <h3>Debate the AI</h3>
            <p>No one around? Take on a voice AI that argues the opposite side for real — opening, rebuttals and a closing.</p>
            <span class="dba-card__cta">Practice solo →</span>
          </button>
        </div>
        <div class="dba-status" id="dbaEntryStatus"></div>
        <p class="dba-entry__note">🎥 Camera &amp; 🎤 mic are used only in your browser and between peers — nothing is uploaded except your speech, and only for scoring.</p>
      </div></div>`;

    const nameOf = () => ($('#dbaName', root).value.trim() || me.name || 'Student');
    const idOf = () => ($('#dbaId', root).value.trim() || me.email || ('STU-' + Math.floor(1000 + Math.random() * 9000)));

    $('#dbaCreate', root).onclick = () => showSetup({ mode: 'host', name: nameOf(), id: idOf() });
    $('#dbaAI', root).onclick = () => showSetup({ mode: 'ai', name: nameOf(), id: idOf() });
    $('#dbaJoin', root).onclick = () => {
      const code = $('#dbaJoinCode', root).value.trim().toUpperCase();
      if (!code) { entryStatus('Enter the room code your friend shared.'); return; }
      joinRoom({ code, name: nameOf(), id: idOf() });
    };
    $('#dbaJoinCode', root).addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#dbaJoin', root).click(); });
  }
  const entryStatus = (t) => { const n = $('#dbaEntryStatus', root); if (n) n.textContent = t || ''; };

  /* ═══════════════════════ SETUP screen (topic + side) ═══════════════════════ */
  function showSetup(cfg) {
    // cfg.mode: 'host' | 'ai'   (joiners skip setup — the host owns the topic)
    const isAI = cfg.mode === 'ai';
    body().innerHTML = `
      <div class="dba-setup"><div class="dba-setup__in">
        <h2>${isAI ? 'Set up your solo debate' : 'Set up the room'}</h2>
        <p class="dba-setup__lead">${isAI ? 'Pick a motion and choose which side you’ll argue. The AI takes the other side.' : 'Choose the motion now, or generate one. Your friends will see it when they join.'}</p>

        <div class="dba-topicrow">
          <input class="dba-input" id="dbaTopic" placeholder="Type a debate motion… e.g. Social media does more harm than good">
          <button class="dba-btn dba-btn--amber" id="dbaTopicAI">✨ AI topic</button>
        </div>

        ${isAI ? `
        <div class="dba-sidepick">
          <button class="dba-side dba-side--for sel" id="dbaSideFor" data-side="FOR"><b>👍 I argue FOR</b><span>You support the motion</span></button>
          <button class="dba-side dba-side--against" id="dbaSideAgainst" data-side="AGAINST"><b>👎 I argue AGAINST</b><span>You oppose the motion</span></button>
        </div>` : ''}

        <div class="dba-setup__ai">
          <button class="dba-btn dba-btn--go" id="dbaBegin">${isAI ? '🎤 Begin the debate' : '🚀 Create room & continue'}</button>
        </div>
        <div class="dba-status" id="dbaSetupStatus"></div>
      </div></div>`;

    let side = 'FOR';
    if (isAI) {
      const setSide = (s) => {
        side = s;
        $('#dbaSideFor', root).classList.toggle('sel', s === 'FOR');
        $('#dbaSideAgainst', root).classList.toggle('sel', s === 'AGAINST');
      };
      $('#dbaSideFor', root).onclick = () => setSide('FOR');
      $('#dbaSideAgainst', root).onclick = () => setSide('AGAINST');
    }

    $('#dbaTopicAI', root).onclick = async () => {
      const btn = $('#dbaTopicAI', root); btn.disabled = true; setupStatus('Thinking of a good motion…');
      try {
        const r = await fetch('/api/debate-topic', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ level: 'school', language: 'English' }) });
        const t = await r.json();
        if (t.motion) $('#dbaTopic', root).value = t.motion;
        setupStatus('');
      } catch { setupStatus('Could not fetch one — type your own.'); }
      btn.disabled = false;
    };

    $('#dbaBegin', root).onclick = () => {
      const topic = $('#dbaTopic', root).value.trim();
      if (!topic) { setupStatus('Give the debate a motion first (or tap AI topic).'); return; }
      if (isAI) startSoloDebate({ ...cfg, topic, userSide: side });
      else hostRoom({ ...cfg, topic });
    };
  }
  const setupStatus = (t) => { const n = $('#dbaSetupStatus', root); if (n) n.textContent = t || ''; };

  /* ═══════════════════════ ARENA scaffold ═══════════════════════ */
  function buildArena() {
    body().innerHTML = `
      <div class="dba-arena">
        <div class="dba-coord">
          <span class="dba-coord__badge"><span class="gav">🧑‍⚖️</span> Coordinator</span>
          <div class="dba-phase" id="dbaPhase"></div>
          <span class="dba-prog" id="dbaProg"></span>
          <span class="dba-coord__sp"></span>
          <span class="dba-timer" id="dbaTimer">--:--</span>
        </div>
        <div class="dba-turn" id="dbaTurn"><span class="say">Getting ready…</span></div>
        <div class="dba-stage"><div class="dba-grid" id="dbaGrid"></div></div>
        <div class="dba-dock" id="dbaDock"></div>
      </div>
      <div class="dba-results" id="dbaResults"></div>`;
    renderPhaseSteps(-1);
  }

  function renderPhaseSteps(activeIdx) {
    const wrap = $('#dbaPhase', root); if (!wrap) return;
    wrap.innerHTML = PHASES.map((p, i) =>
      `<span class="dba-phase__step ${i < activeIdx ? 'done' : ''} ${i === activeIdx ? 'active' : ''}">${p.label}</span>`).join('');
  }

  const setTurn = (html, sub) => {
    const n = $('#dbaTurn', root); if (!n) return;
    n.innerHTML = html + (sub ? ` <span class="say">${sub}</span>` : '');
  };

  function addTile(sp) {
    const grid = $('#dbaGrid', root); if (!grid) return;
    if ($('#dba-tile-' + sp.id, root)) return;
    const t = el('div', 'dba-tile ' + (sp.kind === 'ai' ? 'ai ' : '') + (sp.kind === 'me' ? 'me ' : ''));
    t.id = 'dba-tile-' + sp.id;
    const sideCls = sp.side === 'FOR' ? 'for' : 'against';
    t.innerHTML = `
      <video autoplay playsinline ${sp.kind === 'me' ? 'muted' : ''} hidden></video>
      <div class="dba-tile__ava" style="${sp.kind !== 'ai' ? `background:linear-gradient(135deg,${hue(sp.name)},${hue(sp.name + 'x')})` : ''}">${esc((sp.name || '?')[0].toUpperCase())}</div>
      <span class="dba-sidechip ${sideCls}">${sp.side}</span>
      <div class="dba-tile__tag"><b>${esc(sp.name)}${sp.kind === 'me' ? ' (you)' : ''}</b><i>${esc(sp.sub || (sp.kind === 'ai' ? 'AI' : ''))}</i></div>
      <div class="dba-tile__wave"><i></i><i></i><i></i><i></i><i></i></div>`;
    grid.appendChild(t);
    grid.dataset.n = grid.children.length;
  }
  function attachStream(id, stream, isMe) {
    const t = $('#dba-tile-' + id, root); if (!t) return;
    const v = t.querySelector('video');
    v.srcObject = stream; v.hidden = false; v.play?.().catch(() => {});
    t.querySelector('.dba-tile__ava').style.opacity = isMe ? 0 : 1;
  }
  const speakingTile = (id) => {
    root.querySelectorAll('.dba-tile').forEach(t => t.classList.remove('speaking'));
    if (id) $('#dba-tile-' + id, root)?.classList.add('speaking');
  };
  function hue(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h} 65% 48%)`; }

  /* ═══════════════════════ pausable countdown clock ═══════════════════════ */
  function makeClock() {
    let raf = 0, endAt = 0, remain = 0, paused = true, onTick = null, onDone = null;
    function loop() {
      if (paused) return;
      const left = Math.max(0, endAt - performance.now());
      remain = left;
      onTick && onTick(left);
      if (left <= 0) { paused = true; onDone && onDone(); return; }
      raf = requestAnimationFrame(loop);
    }
    return {
      start(secs, tick, done) { remain = secs * 1000; onTick = tick; onDone = done; paused = false; endAt = performance.now() + remain; cancelAnimationFrame(raf); loop(); },
      pause() { if (paused) return; paused = true; remain = Math.max(0, endAt - performance.now()); cancelAnimationFrame(raf); },
      resume() { if (!paused || remain <= 0) return; paused = false; endAt = performance.now() + remain; loop(); },
      stop() { paused = true; cancelAnimationFrame(raf); },
      get paused() { return paused; },
      get remainMs() { return remain; },
    };
  }
  const fmt = (ms) => { const s = Math.ceil(ms / 1000); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  function showTimer(ms) {
    const n = $('#dbaTimer', root); if (!n) return;
    n.textContent = fmt(ms); n.classList.toggle('low', ms <= 10000 && ms > 0);
  }

  /* ═══════════════════════ voice ═══════════════════════
   * Two ways to talk:
   *   coordCue(text)  — the COORDINATOR. Caption shows instantly and the voice plays in the
   *                     BACKGROUND; the debate never waits on it. This is the whole point:
   *                     the AI runs the show, you never sit waiting for it to finish talking.
   *   speak(text)     — awaited. Used only for a debater's actual argument and the verdict,
   *                     where the turn genuinely shouldn't advance until the voice is done. */
  // A single voice channel. Every speak() claims a fresh token; a newer speak() or a
  // stopVoice() bumps the token, so any older line aborts — before it plays if it's still
  // fetching, and after, so voices never overlap and END/STOP silences it instantly.
  let voiceSeq = 0;
  function stopVoice() {
    voiceSeq++;
    if (A && A.coordAudio) {
      const a = A.coordAudio; A.coordAudio = null;
      try { a.pause(); } catch (_) {}
      // pausing doesn't fire 'ended', so trip the handler to unblock anyone awaiting this line
      try { if (a.onended) a.onended(); a.src = ''; } catch (_) {}
    }
    try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (_) {}
  }
  // release a turn that's waiting on the mic/clock, so the master loop can unwind on end
  function releaseTurn() { if (A && A.turnResolve) { const r = A.turnResolve; A.turnResolve = null; r(); } }
  function coordCue(text, sub) {
    setTurn('🧑‍⚖️ <b>Coordinator</b>', sub || text);
    speak(text);   // fire-and-forget — do not await
  }
  async function speak(text, opts) {
    const my = ++voiceSeq;                 // claim the channel; anything older is now stale
    // silence whatever is currently talking so two lines never overlap (and release its wait)
    if (A && A.coordAudio) { const p = A.coordAudio; A.coordAudio = null; try { p.pause(); if (p.onended) p.onended(); } catch (_) {} }
    try { if (window.speechSynthesis && speechSynthesis.speaking) speechSynthesis.cancel(); } catch (_) {}
    if (!text || (opts && opts.silent)) return;
    try {
      const r = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, language: 'English' }) });
      if (my !== voiceSeq || !A) return;   // cancelled or torn down while fetching — don't play
      if (r.ok && (r.headers.get('Content-Type') || '').includes('audio')) {
        const url = URL.createObjectURL(await r.blob());
        if (my !== voiceSeq || !A) { URL.revokeObjectURL(url); return; }
        const a = new Audio(url); A.coordAudio = a;
        await new Promise((res) => { a.onended = a.onerror = () => { URL.revokeObjectURL(url); res(); }; a.play().catch(res); });
        if (A && A.coordAudio === a) A.coordAudio = null;
        return;
      }
    } catch (_) {}
    if (my !== voiceSeq) return;
    await browserSay(text);
  }
  function browserSay(text) {
    return new Promise((res) => {
      if (!window.speechSynthesis) return res();
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (A) A.coordUtter = u;
      u.onend = u.onerror = () => res();
      speechSynthesis.speak(u);
    });
  }

  /* ═══════════════════════ SOLO AI debate ═══════════════════════ */
  async function startSoloDebate(cfg) {
    const userSide = cfg.userSide || 'FOR';
    const aiSide = userSide === 'FOR' ? 'AGAINST' : 'FOR';
    A = freshArena({ mode: 'ai', topic: cfg.topic, isHost: true });
    A.me = { id: 'me', name: cfg.name, id2: cfg.id, kind: 'me', side: userSide };
    A.ai = { id: 'ai', name: 'AI Opponent', kind: 'ai', side: aiSide };
    // speaking order within a phase: the FOR side always goes first (debate convention)
    A.speakers = userSide === 'FOR' ? [A.me, A.ai] : [A.ai, A.me];

    buildArena();
    setLive(true, cfg.topic);
    addTile({ id: 'me', name: cfg.name, sub: cfg.id, kind: 'me', side: userSide });
    addTile({ id: 'ai', name: 'AI Opponent', sub: 'AI', kind: 'ai', side: aiSide });
    A.me.side = userSide; A.ai.side = aiSide;
    // relabel tiles with correct side chips
    tileSide('me', userSide); tileSide('ai', aiSide);

    await acquireMedia();      // best-effort camera+mic for the student's tile
    buildSoloDock();
    runCoordinatedDebate();
  }
  function tileSide(id, side) {
    const chip = $('#dba-tile-' + id + ' .dba-sidechip', root);
    if (chip) { chip.textContent = side; chip.className = 'dba-sidechip ' + (side === 'FOR' ? 'for' : 'against'); }
  }

  function buildSoloDock() {
    const dock = $('#dbaDock', root);
    dock.innerHTML = `
      <button class="dba-ctl" id="dbaCam" title="Camera"><svg viewBox="0 0 24 24" fill="none"><path d="M4 7h10a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V9a2 2 0 012-2z" stroke="currentColor" stroke-width="1.7"/><path d="M16 10l6-3v10l-6-3" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg><span class="dba-ctl__lbl">Camera</span></button>
      <button class="dba-pp" id="dbaPP" title="Pause / resume"><svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg></button>
      <button class="dba-micbtn" id="dbaMic" disabled><span id="dbaMicLbl">Coordinator speaking…</span></button>
      <button class="dba-end" id="dbaEnd" title="End & get the verdict">⏹ End &amp; judge</button>`;
    $('#dbaCam', root).onclick = toggleCam;
    $('#dbaPP', root).onclick = togglePause;
    $('#dbaMic', root).onclick = onMicButton;
    $('#dbaEnd', root).onclick = () => endDebate(true);
  }

  // The master loop: walk every phase × speaker, running each protected turn in order.
  // The coordinator narrates in the background — the flow never blocks on its voice.
  async function runCoordinatedDebate() {
    A.running = true;
    A.queue = [];
    PHASES.forEach((ph, pi) => A.speakers.forEach((sp) => A.queue.push({ phaseIdx: pi, sp })));
    A.qi = 0;

    coordCue(`Welcome. Today’s motion: ${A.topic}. ${A.speakers[0].name} argues ${sideWord(A.speakers[0].side)}; ${A.speakers[1].name} argues ${sideWord(A.speakers[1].side)}. Openings first.`,
      `Motion: ${A.topic}`);
    await sleep(1400);

    for (A.qi = 0; A.qi < A.queue.length; A.qi++) {
      if (!A.running) return;
      const { phaseIdx, sp } = A.queue[A.qi];
      renderPhaseSteps(phaseIdx);
      setProgress(phaseIdx, sp);
      await runTurn(phaseIdx, sp);
      if (!A.running) return;
      await sleep(350);
    }
    coordCue('That’s the final word. Judging the debate now.');
    endDebate(false);
  }

  const sideWord = (s) => (s === 'FOR' ? 'in favour' : 'against');

  async function runTurn(phaseIdx, sp) {
    const ph = PHASES[phaseIdx];
    A.curPhase = ph;
    speakingTile(sp.id);
    if (sp.kind === 'ai') return runAITurn(phaseIdx, sp);

    // ── human turn: no waiting. The cue is spoken in the background while a short 3-2-1
    //    lead-in runs, then the mic arms itself automatically. Tap to start early / to end. ──
    coordCue(`${sp.name}, your ${ph.say}. ${ph.secs} seconds — speak now.`);
    await new Promise((resolve) => {
      A.turnResolve = resolve;
      leadInThenRecord(ph);              // fire-and-forget lead-in → auto-record
    });
    A.awaitingMic = false;
    speakingTile(null);
  }

  // 3-2-1 get-ready, then the recorder starts on its own. Tapping "Speak now" skips ahead.
  async function leadInThenRecord(ph) {
    A.awaitingMic = true;
    micBtn(true, '🎤 Speak now', false, true);
    for (let n = 3; n > 0; n--) {
      if (!A || !A.running || A.recording) return;
      while (A && A.paused) { await sleep(120); if (!A || !A.running) return; }
      setTurn(`🎙 <b>Your ${ph.label.toLowerCase()}</b>`, `Get ready… ${n}`);
      pulseRing(n);
      await sleep(780);
    }
    if (A && A.running && !A.recording) startRecording();
  }

  // Mic button: before recording it starts you now (skips the countdown); during, it ends the turn.
  function onMicButton() {
    if (!A || !A.awaitingMic) return;
    if (!A.recording) startRecording();
    else finishHumanTurn();
  }

  function startRecording() {
    const ph = A.curPhase || PHASES[0];
    A.recording = true;
    A.chunks = [];
    try {
      const audio = A.localStream && A.localStream.getAudioTracks().length
        ? new MediaStream(A.localStream.getAudioTracks()) : null;
      if (audio && window.MediaRecorder) {
        A.rec = new MediaRecorder(audio, { mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '' });
        A.rec.ondataavailable = (e) => { if (e.data && e.data.size) A.chunks.push(e.data); };
        A.rec.start();
      }
    } catch (_) { A.rec = null; }
    setTurn('🔴 <b>You’re live</b>', `${ph.label} · make your case — tap Done when finished.`);
    micBtn(true, '⏹ Done — pass on', true);
    A.clock.start(ph.secs, showTimer, () => finishHumanTurn());
  }

  async function finishHumanTurn() {
    if (!A || !A.recording) { if (A && A.turnResolve) { const r = A.turnResolve; A.turnResolve = null; r(); } return; }
    A.recording = false;
    A.clock.stop(); showTimer(0);
    micBtn(false, 'Got it ✓');
    const text = await stopAndTranscribe();
    const ph = A.curPhase || PHASES[0];
    A.me.speech = A.me.speech || {};
    A.me.speech[ph.key] = text;
    A.history.push({ speaker: A.me.name, text: text || `(${ph.label} — no clear speech captured)`, phase: ph.key });
    micBtn(false, A.mode === 'room' ? 'Waiting for your next turn…' : '');
    if (A.turnResolve) { const r = A.turnResolve; A.turnResolve = null; r(); }
  }

  function stopAndTranscribe() {
    return new Promise((resolve) => {
      const rec = A.rec;
      const done = async () => {
        try {
          const blob = new Blob(A.chunks || [], { type: 'audio/webm' });
          if (blob.size < 1200) return resolve('');
          const fd = new FormData();
          fd.append('audio', blob, 'debate.webm');
          fd.append('context', A.topic || '');   // motion as vocabulary hint for Whisper
          const r = await fetch('/api/stt', { method: 'POST', body: fd });
          const d = await r.json();
          resolve((d.text || '').trim());
        } catch { resolve(''); }
        A.rec = null;
      };
      if (rec && rec.state !== 'inactive') { rec.onstop = done; try { rec.stop(); } catch { done(); } }
      else done();
    });
  }

  async function runAITurn(phaseIdx, sp) {
    const ph = PHASES[phaseIdx];
    showTimer(0);
    setTurn(`🤖 <b>${esc(sp.name)}</b> is thinking…`, `${ph.label} · arguing ${sideWord(sp.side)}`);
    $('#dba-tile-' + sp.id, root)?.classList.add('thinking');
    let reply = '';
    try {
      const r = await fetch('/api/ai-debate-reply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: A.topic, history: A.history, userSpeech: lastHumanText(),
          phase: ph.key, aiSide: sp.side, userSide: A.me.side, language: 'English',
        }),
      });
      const d = await r.json();
      reply = (d.reply || '').trim();
    } catch (_) {}
    if (!reply) reply = phaseIdx === 0
      ? `I stand ${sideWord(sp.side)} this motion, and the evidence is firmly on my side.`
      : `You make a point, but it doesn’t hold up — the stronger case remains ${sideWord(sp.side)} the motion.`;

    sp.speech = sp.speech || {};
    sp.speech[ph.key] = reply;
    A.history.push({ speaker: sp.name, text: reply, phase: ph.key });
    $('#dba-tile-' + sp.id, root)?.classList.remove('thinking');
    setTurn(`🤖 <b>${esc(sp.name)}</b> — ${ph.label}`, reply);
    await speak(reply);        // the opponent's OWN voice reads its argument — we wait for it
    speakingTile(null);
  }
  const lastHumanText = () => { for (let i = A.history.length - 1; i >= 0; i--) if (A.history[i].speaker === A.me.name) return A.history[i].text; return ''; };

  /* ═══════════════════════ pause / resume ═══════════════════════ */
  function togglePause() {
    if (!A) return;
    A.paused = !A.paused;
    const btn = $('#dbaPP', root);
    if (A.paused) {
      A.clock.pause();
      if (A.coordAudio) try { A.coordAudio.pause(); } catch (_) {}
      if (window.speechSynthesis && speechSynthesis.speaking) speechSynthesis.pause();
      if (A.rec && A.rec.state === 'recording') try { A.rec.pause(); } catch (_) {}
      btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';
      setTurn('⏸ <b>Paused</b>', 'Tap play to resume the debate.');
    } else {
      A.clock.resume();
      if (A.coordAudio) try { A.coordAudio.play(); } catch (_) {}
      if (window.speechSynthesis && speechSynthesis.paused) speechSynthesis.resume();
      if (A.rec && A.rec.state === 'paused') try { A.rec.resume(); } catch (_) {}
      btn.innerHTML = '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg>';
    }
  }

  /* ═══════════════════════ media (camera/mic) ═══════════════════════ */
  async function acquireMedia() {
    try {
      A.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      attachStream(A.me.id, A.localStream, true);
    } catch (_) {
      try { A.localStream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (__) { A.localStream = null; }
    }
    startMicMeter();
  }

  /* ── live mic level → drives the speaking tile's glow + waveform + the record button.
        This is what makes it feel alive: the UI reacts to your actual voice in real time. ── */
  function startMicMeter() {
    stopMicMeter();
    try {
      if (!A.localStream || !A.localStream.getAudioTracks().length) return;
      const ac = A.meterCtx = new (window.AudioContext || window.webkitAudioContext)();
      const src = ac.createMediaStreamSource(A.localStream);
      const an = ac.createAnalyser(); an.fftSize = 256; src.connect(an);
      const buf = new Uint8Array(an.frequencyBinCount);
      const loop = () => {
        if (!A || !A.meterCtx) return;
        an.getByteFrequencyData(buf);
        let sum = 0; for (const v of buf) sum += v;
        const lvl = A.recording ? Math.min(1, (sum / buf.length) / 78) : 0;
        if (root) root.style.setProperty('--dba-lvl', lvl.toFixed(3));
        A.meterRaf = requestAnimationFrame(loop);
      };
      loop();
    } catch (_) {}
  }
  function stopMicMeter() {
    if (!A) return;
    if (A.meterRaf) cancelAnimationFrame(A.meterRaf);
    if (A.meterCtx) { try { A.meterCtx.close(); } catch (_) {} A.meterCtx = null; }
  }

  /* round/turn progress chip in the coordinator strip */
  function setProgress(phaseIdx, sp) {
    const n = $('#dbaProg', root); if (!n) return;
    const total = A.speakers.length;
    const idxInPhase = A.speakers.indexOf(sp) + 1;
    n.textContent = `Round ${phaseIdx + 1}/${PHASES.length} · ${PHASES[phaseIdx].label} · Speaker ${idxInPhase}/${total}`;
  }
  function pulseRing(n) {
    const t = $('#dbaTimer', root); if (!t) return;
    t.textContent = String(n);
    t.classList.add('ready'); setTimeout(() => t.classList.remove('ready'), 500);
  }
  function toggleCam() {
    const track = A.localStream && A.localStream.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    $('#dbaCam', root).classList.toggle('off', !track.enabled);
    const v = $('#dba-tile-me video', root), ava = $('#dba-tile-me .dba-tile__ava', root);
    if (v) v.hidden = !track.enabled;
    if (ava) ava.style.opacity = track.enabled ? 0 : 1;
  }
  function micBtn(enabled, label, recording, ready) {
    const b = $('#dbaMic', root), l = $('#dbaMicLbl', root);
    if (!b) return;
    b.disabled = !enabled;
    b.classList.toggle('rec', !!recording);
    b.classList.toggle('ready', !!ready);
    if (l) l.textContent = label;
  }

  /* ═══════════════════════ end + judge ═══════════════════════ */
  async function endDebate(early) {
    if (!A || A.judged) return;
    A.judged = true; A.running = false; A.awaitingMic = false;
    A.clock && A.clock.stop();
    stopVoice();                 // cut the coordinator off the instant the debate ends
    releaseTurn();               // let the master loop unwind if it was mid-turn
    if (A.rec && A.rec.state === 'recording') { try { A.recording = false; await stopAndTranscribe(); } catch (_) {} }
    speakingTile(null);
    setTurn('🧑‍⚖️ <b>Coordinator</b>', early ? 'Wrapping up early — judging what we have…' : 'Judging the debate…');
    micBtn(false, 'Debate ended');

    const speakers = A.speakers.map((sp) => ({
      name: sp.name, id: sp.id2 || sp.id || '', side: sp.side,
      transcript: Object.values(sp.speech || {}).join(' \n '),
    })).filter(s => s.transcript.trim());

    if (!speakers.length) {
      showResults({ winner: '', winnerReason: 'No speech was captured to judge — try again and speak after the coordinator cues you.', speakers: [], advice: '' });
      return;
    }
    try {
      const r = await fetch('/api/debate-analyse', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: A.topic, speakers, language: 'Auto' }),
      });
      const d = await r.json();
      if (d.report) showResults(d.report);
      else showResults({ winner: '', winnerReason: 'The judge could not score this one: ' + (d.error || 'unknown'), speakers: [], advice: '' });
    } catch (e) {
      showResults({ winner: '', winnerReason: 'Scoring failed: ' + (e.message || e), speakers: [], advice: '' });
    }
  }

  function showResults(report) {
    const box = $('#dbaResults', root);
    $('.dba-arena', root)?.style.setProperty('display', 'none');
    box.classList.add('show');
    const winner = (report.winner || '').trim();
    const cards = (report.speakers || []).map((s) => {
      const win = winner && s.name && s.name.trim().toLowerCase() === winner.toLowerCase();
      return `<div class="dba-scard ${win ? 'win' : ''}">
        <div class="dba-scard__top"><b>${esc(s.name)}</b>${win ? '<span class="dba-badge">🏆 Winner</span>' : ''}<span class="dba-scard__score">${s.score}<i>/100</i></span></div>
        <div class="dba-scard__bar"><i style="width:${Math.max(4, Math.min(100, s.score))}%"></i></div>
        ${s.strength ? `<div class="dba-strength"><b>Biggest strength:</b> ${esc(s.strength)}</div>` : ''}
        ${listBlock('Key points made', s.keyPoints, 'key')}
        ${listBlock('What worked', s.positives, 'pos')}
        ${listBlock('To improve', s.negatives, 'neg')}
        ${s.realWorld ? `<div class="dba-real"><b>Real-world check</b>${esc(s.realWorld)}</div>` : ''}
      </div>`;
    }).join('');
    box.innerHTML = `<div class="dba-results__in">
      <div class="dba-verdict">
        <div class="cup">🏆</div>
        <h2>${winner ? esc(winner) + ' takes it' : 'Debate complete'}</h2>
        <p>${esc(report.winnerReason || '')}</p>
        ${A && A.topic ? `<span class="dba-verdict__topic">Motion: ${esc(A.topic)}</span>` : ''}
      </div>
      <div class="dba-scards">${cards}</div>
      ${report.advice ? `<div class="dba-advice"><b>Coach’s tip.</b> ${esc(report.advice)}</div>` : ''}
      <div class="dba-results__foot">
        <button class="dba-btn dba-btn--primary" id="dbaAgain">↻ New debate</button>
        <button class="dba-btn" id="dbaDone">Done</button>
      </div>
    </div>`;
    $('#dbaAgain', root).onclick = () => { box.classList.remove('show'); showEntry(); };
    $('#dbaDone', root).onclick = close;
    if (winner) speak(`And the win goes to ${winner}. ${report.winnerReason || ''}`);
  }

  function listBlock(title, arr, cls) {
    if (!Array.isArray(arr) || !arr.length) return '';
    return `<div class="dba-list dba-list--${cls}"><span>${title}</span><ul>${arr.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
  }

  /* ═══════════════════════ MULTI-PEER (create / join) ═══════════════════════
   * Reuses the same peer-to-peer video mesh the old room used (PeerJS + Google STUN,
   * no server, no keys). The HOST runs the coordinator and broadcasts the current turn;
   * each peer records their own slot locally and returns a transcript at the end. */
  function hostRoom(cfg) {
    const code = 'DEBATE-' + Math.floor(1000 + Math.random() * 9000);
    enterRoom({ ...cfg, code, isHost: true });
  }
  function joinRoom(cfg) {
    if (typeof Peer === 'undefined') { entryStatus('Live rooms need a network connection — try “Debate the AI” instead.'); return; }
    enterRoom({ ...cfg, isHost: false });
  }

  async function enterRoom(cfg) {
    A = freshArena({ mode: 'room', topic: cfg.topic || '', isHost: cfg.isHost });
    A.code = cfg.code || cfg.code;
    A.me = { id: cfg.isHost ? hostId(cfg.code) : 'me', name: cfg.name, id2: cfg.id, kind: 'me', side: cfg.isHost ? 'FOR' : 'AGAINST' };
    buildArena();
    buildRoomDock();
    setLive(true, cfg.topic, A.code);
    addTile({ id: A.me.id, name: cfg.name, sub: cfg.id, kind: 'me', side: A.me.side });
    tileSide(A.me.id, A.me.side);
    await acquireMedia();
    if (A.localStream) attachStream(A.me.id, A.localStream, true);

    if (typeof Peer === 'undefined') { setTurn('⚠ <b>Offline</b>', 'Live rooms need PeerJS — use Debate the AI instead.'); return; }
    setTurn('🧑‍⚖️ <b>Coordinator</b>', cfg.isHost ? `Room ${A.code} is open. Share the code; press ▶ when everyone’s in.` : 'Connecting to the room…');
    setupPeer(cfg);
  }

  function buildRoomDock() {
    const dock = $('#dbaDock', root);
    dock.innerHTML = `
      <button class="dba-ctl" id="dbaCam" title="Camera"><svg viewBox="0 0 24 24" fill="none"><path d="M4 7h10a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V9a2 2 0 012-2z" stroke="currentColor" stroke-width="1.7"/><path d="M16 10l6-3v10l-6-3" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg><span class="dba-ctl__lbl">Camera</span></button>
      <button class="dba-ctl" id="dbaMicToggle" title="Mute"><svg viewBox="0 0 24 24" fill="none"><rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" stroke-width="1.7"/><path d="M5 11a7 7 0 0014 0M12 18v3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg><span class="dba-ctl__lbl">Mic</span></button>
      <button class="dba-pp" id="dbaStart" title="Start the debate" ${A.isHost ? '' : 'hidden'}><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg></button>
      <button class="dba-micbtn" id="dbaMic" disabled><span id="dbaMicLbl">Waiting for the coordinator…</span></button>
      <button class="dba-end" id="dbaEnd" title="End & judge" ${A.isHost ? '' : 'hidden'}>⏹ End &amp; judge</button>`;
    $('#dbaCam', root).onclick = toggleCam;
    $('#dbaMicToggle', root).onclick = () => {
      const tr = A.localStream && A.localStream.getAudioTracks()[0]; if (!tr) return;
      tr.enabled = !tr.enabled; $('#dbaMicToggle', root).classList.toggle('off', !tr.enabled);
    };
    $('#dbaMic', root).onclick = onMicButton;
    if (A.isHost) {
      $('#dbaStart', root).onclick = () => { $('#dbaStart', root).setAttribute('hidden', ''); broadcast({ t: 'begin' }); runRoomDebate(); };
      $('#dbaEnd', root).onclick = () => { broadcast({ t: 'end' }); endRoomDebate(); };
    }
  }

  // Host coordinator over the mesh: same phase/turn structure, but turns belong to peers.
  async function runRoomDebate() {
    A.running = true;
    const order = [...A.roster.values()];       // {peerId,name,id,side}
    A.queue = [];
    PHASES.forEach((ph, pi) => order.forEach((p) => A.queue.push({ phaseIdx: pi, peerId: p.peerId })));
    coordCue(`Welcome. Today’s motion: ${A.topic || 'to be decided'}. Rounds: openings, rebuttals, closings. Everyone gets an equal, protected turn.`, `Motion: ${A.topic || '—'}`);
    await sleep(1500);
    for (A.qi = 0; A.qi < A.queue.length; A.qi++) {
      if (!A.running) return;
      const { phaseIdx, peerId } = A.queue[A.qi];
      const p = A.roster.get(peerId); if (!p) continue;
      renderPhaseSteps(phaseIdx);
      const ph = PHASES[phaseIdx];
      speakingTile(peerId);
      coordCue(`${p.name}, your ${ph.say}. ${ph.secs} seconds.`);
      broadcast({ t: 'turn', peerId, phase: ph.key, secs: ph.secs, label: ph.label });
      applyTurn({ peerId, phase: ph.key, secs: ph.secs, label: ph.label });   // host applies locally too
      await waitTurn(ph.secs);
      broadcast({ t: 'turnEnd', peerId });
      speakingTile(null);
      await sleep(300);
    }
    coordCue('That’s every round. Collecting speeches and judging now.');
    endRoomDebate();
  }

  function waitTurn(secs) {
    return new Promise((resolve) => {
      A.turnResolve = resolve;
      A.clock.start(secs, showTimer, () => { if (A.turnResolve) { const r = A.turnResolve; A.turnResolve = null; r(); } });
    });
  }

  // A turn was assigned (host or via broadcast): if it's MINE, let me record.
  function applyTurn(msg) {
    renderPhaseStepsByKey(msg.phase);
    speakingTile(msg.peerId);
    A.curPhase = { key: msg.phase, label: msg.label, secs: msg.secs, say: msg.label.toLowerCase() };
    const mine = msg.peerId === A.me.id;
    if (mine) {
      A.awaitingMic = true;
      setTurn('🎙 <b>Your turn</b>', `${msg.label} — tap the mic and make your case.`);
      micBtn(true, `🎤 Start ${msg.label.toLowerCase()}`);
      showTimer(msg.secs * 1000);
    } else {
      A.awaitingMic = false;
      micBtn(false, `${A.roster.get(msg.peerId)?.name || 'Speaker'} has the floor`);
      setTurn(`🎙 <b>${esc(A.roster.get(msg.peerId)?.name || 'Speaker')}</b>`, `${msg.label} · ${sideWord(A.roster.get(msg.peerId)?.side || 'FOR')}`);
    }
  }
  function renderPhaseStepsByKey(key) { const i = PHASES.findIndex(p => p.key === key); renderPhaseSteps(i); }

  async function endRoomDebate() {
    if (!A || A.judged) return;
    A.judged = true; A.running = false; A.awaitingMic = false; A.clock.stop();
    stopVoice();                 // silence the coordinator on end
    releaseTurn();
    setTurn('🧑‍⚖️ <b>Coordinator</b>', 'Gathering everyone’s speeches…');
    // host collects transcripts (peers send theirs on 'end'); give them a moment
    if (A.isHost) {
      A.pendingAnalyse = setTimeout(() => runRoomAnalysis(), 9000);
    }
    // if I'm mid-recording, capture that last slot too
    if (A.recording) { try { await finishHumanTurn(); } catch (_) {} }
    // my transcript = everything I said across my protected turns
    const text = Object.values((A.me && A.me.speech) || {}).join(' \n ').trim();
    if (A.isHost) A.transcripts.set(A.me.id, { name: A.me.name, id: A.me.id2, side: A.me.side, transcript: text });
    else if (A.hostConn && A.hostConn.open) { try { A.hostConn.send({ t: 'transcript', peerId: A.me.id, name: A.me.name, id: A.me.id2, side: A.me.side, text }); } catch (_) {} }
    if (A.isHost) maybeRoomAnalyse();
  }
  function maybeRoomAnalyse() {
    if (!A.isHost || A.analysed) return;
    if (A.transcripts.size >= A.roster.size) runRoomAnalysis();
  }
  async function runRoomAnalysis() {
    if (!A || A.analysed) return; A.analysed = true;
    if (A.pendingAnalyse) clearTimeout(A.pendingAnalyse);
    const speakers = [...A.transcripts.values()].filter(s => (s.transcript || '').trim());
    if (!speakers.length) { showResults({ winner: '', winnerReason: 'No speeches were captured.', speakers: [] }); return; }
    try {
      const r = await fetch('/api/debate-analyse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic: A.topic, speakers, language: 'Auto' }) });
      const d = await r.json();
      if (d.report) { broadcast({ t: 'result', report: d.report }); showResults(d.report); }
    } catch (e) { showResults({ winner: '', winnerReason: 'Scoring failed: ' + (e.message || e), speakers: [] }); }
  }

  /* ── PeerJS plumbing (mesh + host relay) ── */
  const sani = (s) => (s || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  const hostId = (code) => 'dbahub' + sani(code);

  function setupPeer(cfg) {
    let peer;
    try {
      peer = new Peer(cfg.isHost ? hostId(cfg.code) : undefined, {
        config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478' }] },
      });
    } catch (e) { setTurn('⚠ <b>Network error</b>', 'Could not open a room.'); return; }
    A.peer = peer;
    peer.on('open', (realId) => {
      if (!cfg.isHost) { A.me.id = realId; const t = $('#dba-tile-me', root); if (t) t.id = 'dba-tile-' + realId; }
      A.roster.set(A.me.id, { peerId: A.me.id, name: A.me.name, id: A.me.id2, side: A.me.side });
      if (cfg.isHost) { peer.on('connection', onData); peer.on('call', onCall); }
      else { peer.on('call', onCall); connectHost(cfg.code); }
    });
    peer.on('error', (err) => {
      if (err.type === 'peer-unavailable') setTurn('⚠ <b>Room not found</b>', 'Double-check the code with the host.');
      else if (err.type === 'unavailable-id') { try { peer.destroy(); } catch (_) {} joinRoom({ code: cfg.code, name: cfg.name, id: cfg.id }); }
      else setTurn('⚠ <b>Connection issue</b>', err.type);
    });
  }
  function connectHost(code) {
    const conn = A.peer.connect(hostId(code), { reliable: true, metadata: { name: A.me.name, id: A.me.id2 } });
    A.hostConn = conn;
    conn.on('open', () => { conn.send({ t: 'hello', peerId: A.me.id, name: A.me.name, id: A.me.id2, side: A.me.side }); setTurn('🧑‍⚖️ <b>Coordinator</b>', 'Connected. Waiting for the host to start.'); });
    conn.on('data', (m) => handle(m, conn));
    conn.on('close', () => setTurn('⚠ <b>Host left</b>', 'The room was closed.'));
  }
  function onData(conn) {
    conn.on('open', () => {
      A.dataConns.set(conn.peer, conn);
      conn.send({ t: 'roster', peers: [...A.roster.values()] });
      if (A.topic) conn.send({ t: 'topic', topic: A.topic });
    });
    conn.on('data', (m) => handle(m, conn));
    conn.on('close', () => { A.dataConns.delete(conn.peer); dropPeer(conn.peer); });
  }
  function onCall(call) { call.answer(A.localStream || undefined); wireCall(call, call.peer); }
  function wireCall(call, id) {
    A.calls.set(id, call);
    call.on('stream', (stream) => { A.streams.set(id, stream); const info = A.roster.get(id) || {}; ensureTile(id, info); attachStream(id, stream, false); });
    call.on('close', () => dropPeer(id));
  }
  function callPeer(id) {
    if (!A.peer || id === A.me.id || A.calls.has(id)) return;
    if (A.me.id < id) { const call = A.peer.call(id, A.localStream || undefined, { metadata: { name: A.me.name } }); if (call) wireCall(call, id); }
  }
  function handle(m, conn) {
    if (!A) return;
    if (m.t === 'hello') {   // host only
      A.roster.set(m.peerId, { peerId: m.peerId, name: m.name, id: m.id, side: m.side || 'AGAINST' });
      ensureTile(m.peerId, A.roster.get(m.peerId));
      broadcast({ t: 'roster', peers: [...A.roster.values()] });
      callPeer(m.peerId);
      return;
    }
    apply(m);
    if (A.isHost && conn) for (const [pid, c] of A.dataConns) if (pid !== conn.peer) { try { c.send(m); } catch (_) {} }
  }
  function apply(m) {
    switch (m.t) {
      case 'roster': for (const p of m.peers) { if (!A.roster.has(p.peerId)) A.roster.set(p.peerId, p); ensureTile(p.peerId, p); if (p.peerId !== A.me.id) callPeer(p.peerId); } break;
      case 'topic': A.topic = m.topic; setLive(true, m.topic, A.code); break;
      case 'begin': setTurn('🧑‍⚖️ <b>Coordinator</b>', 'The debate is starting…'); break;
      case 'turn': applyTurn(m); break;
      case 'turnEnd': speakingTile(null); if (m.peerId === A.me.id) { A.awaitingMic = false; if (A.recording) finishHumanTurn(); else micBtn(false, 'Waiting for your next turn…'); } break;
      case 'transcript': if (A.isHost) { A.transcripts.set(m.peerId, { name: m.name, id: m.id, side: m.side, transcript: m.text }); maybeRoomAnalyse(); } break;
      case 'end': endRoomDebate(); break;
      case 'result': showResults(m.report); break;
    }
  }
  function ensureTile(id, info) { if (!$('#dba-tile-' + id, root)) { addTile({ id, name: info.name || 'Guest', sub: info.id, kind: 'peer', side: info.side || 'AGAINST' }); tileSide(id, info.side || 'AGAINST'); } }
  function dropPeer(id) { A.calls.delete(id); A.streams.delete(id); A.roster.delete(id); A.dataConns.delete(id); $('#dba-tile-' + id, root)?.remove(); const g = $('#dbaGrid', root); if (g) g.dataset.n = g.children.length; }
  function broadcast(m) { if (!A) return; if (A.isHost) { for (const [, c] of A.dataConns) { try { c.send(m); } catch (_) {} } } else if (A.hostConn && A.hostConn.open) { try { A.hostConn.send(m); } catch (_) {} } }

  /* ═══════════════════════ shared helpers ═══════════════════════ */
  function freshArena(base) {
    return Object.assign({
      running: false, paused: false, judged: false, analysed: false,
      topic: '', history: [], speakers: [], queue: [], qi: 0,
      clock: makeClock(),
      localStream: null, rec: null, chunks: [], recording: false, awaitingMic: false,
      // room
      peer: null, hostConn: null, dataConns: new Map(), calls: new Map(), streams: new Map(),
      roster: new Map(), transcripts: new Map(),
    }, base || {});
  }

  function setLive(on, topic, code) {
    const live = $('#dbaLive', root), c = $('#dbaCode', root);
    if (live) live.hidden = !on;
    if (c) { c.hidden = !(on && code); if (code) c.textContent = '🔑 ' + code; }
  }

  function teardownDebate() {
    if (!A) return;
    try { stopVoice(); } catch (_) {}
    try { stopMicMeter(); } catch (_) {}
    try { A.clock && A.clock.stop(); } catch (_) {}
    try { if (A.rec && A.rec.state !== 'inactive') A.rec.stop(); } catch (_) {}
    try { if (A.coordAudio) A.coordAudio.pause(); } catch (_) {}
    try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (_) {}
    try { A.localStream && A.localStream.getTracks().forEach(t => t.stop()); } catch (_) {}
    try { for (const [, c] of A.calls) c.close(); } catch (_) {}
    try { for (const [, c] of A.dataConns) c.close(); } catch (_) {}
    try { A.hostConn && A.hostConn.close(); } catch (_) {}
    try { A.peer && A.peer.destroy(); } catch (_) {}
    if (A.pendingAnalyse) clearTimeout(A.pendingAnalyse);
    A = null;
    if (onKey.handler) document.removeEventListener('keydown', onKey.handler);
  }

  window.DebateArena = { open, close, isOpen };
})();
