/* ===================================================================
   aha. — interactions
   =================================================================== */
(function () {
  'use strict';

  /* ---------- nav scrolled state ---------- */
  var nav = document.getElementById('nav');
  function onScrollNav() {
    if (window.scrollY > 40) nav.classList.add('scrolled');
    else nav.classList.remove('scrolled');
  }
  window.addEventListener('scroll', onScrollNav, { passive: true });
  onScrollNav();

  /* ---------- reveal on enter ---------- */
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { threshold: 0.18, rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll('.reveal:not(.in)').forEach(function (el) { io.observe(el); });

  /* ---------- hero typing loop ---------- */
  var typed = document.getElementById('heroTyped');
  if (typed) {
    var phrases = [
      'How does photosynthesis work?',
      'Snap a photo of your homework…',
      'Explain derivatives like I\u2019m 5',
      'Why is the sky blue?'
    ];
    var caret = '<span class="caret"></span>';
    var pi = 0, ci = 0, deleting = false;
    function tick() {
      var p = phrases[pi];
      if (!deleting) {
        ci++;
        if (ci > p.length) { deleting = true; setTimeout(tick, 1400); return; }
      } else {
        ci--;
        if (ci === 0) { deleting = false; pi = (pi + 1) % phrases.length; }
      }
      typed.innerHTML = p.slice(0, ci) + caret;
      setTimeout(tick, deleting ? 34 : 64);
    }
    tick();
  }

  /* ---------- mode card waveform bars ---------- */
  var mw = document.getElementById('modeWave');
  if (mw) {
    for (var i = 0; i < 22; i++) {
      var s = document.createElement('span');
      s.style.animationDelay = (i * 0.06) + 's';
      s.style.animationDuration = (0.9 + (i % 4) * 0.18) + 's';
      mw.appendChild(s);
    }
  }

  /* ---------- hero floating particles ---------- */
  var hp = document.getElementById('heroParticles');
  if (hp) {
    var hctx = hp.getContext('2d'), pw, ph, parts;
    function presize() {
      pw = hp.width = hp.offsetWidth * devicePixelRatio;
      ph = hp.height = hp.offsetHeight * devicePixelRatio;
      var n = Math.round(hp.offsetWidth * hp.offsetHeight / 16000);
      parts = [];
      for (var i = 0; i < n; i++) parts.push({
        x: Math.random() * pw, y: Math.random() * ph,
        r: (Math.random() * 1.6 + 0.4) * devicePixelRatio,
        vy: (Math.random() * 0.35 + 0.08) * devicePixelRatio,
        vx: (Math.random() - 0.5) * 0.18 * devicePixelRatio,
        a: Math.random() * 0.45 + 0.12
      });
    }
    function ptick() {
      hctx.clearRect(0, 0, pw, ph);
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        p.y -= p.vy; p.x += p.vx;
        if (p.y < -10) { p.y = ph + 10; p.x = Math.random() * pw; }
        if (p.x < -10) p.x = pw + 10;
        if (p.x > pw + 10) p.x = -10;
        hctx.beginPath();
        hctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        hctx.fillStyle = 'rgba(255,255,255,' + p.a + ')';
        hctx.fill();
      }
      requestAnimationFrame(ptick);
    }
    presize();
    window.addEventListener('resize', presize);
    ptick();
  }

  /* ===================================================================
     STUDIO — scroll-driven pinned deck generation
     =================================================================== */
  var studio = document.getElementById('studio');
  var stages = Array.prototype.slice.call(document.querySelectorAll('.stage'));
  var railSteps = Array.prototype.slice.call(document.querySelectorAll('#studioRail .rail-step'));
  var thinkLis = Array.prototype.slice.call(document.querySelectorAll('#thinkSteps li'));
  var studioTitle = document.getElementById('studioTitle');
  var studioGlow = document.getElementById('studioGlow');

  // progress thresholds -> which stage is active
  // 0 prompt, 1 think, 2 title, 3 flowchart, 4 diagram, 5 explanation
  var bounds = [0.00, 0.13, 0.30, 0.46, 0.62, 0.80, 1.01];
  var titles = ['Reading your doubt', 'Thinking it through', 'From doubt to deck', 'From doubt to deck', 'From doubt to deck', 'Your lesson is ready'];

  function setStage(idx) {
    stages.forEach(function (st) {
      st.classList.toggle('active', parseInt(st.getAttribute('data-stage'), 10) === idx);
    });
    railSteps.forEach(function (r) {
      var rv = parseInt(r.getAttribute('data-rail'), 10);
      r.classList.toggle('active', rv === idx);
      r.classList.toggle('passed', rv < idx);
    });
    if (studioTitle) studioTitle.textContent = titles[idx] || titles[0];
  }

  function studioScroll() {
    if (!studio) return;
    var rect = studio.getBoundingClientRect();
    var total = studio.offsetHeight - window.innerHeight;
    var p = Math.min(1, Math.max(0, (-rect.top) / total));

    // determine stage from bounds
    var idx = 0;
    for (var k = 0; k < bounds.length - 1; k++) {
      if (p >= bounds[k] && p < bounds[k + 1]) { idx = k; break; }
    }
    setStage(idx);

    // think sub-steps light up by absolute progress
    thinkLis.forEach(function (li) {
      li.classList.toggle('done', p >= parseFloat(li.getAttribute('data-t')));
    });

    // glow intensifies as deck completes
    if (studioGlow) studioGlow.style.opacity = (0.4 + p * 0.6).toFixed(2);
  }
  window.addEventListener('scroll', studioScroll, { passive: true });
  window.addEventListener('resize', studioScroll);
  studioScroll();

  /* ===================================================================
     HOW IT WORKS — spine fill + node lighting
     =================================================================== */
  var howTimeline = document.getElementById('howTimeline');
  var howFill = document.getElementById('howFill');
  var howSteps = Array.prototype.slice.call(document.querySelectorAll('.how-step'));
  function howScroll() {
    if (!howTimeline) return;
    var rect = howTimeline.getBoundingClientRect();
    var centerY = window.innerHeight * 0.62;
    var fillPx = Math.min(rect.height, Math.max(0, centerY - rect.top));
    if (howFill) howFill.style.height = fillPx + 'px';
    howSteps.forEach(function (st) {
      var n = st.querySelector('.how-step__node');
      var nr = n.getBoundingClientRect();
      if (nr.top + nr.height * 0.5 <= centerY) st.classList.add('lit');
      else st.classList.remove('lit');
    });
  }
  window.addEventListener('scroll', howScroll, { passive: true });
  window.addEventListener('resize', howScroll);
  howScroll();

  /* ===================================================================
     NARRATION player
     =================================================================== */
  var playBtn = document.getElementById('playBtn');
  var playIcon = document.getElementById('playIcon');
  var wave = document.getElementById('playerWave');
  var cap = document.getElementById('narrateCap');
  var playing = false, waveTimer = null, capTimer = null;

  var lines = [
    'Sunlight hits the leaf and <span class="hl">chlorophyll</span> \u2014 the green pigment \u2014 soaks up that energy to power the whole reaction.',
    'That energy <span class="hl">splits water</span> into hydrogen and oxygen, and the oxygen is released into the air we breathe.',
    'The hydrogen then joins with <span class="hl">carbon dioxide</span> to build glucose \u2014 the sugar that feeds the plant.'
  ];
  var lineIdx = 0;

  if (wave) {
    for (var w = 0; w < 40; w++) wave.appendChild(document.createElement('span'));
  }
  var waveBars = wave ? Array.prototype.slice.call(wave.children) : [];

  function animateWave() {
    waveBars.forEach(function (b) {
      var h = playing ? (15 + Math.random() * 85) : 20;
      b.style.height = h + '%';
      b.classList.toggle('on', playing && Math.random() > 0.55);
    });
  }

  function setPlaying(on) {
    playing = on;
    playIcon.innerHTML = on
      ? '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>'
      : '<path d="M8 5v14l11-7z"/>';
    if (on) {
      waveTimer = setInterval(animateWave, 130);
      capTimer = setInterval(function () {
        lineIdx = (lineIdx + 1) % lines.length;
        cap.style.opacity = 0;
        setTimeout(function () { cap.innerHTML = lines[lineIdx]; cap.style.opacity = 1; }, 220);
      }, 3200);
    } else {
      clearInterval(waveTimer); clearInterval(capTimer);
      animateWave();
    }
  }
  if (cap) cap.style.transition = 'opacity 0.25s ease';
  if (playBtn) playBtn.addEventListener('click', function () { setPlaying(!playing); });
  animateWave();

  /* ===================================================================
     DEPTH slider
     =================================================================== */
  var range = document.getElementById('depthRange');
  var fill = document.getElementById('depthFill');
  var tag = document.getElementById('depthTag');
  var text = document.getElementById('depthText');
  var lvButtons = Array.prototype.slice.call(document.querySelectorAll('#depthLevels button'));

  var depths = [
    {
      tag: 'Like I\u2019m 5',
      mono: false,
      html: 'Plants make their own food! A leaf catches sunlight and mixes it with water and air to cook up sugar \u2014 and breathes out the oxygen that we need to live.'
    },
    {
      tag: 'Class 10',
      mono: false,
      html: 'Photosynthesis converts light energy into chemical energy. Chlorophyll in the leaves absorbs sunlight to split water and combine carbon dioxide into glucose, releasing oxygen as a by-product.'
    },
    {
      tag: 'Exam-ready',
      mono: true,
      html: '<span class="v">6CO\u2082 + 6H\u2082O + light \u2192 C\u2086H\u2081\u2082O\u2086 + 6O\u2082</span>. Light-dependent reactions in the thylakoid generate ATP and NADPH, which drive the Calvin cycle in the stroma to fix carbon into glucose.'
    }
  ];

  var defaultDepth = parseInt(document.body.getAttribute('data-depth') || '0', 10);

  function applyDepth(lv) {
    lv = Math.max(0, Math.min(2, lv));
    var d = depths[lv];
    tag.textContent = d.tag;
    text.classList.toggle('mono', d.mono);
    text.style.opacity = 0;
    setTimeout(function () { text.innerHTML = d.html; text.style.opacity = 1; }, 160);
    fill.style.width = (lv / 2 * 100) + '%';
    lvButtons.forEach(function (b) { b.classList.toggle('active', parseInt(b.getAttribute('data-lv'), 10) === lv); });
    if (range.value != lv) range.value = lv;
  }
  if (text) text.style.transition = 'opacity 0.2s ease';
  if (range) range.addEventListener('input', function () { applyDepth(parseInt(range.value, 10)); });
  lvButtons.forEach(function (b) {
    b.addEventListener('click', function () { applyDepth(parseInt(b.getAttribute('data-lv'), 10)); });
  });
  if (range) applyDepth(defaultDepth);

})();
