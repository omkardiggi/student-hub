/* classroom.js — Omkar Hub · Immersive AI Teacher classroom overlay.
 *
 * A premium fullscreen classroom that opens OVER the dashboard (never navigates away).
 * It reuses everything the site already has:
 *   • the lesson object from generateLesson()  (slides[] + narration[])
 *   • the global slideHTML() renderer from app.js  (no duplicate slide code)
 *   • the /api/tts neural voice endpoint          (same voice as the dashboard tutor)
 *   • /api/deck-file (.pptx) and /api/practice (quiz)
 * and adds a realistic animated teacher with real audio-driven lip-sync.
 *
 * The teacher is progressively enhanced: a always-works SVG professor is the base,
 * and ./teacher3d.js (Three.js + Ready Player Me GLB) upgrades it when WebGL is available.
 *
 * Public API:  window.OmkarClassroom.open(lesson, language)   /  .close()  /  .isOpen()
 */
(function () {
  'use strict';

  const $ = (id) => (root ? root.querySelector('#' + id) : document.getElementById(id));
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  const LANG = (typeof LANG_CODE !== 'undefined') ? LANG_CODE
    : { English: 'en-US', Hindi: 'hi-IN', Kannada: 'kn-IN', Hinglish: 'hi-IN', Kanglish: 'kn-IN', Auto: 'en-US' };
  // "Kannada (North Karnataka)" is a dialect of Kannada — strip the variant for BCP-47 lookup
  const baseLang = (l) => String(l || '').replace(/\s*\(.*?\)\s*$/, '').trim();
  const codeOf = (l) => LANG[l] || LANG[baseLang(l)] || 'en-US';

  // ───────── state ─────────
  let root = null;               // overlay element
  let lesson = null, lang = 'English';   // what the TEACHER speaks
  let notesLang = 'English';             // what the SLIDES are written in
  let slides = [], narration = [];
  let idx = 0;
  let playing = false, paused = false, rate = 1;
  let teacher = null;            // active teacher interface (svg or 3d)
  let audioCtx = null, analyser = null, lipBuf = null, freqBuf = null, rafId = 0;
  let vOpen = 0, vRound = 0, vWide = 0;   // smoothed viseme envelopes
  let curAudio = null;           // current HTMLAudioElement
  let fakeMouth = 0;             // fallback lip driver
  let extras = null;             // cached wrap-up material
  let script = null;             // funny teaching script: { greeting, lines[], outro }
  let scriptPromise = null;
  let recog = null, recording = false;
  let opened = false;
  let clockTimer = 0;            // live wall-clock updater
  /* Bumped every time speech is stopped or replaced. speak() captures it before awaiting
     the TTS fetch and checks it again after: if it changed while the audio was downloading,
     that clip is stale and must never play. Without this, tapping Ask silences the current
     line but the NEXT one starts talking the moment its fetch lands. */
  let speechEpoch = 0;

  /* ═════════════════════════ open / close ═════════════════════════ */
  async function open(lessonObj, language, notesLanguage) {
    if (opened) close();
    if (!lessonObj || !Array.isArray(lessonObj.slides) || !lessonObj.slides.length) {
      alert('This lesson has no slides to teach.'); return;
    }
    lesson = lessonObj;
    lang = language || lesson.language || 'English';
    notesLang = notesLanguage || lesson.language || lang;
    slides = lesson.slides;
    narration = lesson.narration && lesson.narration.length ? lesson.narration : slides.map(s => s.heading || '');
    idx = 0; playing = false; paused = false; rate = 1; extras = null;
    script = null; scriptPromise = null;

    // stop the dashboard tutor so the two voices never overlap
    if (typeof stopNarration === 'function') { try { stopNarration(); } catch (_) {} }
    // keep app.js's slideHTML() happy (it reads the global currentLesson.subject)
    if (typeof window.currentLesson === 'undefined' || !window.currentLesson) window.currentLesson = lesson;

    buildDom();
    startClock();
    document.body.style.overflow = 'hidden';
    opened = true;
    try { ensureAudioCtx(); } catch (_) {}
    requestAnimationFrame(() => root.classList.add('is-open'));

    // start writing the funny script straight away — it runs while the avatar loads
    fetchScript();
    // SVG teacher is instant + reliable; the board renders immediately…
    teacher = createSvgTeacher($('clsTeacher'));
    showSlide(0, true);
    // …then quietly try to upgrade to the 3D avatar in the background (never blocks class).
    upgradeTo3D();
    // auto-start after the open animation + a warm greeting
    setTimeout(() => greetAndStart(), 650);
  }

  /* live wall clock — matches the photo; ticks in real time while the class is open */
  function startClock() {
    const H = $('clsClockH'), M = $('clsClockM'), S = $('clsClockS');
    if (!H || !M || !S) return;
    const tick = () => {
      const d = new Date();
      const s = d.getSeconds(), m = d.getMinutes(), h = d.getHours() % 12;
      S.setAttribute('transform', `rotate(${s * 6} 50 50)`);
      M.setAttribute('transform', `rotate(${m * 6 + s * 0.1} 50 50)`);
      H.setAttribute('transform', `rotate(${h * 30 + m * 0.5} 50 50)`);
    };
    tick();
    clearInterval(clockTimer);
    clockTimer = setInterval(tick, 1000);
  }

  function close() {
    stopSpeaking();
    if (clockTimer) { clearInterval(clockTimer); clockTimer = 0; }
    playing = false; paused = false;
    if (rafId) cancelAnimationFrame(rafId), rafId = 0;
    if (teacher && teacher.dispose) { try { teacher.dispose(); } catch (_) {} }
    teacher = null;
    if (recording) { try { stopMic(); } catch (_) {} }
    releaseMic();          // never leave the mic light on after the class closes
    recording = false;
    if (audioCtx) { try { audioCtx.close(); } catch (_) {} audioCtx = null; analyser = null; }
    document.body.style.overflow = '';
    window.removeEventListener('resize', onResize);
    document.removeEventListener('keydown', onKey);
    if (root) {
      root.classList.remove('is-open');
      const r = root;
      root = null;
      setTimeout(() => { if (r && r.parentNode) r.remove(); }, 350);
    }
    opened = false;
  }

  const isOpen = () => opened;

  /* ═════════════════════════ DOM ═════════════════════════ */
  function buildDom() {
    // Purge any existing or lingering classroom modals immediately to prevent duplicate IDs
    document.querySelectorAll('.cls').forEach(m => m.remove());
    root = el('div', 'cls');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'AI Teacher classroom');
    root.innerHTML = `
      <div class="cls__top">
        <span class="cls__brand"><span class="brand__mark"><svg viewBox="0 0 24 24" fill="none"><path d="M12 3v18M3 12h18" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg></span></span>
        <div class="cls__ttl"><b id="clsTtl"></b><span>AI Teacher · live class</span></div>
        <div class="cls__top-sp"></div>
        <span class="cls__chip"><i></i> Live lesson</span>
        <button class="cls__x" id="clsX" title="Exit classroom (Esc)"><svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button>
      </div>

      <div class="cls__stage" id="clsStage">
        <!-- ── the rendered classroom, behind everything ── -->
        <div class="cls__room" aria-hidden="true">
          <div class="cls__wall"></div>
          <div class="cls__lockers"></div>
          <div class="cls__cork">
            <span class="cls__note cls__note--a"></span>
            <span class="cls__note cls__note--b"></span>
            <span class="cls__note cls__note--c"></span>
          </div>
          <div class="cls__clock">
            <svg viewBox="0 0 100 100">
              <circle class="cls__clock-rim" cx="50" cy="50" r="47"/>
              <circle class="cls__clock-face" cx="50" cy="50" r="43"/>
              ${Array.from({ length: 12 }, (_, i) => {
                const a = (i / 12) * Math.PI * 2, maj = i % 3 === 0;
                const r0 = maj ? 33 : 37, r1 = 40;
                const x1 = (50 + Math.sin(a) * r0).toFixed(1), y1 = (50 - Math.cos(a) * r0).toFixed(1);
                const x2 = (50 + Math.sin(a) * r1).toFixed(1), y2 = (50 - Math.cos(a) * r1).toFixed(1);
                return `<line class="cls__clock-tick${maj ? ' maj' : ''}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
              }).join('')}
              <line class="cls__clock-h" id="clsClockH" x1="50" y1="52" x2="50" y2="30"/>
              <line class="cls__clock-m" id="clsClockM" x1="50" y1="54" x2="50" y2="20"/>
              <line class="cls__clock-s" id="clsClockS" x1="50" y1="58" x2="50" y2="17"/>
              <circle class="cls__clock-cap" cx="50" cy="50" r="2.6"/>
            </svg>
          </div>
          <div class="cls__floor"></div>
        </div>

        <!-- ── the 3D classroom mounts here (WebGL room + CSS3D board layer) ── -->
        <div class="cls__scene3d" id="clsScene3D"></div>

        <!-- ── green board mounted on the wall ── -->
        <div class="cls__board" id="clsBoard">
          <div class="cls__slidearea" id="clsSlides"></div>
          <div class="cls__chalk" id="clsChalk" hidden></div>
          <div class="cls__pointer" id="clsPointer"><b></b></div>
          <div class="cls__boardfoot">
            <span id="clsCount">1 / ${slides.length}</span>
            <div class="cls__rail" id="clsRail"></div>
            <span id="clsSubject">${(lesson.subject || 'Lesson')}</span>
          </div>
        </div>

        <!-- ── the teacher, standing in the room (transparent canvas) ── -->
        <div class="cls__teacher" id="clsTeacher">
          <div class="cls__tload" id="clsTLoad"><i></i><span>Bringing your teacher in…</span></div>
        </div>

        <!-- ── wood counter across the foreground; hides the lower body ── -->
        <div class="cls__counter" aria-hidden="true"></div>

        <!-- ── what the teacher is saying ── -->
        <div class="cls__caption" id="clsCap"><span class="txt">Take a seat — your teacher is getting ready…</span></div>

        <div class="cls__dock">
          <button class="cls__btn" id="clsNotes" title="Download notes"><svg viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          <button class="cls__btn" id="clsSlidesDl" title="Download slides (.pptx)"><svg viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="14" rx="2" stroke="currentColor" stroke-width="1.7"/><path d="M8 21h8M12 18v3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></button>
          <button class="cls__btn" id="clsQuiz" title="Take a quiz"><svg viewBox="0 0 24 24" fill="none"><path d="M9 11l2 2 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" stroke-width="1.6"/></svg></button>
          <button class="cls__btn" id="clsWrap" title="Summary, flashcards & practice"><svg viewBox="0 0 24 24" fill="none"><path d="M4 6h16M4 12h16M4 18h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
        </div>
      </div>

      <div class="cls__controls">
        <button class="cls__btn" id="clsPrev" title="Previous slide"><svg viewBox="0 0 24 24" fill="none"><path d="M15 6l-6 6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <button class="cls__btn" id="clsReplay" title="Replay this slide"><svg viewBox="0 0 24 24" fill="none"><path d="M4 4v6h6M20 20v-6h-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 10a8 8 0 00-14.9-3M4 14a8 8 0 0014.9 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
        <button class="cls__btn cls__btn--play" id="clsPlay" title="Play / pause (Space)"><svg viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg></button>
        <button class="cls__btn" id="clsNext" title="Next slide"><svg viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <span class="cls__sep"></span>
        <button class="cls__btn" id="clsSpeed" title="Playback speed"><span class="cls__speed">1.0×</span></button>
        <button class="cls__btn cls__btn--mic" id="clsMic" title="Interrupt & ask (mic)"><svg viewBox="0 0 24 24" fill="none"><rect x="9" y="3" width="6" height="11" rx="3" stroke="#fff" stroke-width="1.8"/><path d="M5 11a7 7 0 0014 0M12 18v3" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg><span>Ask</span></button>
        <button class="cls__btn" id="clsFull" title="Fullscreen"><svg viewBox="0 0 24 24" fill="none"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
      </div>

      <div class="cls__panel" id="clsPanel"><div class="cls__sheet" id="clsSheet"></div></div>
    `;
    document.body.appendChild(root);
    $('clsTtl').textContent = lesson.title || 'Lesson';
    // rail pips
    const rail = $('clsRail');
    slides.forEach((_, i) => {
      const p = el('button', 'cls__pip' + (i === 0 ? ' active' : ''));
      p.title = `Slide ${i + 1}`;
      p.onclick = () => jump(i);
      rail.appendChild(p);
    });

    // wire controls
    $('clsX').onclick = close;
    $('clsPlay').onclick = togglePlay;
    $('clsPrev').onclick = () => jump(idx - 1);
    $('clsNext').onclick = () => jump(idx + 1);
    $('clsReplay').onclick = () => { playing = true; paused = false; setPlayIcon(true); playSlide(idx); };
    $('clsSpeed').onclick = cycleSpeed;
    $('clsMic').onclick = toggleMic;
    $('clsFull').onclick = toggleFullscreen;
    $('clsNotes').onclick = downloadNotes;
    $('clsSlidesDl').onclick = downloadSlides;
    $('clsQuiz').onclick = openQuiz;
    $('clsWrap').onclick = openWrapUp;
    $('clsPanel').onclick = (e) => { if (e.target === $('clsPanel')) hidePanel(); };

    window.addEventListener('resize', onResize);
    document.addEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (!opened) return;
    if (e.key === 'Escape') { if ($('clsPanel').classList.contains('show')) hidePanel(); else close(); }
    else if (e.key === ' ' && !isTyping(e)) { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowRight') jump(idx + 1);
    else if (e.key === 'ArrowLeft') jump(idx - 1);
  }
  const isTyping = (e) => /input|textarea/i.test((e.target.tagName || ''));

  function onResize() {
    if (teacher && teacher.resize) teacher.resize();
    fitSlideToBoard();
  }

  /* ═════════════════════════ teacher mount ═════════════════════════
   * Mount the real 3D AI Teacher avatar over the classroom stage beside the green chalkboard.
   * Falls back to the SVG professor if WebGL is unavailable or fails.
   */
  async function upgradeTo3D() {
    const badge = $('clsTLoad');
    let mod = null;
    try {
      mod = await import('./teacher3d.js?v=23');
    } catch (err) {
      console.info('[Omkar Classroom] Using SVG teacher (module failed):', err && err.message);
      if (badge) badge.remove();
      return;
    }

    try {
      const host = $('clsTeacher');
      if (!host) return;
      const t3d = await mod.createTeacher3D(host, { framing: 'bust' });
      if (!opened) { t3d && t3d.dispose && t3d.dispose(); return; }
      adoptTeacher(t3d);
    } catch (err) {
      console.info('[Omkar Classroom] Using SVG teacher fallback:', err && err.message);
    } finally {
      if (badge) badge.remove();
    }
  }

  /* Swap whatever teacher is on screen for a new one, carrying the live state across so the
     switch is invisible even mid-sentence. */
  function adoptTeacher(next) {
    const old = teacher;
    teacher = next;
    teacher.setExpression && teacher.setExpression('smile');
    teacher.setSpeaking && teacher.setSpeaking(!!(curAudio && !curAudio.paused) || !!fakeMouth);
    teacher.resize && teacher.resize();
    if (old && old.dispose) old.dispose();
  }

  /* ═════════════════════════ slides ═════════════════════════ */
  function renderSlide(i) {
    let content = '';
    if (typeof slideHTML === 'function') {
      content = slideHTML(slides[i], i);
    } else {
      const s = slides[i] || {};
      content = `<div class="slide-canvas__grid slide-canvas__grid--full"><div class="slide-canvas__main"><h3>${s.heading || ''}</h3></div></div>`;
    }
    return `<div class="cls__slide-fit"><div class="slide-canvas">${content}</div></div>`;
  }

  function fitSlideToBoard(slideEl) {
    if (!slideEl) {
      const area = $('clsSlides');
      if (area) {
        area.querySelectorAll('.cls__slide.in, .cls__slide:not(.out)').forEach(fitSlideToBoard);
      }
      return;
    }
    const fit = slideEl.querySelector('.cls__slide-fit');
    if (!fit) return;

    fit.style.width = '100%';

    const area = $('clsSlides');
    if (!area) return;
    const availH = area.clientHeight - 8;
    const availW = area.clientWidth - 12;
    const contentH = fit.scrollHeight || fit.offsetHeight;
    const contentW = fit.scrollWidth || fit.offsetWidth;

    if (availH > 50 && availW > 50 && contentH > 0 && contentW > 0 && (contentH > availH || contentW > availW)) {
      const scaleH = availH / Math.max(1, contentH);
      const scaleW = availW / Math.max(1, contentW);
      const scale = Math.min(1, Math.min(scaleH, scaleW)) * 0.98;
      if (isFinite(scale) && scale > 0.1) {
        fit.style.transform = `scale(${scale.toFixed(3)})`;
        fit.style.transformOrigin = 'top center';
      } else {
        fit.style.transform = 'none';
        fit.style.transformOrigin = 'top center';
      }
    } else {
      fit.style.transform = 'none';
      fit.style.transformOrigin = 'top center';
    }
  }

  /* Swap the board to new content. */
  function swapSlide(html, instant) {
    const area = $('clsSlides');
    if (!area) return null;
    const olds = Array.from(area.querySelectorAll('.cls__slide'));
    const next = el('div', 'cls__slide', html);
    area.appendChild(next);
    if (instant) {
      next.classList.add('in');
      fitSlideToBoard(next);
    }
    requestAnimationFrame(() => {
      next.classList.add('in');
      fitSlideToBoard(next);
    });
    olds.forEach((o) => {
      o.classList.remove('in');
      o.classList.add('out');
      if (instant) o.remove(); else setTimeout(() => o.remove(), 520);
    });
    return next;
  }

  function showSlide(i, instant) {
    idx = Math.max(0, Math.min(slides.length - 1, i));
    const next = swapSlide(renderSlide(idx), instant);
    $('clsCount').textContent = `${idx + 1} / ${slides.length}`;
    $('clsRail').querySelectorAll('.cls__pip').forEach((p, ix) => p.classList.toggle('active', ix === idx));
    setupReveal(next, sayFor(idx), playing && !paused);
    chalkWrite(findFormula(slides[idx]));
    requestAnimationFrame(() => {
      fitSlideToBoard(next);
      setTimeout(() => fitSlideToBoard(next), 60);
      setTimeout(() => fitSlideToBoard(next), 250);
    });
  }

  /* ═════════════ progressive reveal — bullets land as the teacher speaks ═════════════
   * A whole slide appearing at once is what makes AI lessons feel like a slideshow.
   * Revealing each point in time with the voice is what makes it feel taught. */
  let revealEls = [], revealIx = 0, revealT0 = 0, revealDur = 6000;

  function setupReveal(slideEl, spoken, animate) {
    revealEls = Array.from(slideEl.querySelectorAll(
      '.expx__pt, .flowx__node, .flowx__arr, .diax-cycle__node, .diax-compare__col, .slide-canvas__imgwrap'
    ));
    revealIx = 0;
    if (!animate || revealEls.length < 2) { revealEls = []; return; }   // paused/browsing: show it all
    revealEls.forEach((e) => e.classList.add('cls-rv'));
    revealT0 = performance.now();
    const words = String(spoken || '').trim().split(/\s+/).filter(Boolean).length || 20;
    revealDur = Math.max(2600, (words / 2.7) * 1000);   // ~2.7 words a second
  }

  function tickReveal() {
    if (revealIx >= revealEls.length) return;
    let p;
    if (curAudio && isFinite(curAudio.duration) && curAudio.duration > 0) {
      p = curAudio.currentTime / curAudio.duration;      // exact, once the mp3 is loaded
    } else {
      p = (performance.now() - revealT0) / revealDur;    // estimate for browser voices
    }
    // lead the voice slightly so a point is on the board as she starts saying it
    const want = Math.min(revealEls.length, Math.floor(p * revealEls.length * 1.15) + 1);
    while (revealIx < want) revealEls[revealIx++].classList.add('cls-rv-in');
  }

  function revealAll() {
    while (revealIx < revealEls.length) revealEls[revealIx++].classList.add('cls-rv-in');
  }

  /* ═════════════ chalk handwriting — the key formula gets "written" ═════════════ */
  const FORMULA_RE = /([A-Za-z][A-Za-z0-9_()²³⁻]{0,14}\s*=\s*[^.,;:\n]{2,38})/;

  function findFormula(s) {
    if (!s) return '';
    const texts = [s.heading, s.subtitle];
    (s.points || []).forEach((p) => texts.push(p.bold, p.text || p));
    (s.steps || []).forEach((x) => texts.push(x));
    (s.parts || []).forEach((p) => texts.push(p.label, p.desc));
    for (const t of texts) {
      const m = String(t || '').match(FORMULA_RE);
      if (m) return m[1].trim().replace(/\s+/g, ' ').slice(0, 40);
    }
    return '';
  }

  function chalkWrite(formula) {
    const host = $('clsChalk'), area = $('clsSlides');
    if (!host) return;
    // reserve room at the foot of the slide so the chalk never sits on top of the text
    if (area) area.classList.toggle('has-chalk', !!formula);
    if (!formula) { host.hidden = true; host.innerHTML = ''; return; }
    host.hidden = false;
    host.innerHTML = `<svg viewBox="0 0 560 96" preserveAspectRatio="xMinYMid meet">
        <text x="10" y="62" class="cls-chalk-t">${escapeHtml(formula)}</text>
      </svg>`;
    const t = host.querySelector('text');          // restart the write-on animation
    if (t) { t.style.animation = 'none'; void t.getBBox(); t.style.animation = ''; }
  }

  /* ═════════════════════════ playback ═════════════════════════ */
  // Ask the backend to rewrite the lesson as a funny, cheeky teaching script.
  // Each line also carries the gesture + facial expression the avatar should play.
  function fetchScript() {
    scriptPromise = fetch('/api/teacher-script', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lesson, language: lang }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => { script = (d && d.script) || null; return script; })
      .catch(() => null);
    return scriptPromise;
  }

  // what the teacher should SAY / DO on slide i — script if we have it, lesson narration otherwise
  const lineFor = (i) => (script && script.lines && script.lines[i]) || null;
  const sayFor = (i) => { const l = lineFor(i); return (l && l.say) || narration[i] || (slides[i] && slides[i].heading) || ''; };

  async function greetAndStart() {
    const first = ((typeof me !== 'undefined' && me && me.name) || '').split(' ')[0];
    // give the script a few seconds to land so the class opens in character
    if (scriptPromise) {
      setCaption('Your teacher is walking in…');
      await Promise.race([scriptPromise, new Promise(r => setTimeout(r, 9000))]);
    }
    if (!opened) return;
    const hello = (script && script.greeting) || greetLine(lang, first, lesson.title);
    setCaption(hello, true);
    teacher.setExpression && teacher.setExpression('cheeky');
    teacher.lookAt && teacher.lookAt('front');
    teacher.gesture && teacher.gesture('wave');
    playing = true; paused = false; setPlayIcon(true);
    speak(hello, () => { if (playing && !paused) playSlide(0); });
  }

  function playSlide(i) {
    if (!playing || paused) return;
    if (i >= slides.length) { finish(); return; }
    idx = i;
    showSlide(i);
    const line = lineFor(i);
    const text = sayFor(i);
    setCaption(text);
    // glance at the board and play the gesture the script chose for this line
    teacher.lookAt && teacher.lookAt('board');
    teacher.gesture && teacher.gesture((line && line.gesture) || 'point');
    teacher.setExpression && teacher.setExpression((line && line.mood) || 'explain');
    pointer(true);
    setTimeout(() => { if (playing && !paused) { teacher.lookAt && teacher.lookAt('front'); } }, 1400);
    // script lines are in the teacher's language; the narration fallback is in the
    // notes language — speak each with the voice that actually matches the text.
    speak(text, () => {
      pointer(false);
      /* A real teacher takes a beat before moving on — it lets the point land and gives the
         student a moment to read the board. Running the next line on immediately is the
         single thing that most makes a narrated deck sound like a machine reading aloud. */
      if (playing && !paused) {
        teacher.lookAt && teacher.lookAt('student');
        setTimeout(() => { if (playing && !paused) playSlide(i + 1); }, 900);
      }
    }, lang);
  }

  function togglePlay() {
    if (!playing) { playing = true; paused = false; setPlayIcon(true); playSlide(idx); return; }
    if (paused) { resume(); } else { pause(); }
  }

  function pause() {
    paused = true; setPlayIcon(false);
    revealAll();          // don't leave half the board hidden while they read
    if (curAudio) { try { curAudio.pause(); } catch (_) {} }
    if (window.speechSynthesis && speechSynthesis.speaking) speechSynthesis.pause();
    teacher.setSpeaking && teacher.setSpeaking(false);
    setCaption('⏸ Paused — press play to continue.');
  }

  function resume() {
    paused = false; setPlayIcon(true);
    if (curAudio && curAudio.paused) { curAudio.play().catch(() => playSlide(idx)); teacher.setSpeaking && teacher.setSpeaking(true); }
    else if (window.speechSynthesis && speechSynthesis.paused) { speechSynthesis.resume(); teacher.setSpeaking && teacher.setSpeaking(true); }
    else { playSlide(idx); }
    setCaption(sayFor(idx));
  }

  function jump(i) {
    i = Math.max(0, Math.min(slides.length - 1, i));
    stopSpeaking();
    if (playing && !paused) { playSlide(i); }
    else { showSlide(i); setCaption(sayFor(i)); }
  }

  function finish() {
    playing = false; paused = false; setPlayIcon(false);
    teacher.lookAt && teacher.lookAt('front');
    teacher.setExpression && teacher.setExpression('proud');
    teacher.gesture && teacher.gesture('clap');
    const done = (script && script.outro) || wrapLine(lang);
    setCaption(done);
    speak(done, () => { setTimeout(openWrapUp, 400); });
  }

  function setPlayIcon(isPlaying) {
    $('clsPlay').innerHTML = isPlaying
      ? '<svg viewBox="0 0 24 24" fill="#fff"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg>';
  }
  function setCaption(text, greeting) {
    $('clsCap').innerHTML = (greeting ? '<b>👋</b>' : '<b>🎓</b>') + `<span class="txt">${escapeHtml(text)}</span>`;
  }
  function pointer(on) { const p = $('clsPointer'); if (p) p.classList.toggle('on', !!on); }

  function cycleSpeed() {
    const steps = [0.75, 1, 1.25, 1.5, 2];
    rate = steps[(steps.indexOf(rate) + 1) % steps.length];
    $('clsSpeed').querySelector('.cls__speed').textContent = rate.toFixed(2).replace(/0$/, '') + '×';
    if (curAudio) curAudio.playbackRate = rate;
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) root.requestFullscreen && root.requestFullscreen().catch(() => {});
    else document.exitFullscreen && document.exitFullscreen();
  }

  /* ═════════════════════════ speech + lip-sync ═════════════════════════ */
  function ensureAudioCtx() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;          // enough resolution to tell vowel shapes apart
      // Lower = the analyser reacts faster to the audio. 0.5 lagged the voice noticeably;
      // 0.3 tracks each syllable while still filtering out sample-level jitter.
      analyser.smoothingTimeConstant = 0.3;
      lipBuf = new Uint8Array(analyser.fftSize);
      freqBuf = new Uint8Array(analyser.frequencyBinCount);
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }

  /* Lip-sync driver.
   * Loudness alone can only flap a jaw. To read as real speech in ANY language we also
   * look at WHERE the energy sits in the spectrum:
   *   low-frequency dominance  -> rounded vowels (o, u, oo)      -> funnel / pucker
   *   mid+high dominance       -> spread vowels & sibilants (ee, s) -> stretch / smile
   * That's phonetic, not text-based, so English, Hindi and Kannada all work the same way.
   * Envelopes use a fast attack and slower release, which is what makes speech look crisp.
   */
  function lipLoop() {
    rafId = requestAnimationFrame(lipLoop);
    let open = 0, round = 0, wide = 0;

    const isAudioPlaying = !!(curAudio && !curAudio.paused);
    const isSpeechSpeaking = !!(window.speechSynthesis && speechSynthesis.speaking && !speechSynthesis.paused);
    const isTeacherSpeaking = isAudioPlaying || isSpeechSpeaking || !!fakeMouth;

    if (analyser && isAudioPlaying) {
      analyser.getByteTimeDomainData(lipBuf);
      let sum = 0;
      for (let k = 0; k < lipBuf.length; k++) { const v = (lipBuf[k] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / lipBuf.length);
      
      if (rms > 0.018) {
        // Active speech energy: snappy responsive jaw opening
        const normalized = Math.min(1, (rms - 0.018) * 6.8);
        open = Math.pow(normalized, 0.72);
      } else {
        // Natural pause or silence between words: allow mouth to rest closed
        open = 0;
      }

      analyser.getByteFrequencyData(freqBuf);
      const binHz = (audioCtx.sampleRate || 48000) / analyser.fftSize;
      const bin = (hz) => Math.max(1, Math.min(freqBuf.length - 1, Math.round(hz / binHz)));
      const band = (loHz, hiHz) => {
        const a = bin(loHz), b = bin(hiHz);
        let s = 0, n = 0;
        for (let i = a; i <= b; i++) { s += freqBuf[i]; n++; }
        return n ? (s / n) / 255 : 0;
      };
      const lo = band(100, 700), mid = band(700, 2400), hi = band(2400, 6500);
      const tot = lo + mid + hi + 1e-6;
      round = Math.min(1, (lo / tot) * 1.6);
      wide = Math.min(1, ((mid + hi) / tot) * 1.35);
    } else if (isTeacherSpeaking) {
      // Audio or SpeechSynthesis is actively talking: provide continuous lively visemes
      const tNow = performance.now() * 0.001;
      const base = fakeMouth || Math.max(0, Math.sin(tNow * 11.5) * 0.44 + Math.sin(tNow * 18.0) * 0.28 + 0.32);
      open = Math.min(1, base);
      round = Math.max(0, Math.sin(tNow * 7.5)) * 0.40;
      wide = Math.max(0, Math.cos(tNow * 8.6)) * 0.40;
    }

    vOpen += (open - vOpen) * (open > vOpen ? 0.80 : 0.42);   // instant snappy attack, smooth release
    vRound += (round - vRound) * 0.32;
    vWide += (wide - vWide) * 0.32;

    if (teacher) {
      if (teacher.setViseme) teacher.setViseme({ open: vOpen, round: vRound, wide: vWide });
      else if (teacher.setMouth) teacher.setMouth(vOpen);
    }
    tickReveal();
  }
  function startLip() { if (!rafId) rafId = requestAnimationFrame(lipLoop); }

  // Speak one line: neural /api/tts first, browser voice as fallback. done() on end.
  // langOverride matters when a line isn't in the teacher's language — e.g. the script
  // failed and we're falling back to the slide narration, which is in the notes language.
  async function speak(text, done, langOverride) {
    stopSpeaking(false);
    if (!text || !text.trim()) { done && done(); return; }
    const useLang = langOverride || lang;
    const myEpoch = speechEpoch;              // claim this turn to speak
    teacher.setSpeaking && teacher.setSpeaking(true);
    startLip();
    ensureAudioCtx();
    try {
      const res = await fetch('/api/tts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, language: useLang, lessonTitle: lesson.title || '' }),
      });
      // someone hit Ask / Stop / a slide jump while this was downloading — drop it silently
      if (myEpoch !== speechEpoch) return;
      if (res.ok && (res.headers.get('Content-Type') || '').includes('audio')) {
        const blob = await res.blob();
        if (myEpoch !== speechEpoch) return;
        const url = URL.createObjectURL(blob);
        ensureAudioCtx();
        const a = new Audio(url);
        a.playbackRate = rate; a.crossOrigin = 'anonymous';
        try { const srcNode = audioCtx.createMediaElementSource(a); srcNode.connect(analyser); analyser.connect(audioCtx.destination); } catch (_) {}
        curAudio = a;
        a.onended = () => { URL.revokeObjectURL(url); if (myEpoch === speechEpoch) afterSpeak(done); };
        a.onerror = () => { URL.revokeObjectURL(url); if (myEpoch === speechEpoch) afterSpeak(done); };
        
        try {
          await a.play();
          return;
        } catch (playErr) {
          console.warn('[Cartesia] Audio play with WebAudio graph rejected, retrying direct play:', playErr.message);
          try {
            const aDirect = new Audio(url);
            aDirect.playbackRate = rate;
            curAudio = aDirect;
            aDirect.onended = () => { URL.revokeObjectURL(url); if (myEpoch === speechEpoch) afterSpeak(done); };
            await aDirect.play();
            return;
          } catch (dErr) {
            console.warn('[Cartesia] Direct play also rejected:', dErr.message);
          }
        }
      }
    } catch (e) { console.warn('[Cartesia] Fetch error:', e.message); }
    speakBrowser(text, done, useLang, myEpoch);
  }

  function speakBrowser(text, done, useLang, myEpoch) {
    if (myEpoch != null && myEpoch !== speechEpoch) return;
    if (!window.speechSynthesis) { afterSpeak(done); return; }
    const u = new SpeechSynthesisUtterance(text);
    const targetLang = useLang || lang || 'English';
    u.lang = codeOf(targetLang);
    u.rate = rate;
    const voices = (speechSynthesis.getVoices() || []);
    const codePrefix = u.lang.split('-')[0].toLowerCase();
    const langLower = String(targetLang).toLowerCase();
    const v = voices.find(x => x.lang.toLowerCase() === u.lang.toLowerCase())
      || voices.find(x => x.lang.toLowerCase().startsWith(codePrefix))
      || voices.find(x => x.name.toLowerCase().includes(langLower))
      || voices.find(x => codePrefix === 'hi' && (x.name.toLowerCase().includes('hindi') || x.name.toLowerCase().includes('india') || x.name.toLowerCase().includes('swara') || x.name.toLowerCase().includes('kalpana') || x.name.toLowerCase().includes('hemant')));
    if (v) u.voice = v;
    // synthetic visemes while the browser voice speaks (no audio stream to analyse)
    let osc = setInterval(() => { fakeMouth = 0.25 + Math.random() * 0.6; }, 90);
    const stop = () => { clearInterval(osc); fakeMouth = 0; };
    const finish = () => { stop(); if (myEpoch == null || myEpoch === speechEpoch) afterSpeak(done); };
    u.onend = finish;
    u.onerror = finish;
    speechSynthesis.speak(u);
  }

  function afterSpeak(done) {
    curAudio = null; fakeMouth = 0;
    if (teacher && teacher.setMouth) teacher.setMouth(0);
    teacher.setSpeaking && teacher.setSpeaking(false);
    done && done();
  }

  function stopSpeaking(resetTeacher = true) {
    speechEpoch++;               // invalidates any TTS request still in flight
    if (curAudio) { try { curAudio.pause(); curAudio.onended = null; curAudio.onerror = null; } catch (_) {} curAudio = null; }
    if (window.speechSynthesis) speechSynthesis.cancel();
    fakeMouth = 0;
    if (resetTeacher && teacher) { teacher.setMouth && teacher.setMouth(0); teacher.setSpeaking && teacher.setSpeaking(false); }
  }

  /* ═════════════════════════ interrupt & ask (mic) ═════════════════════════
   * Listening and speaking are DIFFERENT languages. This used to set the recogniser to
   * codeOf(lang) — the language the TEACHER talks in — so with the teacher set to Hindi,
   * an English question was fed to a hi-IN recogniser and came back as nonsense. That is
   * why the answers sometimes had nothing to do with the question.
   *
   * Now the audio goes to /api/stt (Whisper) with NO language hint, so it auto-detects
   * whatever you actually spoke. Whisper is also far more accurate than the browser
   * recogniser. What language the teacher REPLIES in is decided separately, by `lang`.
   * The browser recogniser stays as a fallback for when the mic or the endpoint fails. */
  let micStream = null, micRec = null, micChunks = [];

  function toggleMic() {
    // The teacher goes quiet the INSTANT you reach for the mic — before anything else
    // happens. Raising your hand in a real class doesn't wait for the sentence to finish.
    if (recording) { stopMic(); return; }
    wasPlaying = playing && !paused;
    silenceTeacher();
    startMic();
  }

  async function startMic() {
    if (!navigator.mediaDevices || !window.MediaRecorder) return micFallback();
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (_) {
      setCaption('Microphone blocked — allow mic access to ask.');
      resumeAfterAsk();
      return;
    }
    try {
      micRec = new MediaRecorder(micStream);
    } catch (_) { releaseMic(); return micFallback(); }

    micChunks = [];
    recording = true;
    $('clsMic').classList.add('rec');
    setCaption('🎤 Listening… ask in any language, tap again when done.');
    micRec.ondataavailable = (e) => { if (e.data && e.data.size) micChunks.push(e.data); };
    micRec.onstop = async () => {
      releaseMic();
      recording = false;
      $('clsMic').classList.remove('rec');
      const blob = new Blob(micChunks, { type: 'audio/webm' });
      if (!blob.size) { resumeAfterAsk(); return; }
      setCaption('🤔 Let me hear that properly…');
      try {
        const fd = new FormData();
        fd.append('audio', blob, 'question.webm');
        // deliberately NO language field — let Whisper detect what was actually spoken.
        // The lesson's own vocabulary goes along as a hint so its technical terms come
        // back spelled correctly instead of as whatever they rhyme with.
        fd.append('context', sttContext());
        const res = await fetch('/api/stt', { method: 'POST', body: fd });
        const d = await res.json();
        const q = (d.text || '').trim();
        if (!q) { setCaption('Couldn’t catch that — tap Ask and try again.'); resumeAfterAsk(); return; }
        askTeacher(q, d.language || 'Auto');
      } catch (e) {
        setCaption('Couldn’t catch that — tap Ask and try again.');
        resumeAfterAsk();
      }
    };
    micRec.start();
  }

  function stopMic() {
    if (micRec && micRec.state === 'recording') { try { micRec.stop(); } catch (_) {} return; }
    if (recog) { try { recog.stop(); } catch (_) {} }
  }

  /* The words Whisper should expect to hear: the topic and the headings already covered.
     Keeps subject vocabulary from being transcribed as a similar-sounding everyday word. */
  function sttContext() {
    const bits = [lesson.title || '', lesson.subject || ''];
    for (let i = 0; i <= idx && i < slides.length; i++) {
      if (slides[i] && slides[i].heading) bits.push(slides[i].heading);
    }
    return bits.filter(Boolean).join('. ').slice(0, 700);
  }

  function releaseMic() {
    if (micStream) { micStream.getTracks().forEach(t => { try { t.stop(); } catch (_) {} }); micStream = null; }
    micRec = null;
  }

  /* Fallback path: the browser's own recogniser. Note it is NOT locked to the teacher's
     language here either — it follows the browser locale, so an English question stays
     an English question. */
  function micFallback() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      const q = prompt('Ask your teacher a follow-up question:');
      if (q) askTeacher(q); else resumeAfterAsk();
      return;
    }
    recog = new SR();
    recog.lang = navigator.language || 'en-IN';
    recog.interimResults = false;
    recog.maxAlternatives = 3;
    recording = true;
    let got = false;
    $('clsMic').classList.add('rec');
    setCaption('🎤 Listening… ask your question.');
    recog.onresult = (e) => { got = true; askTeacher(e.results[0][0].transcript); };
    recog.onerror = () => { setCaption('Couldn’t hear that — tap Ask to try again.'); };
    recog.onend = () => {
      recording = false;
      $('clsMic').classList.remove('rec');
      if (!got) resumeAfterAsk();       // heard nothing — carry on where we left off
    };
    recog.start();
  }

  /* Cut the voice dead: stops the clip, cancels the browser voice, and invalidates any
     TTS still downloading so it can't start talking a second later. */
  function silenceTeacher() {
    stopSpeaking();
    playing = false; paused = false;
    setPlayIcon(false);
  }

  function resumeAfterAsk() {
    if (!wasPlaying || !opened) return;
    playing = true; paused = false; setPlayIcon(true);
    playSlide(idx);
  }
  let wasPlaying = false;

  /* askedIn is what Whisper heard the student SPEAK. It is passed through only so the
     model knows the question may be in another language — the reply always comes back in
     `lang`, the language the teacher was set to. Ask in English, get answered in Hindi. */
  async function askTeacher(question, askedIn) {
    stopSpeaking();
    playing = false; setPlayIcon(false);
    setCaption('“' + question + '”');
    teacher.setExpression && teacher.setExpression('think');
    teacher.lookAt && teacher.lookAt('front');
    teacher.gesture && teacher.gesture('think_chin');
    // drop a quick "thinking" board while we fetch
    showFollowupBoard({ heading: 'Good question', points: ['One moment…'] }, question);
    try {
      const res = await fetch('/api/ask-teacher', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question, lessonTitle: lesson.title || '',
          lessonContext: (narration.slice(0, idx + 1).join(' ')).slice(0, 1200),
          language: lang,
          questionLanguage: askedIn || '',
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not answer.');
      showFollowupBoard(d.board || { heading: 'Answer', points: [] }, question);
      setCaption(d.say || '');
      teacher.setExpression && teacher.setExpression('explain');
      speak(d.say || '', () => {
        setCaption('Resuming the lesson…');
        setTimeout(() => { playing = true; paused = false; setPlayIcon(true); playSlide(idx); }, 700);
      });
    } catch (e) {
      setCaption('⚠ ' + e.message);
      teacher.setExpression && teacher.setExpression('smile');
    }
  }

  function showFollowupBoard(board, question) {
    const html = `
      <div class="slide-canvas"><div class="slide-canvas__grid slide-canvas__grid--full"><div class="slide-canvas__main">
        <span class="kicker">Your question</span>
        <h3>${escapeHtml(board.heading || 'Answer')}</h3>
        <p class="slide-sub" style="opacity:.8">${escapeHtml(question)}</p>
        <div class="expx">${(board.points || []).map((p, i) => `<div class="expx__pt"><span class="n">${i + 1}</span><div><p>${escapeHtml(p)}</p></div></div>`).join('')}</div>
      </div></div></div>`;
    swapSlide(html);
    chalkWrite('');            // the follow-up board carries no formula of its own
  }

  /* ═════════════════════════ downloads ═════════════════════════ */
  function downloadNotes() {
    const lines = [];
    lines.push(`# ${lesson.title || 'Lesson'}  —  Student Hub`);
    lines.push(`Subject: ${lesson.subject || ''}\n`);
    slides.forEach((s, i) => {
      lines.push(`\n## ${i + 1}. ${s.heading || s.type}`);
      if (s.subtitle) lines.push(s.subtitle);
      if (s.steps) s.steps.forEach((st, j) => lines.push(`   ${j + 1}) ${st}`));
      if (s.parts) s.parts.forEach(p => lines.push(`   • ${p.label}: ${p.desc}`));
      if (s.points) s.points.forEach(p => lines.push(`   • ${p.bold ? p.bold + ' — ' : ''}${p.text || p}`));
      if (narration[i]) lines.push(`   🎓 ${narration[i]}`);
    });
    if (extras) {
      lines.push(`\n\n## Summary\n${extras.summary || ''}`);
      if (extras.keyPoints) { lines.push('\n## Key points'); extras.keyPoints.forEach(k => lines.push(`   • ${k}`)); }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    triggerDownload(blob, safeName(lesson.title) + '-notes.txt');
    toast('Notes downloaded');
  }

  async function downloadSlides() {
    toast('Building .pptx…');
    try {
      const res = await fetch('/api/deck-file', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lesson }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Export failed.');
      triggerDownload(await res.blob(), safeName(lesson.title) + '.pptx');
      toast('Slides downloaded');
    } catch (e) { toast('⚠ ' + e.message); }
  }

  /* ═════════════════════════ quiz ═════════════════════════ */
  async function openQuiz() {
    const wasP = playing && !paused; if (wasP) pause();
    showPanel(`<button class="cls__sheet-x" id="clsSheetX">×</button><h3>Quick quiz</h3><p class="sub">Building questions from this lesson…</p><div class="cls__loading"><i></i><i></i><i></i></div>`);
    try {
      const res = await fetch('/api/practice', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lesson, language: lang }),
      });
      const d = await res.json();
      if (!res.ok || !d.quiz || !d.quiz.questions) throw new Error(d.error || 'Could not build a quiz.');
      renderQuiz(d.quiz);
    } catch (e) { showPanel(`<button class="cls__sheet-x" id="clsSheetX">×</button><h3>Quiz</h3><p class="sub">⚠ ${escapeHtml(e.message)}</p>`); wireSheetX(); }
  }

  function renderQuiz(quiz) {
    const qs = quiz.questions.filter(q => Array.isArray(q.options) && q.options.length);
    let score = 0, answered = 0;
    const body = qs.map((q, i) => `
      <div class="cls__q" data-q="${i}">
        <b>${i + 1}. ${escapeHtml(q.question || q.prompt || '')}</b>
        ${q.options.map((o, j) => `<button class="cls__opt" data-i="${j}">${escapeHtml(o)}</button>`).join('')}
      </div>`).join('');
    showPanel(`<button class="cls__sheet-x" id="clsSheetX">×</button><h3>${escapeHtml(quiz.title || 'Quiz')}</h3><p class="sub">${qs.length} questions · tap an option to check.</p>${body}<p class="sub" id="clsQuizScore" style="margin-top:16px;font-weight:700"></p>`);
    wireSheetX();
    const correctIndex = (q) => typeof q.answer === 'number' ? q.answer
      : q.options.findIndex(o => o === q.answer || o === q.correct);
    $('clsSheet').querySelectorAll('.cls__q').forEach((qEl, i) => {
      const ci = correctIndex(qs[i]);
      qEl.querySelectorAll('.cls__opt').forEach((opt) => {
        opt.onclick = () => {
          if (qEl.dataset.done) return;
          qEl.dataset.done = '1'; answered++;
          const chosen = +opt.dataset.i;
          if (chosen === ci) { opt.classList.add('correct'); score++; }
          else { opt.classList.add('wrong'); const c = qEl.querySelector(`.cls__opt[data-i="${ci}"]`); if (c) c.classList.add('correct'); }
          $('clsQuizScore').textContent = `Score: ${score} / ${qs.length}`;
          if (answered === qs.length) {
            fetch('/api/practice/result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: lesson.title, topic: lesson.title, score, total: qs.length }) }).catch(() => {});
          }
        };
      });
    });
  }

  /* ═════════════════════════ wrap-up (summary / flashcards / practice / coding) ═════════════════════════ */
  async function openWrapUp() {
    const wasP = playing && !paused; if (wasP) pause();
    showPanel(`<button class="cls__sheet-x" id="clsSheetX">×</button><h3>Lesson wrap-up</h3><p class="sub">Preparing your revision material…</p><div class="cls__loading"><i></i><i></i><i></i></div>`);
    try {
      if (!extras) {
        const res = await fetch('/api/lesson-extras', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lesson, language: lang }),
        });
        const d = await res.json();
        if (!res.ok || !d.extras) throw new Error(d.error || 'Could not build a summary.');
        extras = d.extras;
      }
      renderWrapUp(extras);
    } catch (e) { showPanel(`<button class="cls__sheet-x" id="clsSheetX">×</button><h3>Wrap-up</h3><p class="sub">⚠ ${escapeHtml(e.message)}</p>`); wireSheetX(); }
  }

  function renderWrapUp(x) {
    const flash = (x.flashcards || []).map((f, i) => `
      <div class="cls__flash" data-f="${i}">
        <div class="cls__flash-in">
          <div class="cls__flash-face cls__flash-front">${escapeHtml(f.q || '')}</div>
          <div class="cls__flash-face cls__flash-back">${escapeHtml(f.a || '')}</div>
        </div>
      </div>`).join('');
    const coding = x.coding ? `
      <h3 style="font-size:20px;margin-top:22px">💻 Coding exercise</h3>
      <p>${escapeHtml(x.coding.prompt || '')}</p>
      ${x.coding.starter ? `<pre class="cls__code">${escapeHtml(x.coding.starter)}</pre>` : ''}
      ${x.coding.hint ? `<p class="sub">Hint: ${escapeHtml(x.coding.hint)}</p>` : ''}` : '';
    showPanel(`
      <button class="cls__sheet-x" id="clsSheetX">×</button>
      <h3>${escapeHtml(lesson.title || 'Lesson')} — wrap-up</h3>
      <p class="sub">Everything you just learned, ready to revise.</p>
      <p>${escapeHtml(x.summary || '')}</p>
      <h3 style="font-size:20px;margin-top:22px">Key points</h3>
      <ul class="cls__kp">${(x.keyPoints || []).map(k => `<li>${escapeHtml(k)}</li>`).join('')}</ul>
      <h3 style="font-size:20px;margin-top:22px">Flashcards <span class="sub" style="font-weight:400">(tap to flip)</span></h3>
      ${flash}
      <h3 style="font-size:20px;margin-top:22px">Practice questions</h3>
      <ul class="cls__kp">${(x.practice || []).map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ul>
      ${coding}
      <div style="display:flex;gap:10px;margin-top:22px;flex-wrap:wrap">
        <button class="learnbtn" id="clsWrapQuiz" style="background:linear-gradient(135deg,#37b06a,#268a4f)"><span>Take the quiz →</span></button>
        <button class="cls__btn" id="clsWrapNotes" style="border-color:var(--paper-edge);color:var(--t-strong)"><span>Download notes</span></button>
      </div>`);
    wireSheetX();
    $('clsSheet').querySelectorAll('.cls__flash').forEach(f => f.onclick = () => f.classList.toggle('flip'));
    $('clsWrapQuiz').onclick = openQuiz;
    $('clsWrapNotes').onclick = downloadNotes;
  }

  /* ═════════════════════════ panel helpers ═════════════════════════ */
  function showPanel(html) { $('clsSheet').innerHTML = html; $('clsPanel').classList.add('show'); }
  function hidePanel() { $('clsPanel').classList.remove('show'); }
  function wireSheetX() { const x = $('clsSheetX'); if (x) x.onclick = hidePanel; }

  /* ═════════════════════════ SVG teacher (reliable base) ═════════════════════════ */
  function createSvgTeacher(host) {
    const wrap = el('div', 'svg-teacher');
    wrap.style.cssText = 'position:absolute;inset:0;display:grid;place-items:end center;';
    wrap.innerHTML = svgTeacherMarkup();
    host.appendChild(wrap);
    const $$ = (s) => wrap.querySelector(s);
    const g = $$('#stGroup'), mouth = $$('#stMouth'), eyeL = $$('#stEyeL'), eyeR = $$('#stEyeR'),
      browL = $$('#stBrowL'), browR = $$('#stBrowR'), arm = $$('#stArm'), head = $$('#stHead');
    let blinkT = 0, breath = 0, lookX = 0, targetLook = 0, raf = 0, speaking = false, running = true;

    function loop(t) {
      if (!running) return;
      raf = requestAnimationFrame(loop);
      breath += 0.03;
      const by = Math.sin(breath) * 3;
      lookX += (targetLook - lookX) * 0.08;
      g.setAttribute('transform', `translate(${lookX}, ${by})`);
      if (head) head.setAttribute('transform', `rotate(${lookX * 0.06} 150 120)`);
      // blink
      if (t > blinkT) { blinkT = t + 2200 + Math.random() * 2600; blink(); }
    }
    function blink() {
      [eyeL, eyeR].forEach(e => { if (!e) return; e.style.transition = 'transform .09s'; e.style.transformOrigin = 'center'; e.setAttribute('ry', '0.5'); setTimeout(() => e.setAttribute('ry', '6'), 95); });
    }
    running = true; raf = requestAnimationFrame(loop);

    return {
      kind: 'svg',
      setMouth(v) { const h = 4 + v * 26; mouth.setAttribute('ry', (h / 2).toFixed(1)); mouth.setAttribute('rx', (13 - v * 3).toFixed(1)); },
      setSpeaking(s) { speaking = s; },
      lookAt(where) { targetLook = where === 'board' ? -26 : where === 'student' ? 10 : 0; },
      setExpression(mood) {
        if (!browL) return;
        const map = { smile: -3, explain: -6, think: -10, neutral: 0 };
        const b = map[mood] != null ? map[mood] : 0;
        browL.setAttribute('transform', `translate(0 ${b})`);
        browR.setAttribute('transform', `translate(0 ${b})`);
        $$('#stSmile').setAttribute('d', mood === 'think' ? 'M120 168 q30 6 60 0' : 'M118 166 q32 16 64 0');
      },
      gesture(kind) {
        if (!arm) return;
        arm.style.transition = 'transform .5s cubic-bezier(.22,1,.36,1)';
        arm.style.transformOrigin = '96px 210px';
        arm.style.transform = kind === 'point' ? 'rotate(-38deg)' : kind === 'welcome' ? 'rotate(-14deg)' : 'rotate(0deg)';
        if (kind === 'point') setTimeout(() => { if (arm) arm.style.transform = 'rotate(-20deg)'; }, 1600);
      },
      resize() {},
      dispose() { running = false; if (raf) cancelAnimationFrame(raf); wrap.remove(); },
    };
  }

  function svgTeacherMarkup() {
    return `
    <svg viewBox="0 0 300 300" width="86%" style="max-height:96%" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="stSkin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e7b48f"/><stop offset="1" stop-color="#cf9873"/></linearGradient>
        <linearGradient id="stCoat" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b3f5c"/><stop offset="1" stop-color="#272a41"/></linearGradient>
        <radialGradient id="stHair" cx="0.5" cy="0.3" r="0.8"><stop offset="0" stop-color="#3a2c22"/><stop offset="1" stop-color="#231a14"/></radialGradient>
      </defs>
      <g id="stGroup">
        <!-- body / coat -->
        <path d="M60 300 Q60 208 150 205 Q240 208 240 300 Z" fill="url(#stCoat)"/>
        <path d="M150 205 L134 300 L166 300 Z" fill="#eef1fb" opacity=".9"/>
        <circle cx="150" cy="214" r="8" fill="#5b4ff0"/>
        <!-- arm that points -->
        <g id="stArm"><rect x="86" y="196" width="26" height="86" rx="13" fill="url(#stCoat)"/><circle cx="99" cy="286" r="12" fill="url(#stSkin)"/></g>
        <!-- head -->
        <g id="stHead">
          <ellipse cx="150" cy="120" rx="56" ry="62" fill="url(#stSkin)"/>
          <path d="M96 108 Q100 52 150 50 Q200 52 204 108 Q188 78 150 76 Q112 78 96 108 Z" fill="url(#stHair)"/>
          <!-- ears -->
          <ellipse cx="95" cy="124" rx="9" ry="13" fill="#cf9873"/><ellipse cx="205" cy="124" rx="9" ry="13" fill="#cf9873"/>
          <!-- glasses -->
          <circle cx="126" cy="118" r="16" fill="none" stroke="#2a2a33" stroke-width="2.5"/>
          <circle cx="174" cy="118" r="16" fill="none" stroke="#2a2a33" stroke-width="2.5"/>
          <path d="M142 118 h16" stroke="#2a2a33" stroke-width="2.5"/>
          <!-- brows -->
          <rect id="stBrowL" x="114" y="100" width="24" height="5" rx="2.5" fill="#3a2c22"/>
          <rect id="stBrowR" x="162" y="100" width="24" height="5" rx="2.5" fill="#3a2c22"/>
          <!-- eyes -->
          <ellipse id="stEyeL" cx="126" cy="118" rx="5.5" ry="6" fill="#28303a"/>
          <ellipse id="stEyeR" cx="174" cy="118" rx="5.5" ry="6" fill="#28303a"/>
          <!-- nose -->
          <path d="M150 122 q-5 14 -3 20 q3 4 6 0" fill="none" stroke="#b07f5c" stroke-width="2.4" stroke-linecap="round"/>
          <!-- smile + mouth -->
          <path id="stSmile" d="M118 166 q32 16 64 0" fill="none" stroke="#9a5b46" stroke-width="3" stroke-linecap="round"/>
          <ellipse id="stMouth" cx="150" cy="160" rx="13" ry="2" fill="#6d2f2c"/>
        </g>
      </g>
    </svg>`;
  }

  /* ═════════════════════════ tiny utils ═════════════════════════ */
  function greetLine(l, name, title) {
    const who = name ? `, ${name}` : '';
    if (/Hindi|Hinglish/i.test(l)) return `Namaste${who}! Aaj hum "${title}" seekhenge. Chaliye shuru karte hain.`;
    if (/Kannada|Kanglish/i.test(l)) return `Namaskara${who}! Ivattu naavu "${title}" bagge kaliyona. Shuru maaduva.`;
    return `Hello${who}! Welcome to class. Today we'll learn "${title}". Let's begin.`;
  }
  function wrapLine(l) {
    if (/Hindi|Hinglish/i.test(l)) return `Bas! Humne poora topic cover kar liya. Shabaash — ab revision dekhte hain.`;
    if (/Kannada|Kanglish/i.test(l)) return `Ashte! Naavu ellavannu kaliteevi. Olleyadu — eega revision nodona.`;
    return `And that wraps up our lesson. Well done — let's look at your revision material.`;
  }
  function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function safeName(t) { return (String(t || 'lesson').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'lesson').slice(0, 60); }
  function triggerDownload(blob, name) { const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1000); }
  function toast(msg) {
    let t = $('clsToast'); if (!t) { t = el('div', ''); t.id = 'clsToast'; t.style.cssText = 'position:fixed;z-index:5000;bottom:100px;left:50%;transform:translateX(-50%);background:#111118;color:#fff;padding:10px 18px;border-radius:12px;font:600 13px/1 "Plus Jakarta Sans",sans-serif;box-shadow:0 12px 30px rgba(0,0,0,.4);opacity:0;transition:opacity .25s'; document.body.appendChild(t); }
    t.textContent = msg; t.style.opacity = '1'; clearTimeout(t._h); t._h = setTimeout(() => { t.style.opacity = '0'; }, 1800);
  }

  window.OmkarClassroom = { open, close, isOpen };
})();
