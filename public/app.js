// app.js — Omkar Hub dashboard
const $ = (id) => document.getElementById(id);
const LANG_CODE = {
  English: 'en-US', Hindi: 'hi-IN', Kannada: 'kn-IN',
  Hinglish: 'hi-IN', Kanglish: 'kn-IN', Auto: 'en-US',
};

let me = null, currentLesson = null, slideIx = 0, narrating = false, narrationPaused = false, narrationIndex = 0;

/* ---------- boot ---------- */
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
fetch('/api/me').then(r => r.json()).then(d => {
  if (!d.user) return (location.href = '/login.html');
  me = d.user;
  const first = (me.name || 'Student').split(' ')[0];
  $('userName').textContent = me.name;
  $('userInitial').textContent = (me.name || 'S')[0].toUpperCase();
  if ($('userEmailSmall')) $('userEmailSmall').textContent = me.email;
  if ($('setEmail')) $('setEmail').textContent = me.email;
  if ($('greetTitle')) $('greetTitle').innerHTML = `${greeting()}, ${first}.<br>What are you <em>stuck</em> on?`;
  loadLibrary(); // populate stats on first load
});

/* ---------- sidebar views ---------- */
document.querySelectorAll('.side__link').forEach(b => b.onclick = () => {
  const v = b.dataset.view;
  // Debate opens the full-screen Debate Arena overlay (create/join/AI-solo) OVER the
  // dashboard — it doesn't switch the main view, so closing it returns you where you were.
  if (v === 'debate' && window.DebateArena) { window.DebateArena.open(me); return; }
  document.querySelectorAll('.side__link').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  document.querySelectorAll('.view').forEach(s => s.classList.remove('active'));
  $('view-' + v).classList.add('active');
  // Open every section from the TOP. A fixed-height view (like Competitions) won't stretch
  // to clamp a leftover scroll offset, so reset now AND after layout settles (next frame).
  scrollToTop();
  requestAnimationFrame(scrollToTop);
  setTimeout(scrollToTop, 120);          // catch any late async scroll (map/focus)
  if (v === 'library') loadLibrary();
});
function scrollToTop() {
  window.scrollTo(0, 0);
  if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
  document.querySelector('.main')?.scrollTo?.(0, 0);
}
document.querySelectorAll('#logoutBtn, #logoutBtn2').forEach(b => b && (b.onclick = () =>
  fetch('/api/logout', { method: 'POST' }).then(() => (location.href = '/'))));

/* ---------- quick-start chips ---------- */
document.querySelectorAll('.chip').forEach(c => c.onclick = () => {
  $('doubtText').value = c.dataset.q;
  $('doubtText').focus({ preventScroll: true });
});

/* ---------- input modes ---------- */
let mode = 'text';
let pendingImage = null;        // photo data URL
let pendingPdf = null;          // { name, text, pages }
let recorder = null, chunks = [];

function clearUploads() {
  pendingImage = null;
  pendingPdf = null;
  if ($('uploadPrev')) { $('uploadPrev').hidden = true; $('uploadPrev').innerHTML = ''; }
}

function setMode(m) {
  mode = m;
  document.querySelectorAll('#modeSeg .seg').forEach(x => x.classList.toggle('active', x.dataset.mode === m));
  // show the voice recorder bar only in voice mode; stop any recording when leaving it
  if ($('voiceBar')) $('voiceBar').hidden = (m !== 'voice');
  if (m !== 'voice' && recorder && recorder.state === 'recording') recorder.stop();
  // the upload button lives INSIDE its tab: Photo tab shows "Upload photo", PDF tab shows "Upload PDF"
  if ($('attachBar')) $('attachBar').hidden = (m !== 'photo' && m !== 'pdf');
  if ($('attachPhoto')) $('attachPhoto').hidden = (m !== 'photo');
  if ($('attachPdf')) $('attachPdf').hidden = (m !== 'pdf');
  if ($('attachHint')) $('attachHint').textContent =
      m === 'photo' ? 'Snap or upload a photo of the question — the AI reads it.'
    : m === 'pdf'   ? 'Upload your notes or a worksheet PDF — the AI reads it.'
    : '';
  $('doubtText').placeholder =
      m === 'photo' ? 'Photo selected — press Build, or add a note here…'
    : m === 'pdf'   ? 'PDF selected — press Build, or add a note here…'
    : m === 'voice' ? 'Tap “Start recording”, speak your doubt, then tap stop.'
    :                 'e.g. How does photosynthesis actually work?';
}

document.querySelectorAll('#modeSeg .seg').forEach(b => b.onclick = () => {
  // Switching to Photo/PDF only reveals its "Upload …" button — the file picker opens
  // when the user clicks that button, not the moment they tap the tab.
  setMode(b.dataset.mode);
  // voice mode: do NOT auto-start — the user presses “Start recording” in the voice bar
});

// the always-visible "Upload photo / Upload PDF" buttons open the picker directly
$('attachPhoto') && ($('attachPhoto').onclick = () => { setMode('photo'); $('photoInput').click(); });
$('attachPdf') && ($('attachPdf').onclick = () => { setMode('pdf'); $('pdfInput').click(); });

/* photo — show a preview of what was uploaded */
$('photoInput').onchange = (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    pendingPdf = null;
    pendingImage = r.result;
    if ($('uploadPrev')) {
      $('uploadPrev').hidden = false;
      $('uploadPrev').innerHTML =
        `<div class="uploadprev__row">
           <img class="uploadprev__img" src="${pendingImage}" alt="uploaded photo">
           <div class="uploadprev__meta"><b>${f.name}</b><span>Photo ready — press “Build my lesson”.</span></div>
           <button class="uploadprev__x" id="uploadClear" title="Remove">✕</button>
         </div>`;
      $('uploadClear').onclick = clearUploads;
    }
    status('');
  };
  r.readAsDataURL(f);
};

/* pdf — read the text in the browser (pdf.js), preview filename + page count */
let pdfLibPromise = null;
function loadPdfLib() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (pdfLibPromise) return pdfLibPromise;
  pdfLibPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      resolve(window.pdfjsLib);
    };
    s.onerror = () => reject(new Error('Could not load the PDF reader. Check your connection.'));
    document.head.appendChild(s);
  });
  return pdfLibPromise;
}

$('pdfInput').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  status('Reading your PDF…');
  try {
    const lib = await loadPdfLib();
    const buf = await f.arrayBuffer();
    const pdf = await lib.getDocument({ data: buf }).promise;
    let text = '';
    const maxPages = Math.min(pdf.numPages, 30);
    for (let p = 1; p <= maxPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      text += content.items.map(it => it.str).join(' ') + '\n';
    }
    text = text.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
    if (!text) throw new Error('This PDF has no selectable text (looks scanned). Try Photo mode instead.');
    pendingImage = null;
    pendingPdf = { name: f.name, text, pages: pdf.numPages };
    if ($('uploadPrev')) {
      $('uploadPrev').hidden = false;
      $('uploadPrev').innerHTML =
        `<div class="uploadprev__row">
           <span class="uploadprev__pdf">PDF</span>
           <div class="uploadprev__meta"><b>${f.name}</b><span>${pdf.numPages} page${pdf.numPages > 1 ? 's' : ''} · ${text.length.toLocaleString()} characters read — press “Build my lesson”.</span></div>
           <button class="uploadprev__x" id="uploadClear" title="Remove">✕</button>
         </div>`;
      $('uploadClear').onclick = clearUploads;
    }
    status('');
  } catch (err) {
    clearUploads();
    status('⚠ ' + err.message);
  }
};

/* voice — explicit start/stop button (no auto-start) */
async function toggleRecording() {
  if (recorder && recorder.state === 'recording') { recorder.stop(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recorder = new MediaRecorder(stream);
    chunks = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      if ($('askRec')) $('askRec').classList.remove('rec');
      if ($('askRecLbl')) $('askRecLbl').textContent = 'Start recording';
      status('Transcribing your voice…');
      const blob = new Blob(chunks, { type: 'audio/webm' });
      const fd = new FormData();
      fd.append('audio', blob, 'doubt.webm');
      fd.append('language', $('language').value); // hint: keeps Kannada/Hindi from being mis-read
      try {
        const res = await fetch('/api/stt', { method: 'POST', body: fd });
        const d = await res.json();
        if (!d.text) return status(d.error || 'Could not catch that — try again.');
        $('doubtText').value = d.text;
        status(`🎧 Heard: "${d.text.slice(0, 60)}${d.text.length > 60 ? '…' : ''}" — building…`);
        buildLesson({ fromVoice: true }); // voice-first: build + narrate automatically
      } catch (e) { status('⚠ ' + e.message); }
    };
    recorder.start();
    if ($('askRec')) $('askRec').classList.add('rec');
    if ($('askRecLbl')) $('askRecLbl').textContent = 'Stop & build';
    status('🎙️ Recording… tap “Stop & build” when you’re done.');
  } catch { status('Microphone blocked — allow mic access or type instead.'); }
}
$('askRec') && ($('askRec').onclick = toggleRecording);

function status(t) { $('askStatus').textContent = t || ''; }

/* ---------- ask -> lesson ---------- */
$('askSend').onclick = () => buildLesson({ fromVoice: false });

async function buildLesson({ fromVoice }) {
  const note = $('doubtText').value.trim();
  // a PDF turns into the doubt text (plus any note the student typed)
  let doubt = note;
  if (pendingPdf) {
    const body = pendingPdf.text.slice(0, 12000); // keep the request a sane size
    doubt = (note ? note + '\n\n' : '') + `Explain the content of this document (from "${pendingPdf.name}"):\n${body}`;
  }
  if (!doubt && !pendingImage) return status('Type, snap, upload a PDF, or say a doubt first.');
  $('askSend').disabled = true;
  $('lesson').hidden = true;
  $('gen').hidden = false;
  ['gs0', 'gs1', 'gs2', 'gs3'].forEach((id, i) => setTimeout(() => $(id)?.classList.add('done'), 350 * (i + 1)));
  try {
    const res = await fetch('/api/doubt', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doubt, language: $('language').value, imageDataUrl: pendingImage }),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error);
    renderLesson(d.lesson);
    clearUploads();
    loadLibrary(); // refresh stats + library
    status('');
    if (fromVoice) setTimeout(startNarration, 600); // voice-first: speak the answer back
  } catch (e) {
    status('⚠ ' + e.message);
  } finally {
    $('gen').hidden = true;
    ['gs0', 'gs1', 'gs2', 'gs3'].forEach(id => $(id)?.classList.remove('done'));
    $('askSend').disabled = false;
  }
}

/* ---------- render deck ---------- */
function preloadSingleImage(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    if (!url) return resolve(false);
    const img = new Image();
    let done = false;
    const timer = setTimeout(() => {
      if (!done) { done = true; resolve(false); }
    }, timeoutMs);

    img.onload = () => {
      if (!done) { done = true; clearTimeout(timer); resolve(true); }
    };
    img.onerror = () => {
      if (!done) { done = true; clearTimeout(timer); resolve(false); }
    };
    img.src = url;
  });
}

async function preloadAllSlideImages(lesson) {
  if (!lesson || !Array.isArray(lesson.slides)) return;
  currentLesson = lesson;
  const slides = lesson.slides;
  
  status('Pre-loading topic photos…');

  // Identify slides that should have photos (LLM hasPhoto: true or default first 3-4 slides)
  let photoSlides = slides.filter(s => s.hasPhoto === true);
  if (photoSlides.length < 3) {
    photoSlides = slides.filter((s, i) => i === 0 || s.type === 'diagram' || i === 2).slice(0, 4);
  }

  // Pre-load photo slides concurrently in parallel using Promise.all
  await Promise.all(photoSlides.map(async (s, i) => {
    const kw = s.searchKeyword || s.heading || currentLesson?.title || 'Education';
    const cleanKw = `${kw} ${currentLesson?.title || ''}`.replace(/[^a-zA-Z0-9 ]/g, '').split(' ').filter(Boolean).slice(0, 2).join(',');
    const primaryUrl = getSlideImageUrl(s, i);
    const unsplashUrl = `https://source.unsplash.com/600x400/?${encodeURIComponent(cleanKw || 'education')}`;

    const ok = await preloadSingleImage(primaryUrl, 1800);
    if (ok) {
      s.imageUrl = primaryUrl;
      s.hasLoadedPhoto = true;
    } else {
      const fallbackOk = await preloadSingleImage(unsplashUrl, 1200);
      if (fallbackOk) {
        s.imageUrl = unsplashUrl;
        s.hasLoadedPhoto = true;
      } else {
        s.hasLoadedPhoto = false;
      }
    }
  }));

  // Non-photo slides set hasLoadedPhoto = false so they render full-width with zero image box
  slides.forEach(s => {
    if (!photoSlides.includes(s)) s.hasLoadedPhoto = false;
  });
}

async function renderLesson(lesson) {
  currentLesson = lesson; slideIx = 0;
  await preloadAllSlideImages(lesson);

  $('lesson').hidden = false;
  if ($('lessonSubject')) $('lessonSubject').textContent = lesson.subject || 'Lesson';
  $('deckRail').innerHTML = (lesson.slides || []).map((s, i) =>
    `<button class="rail-pip ${i === 0 ? 'active' : ''}" data-i="${i}">${i + 1}. ${s.type}</button>`).join('');
  $('deckRail').querySelectorAll('.rail-pip').forEach(p => p.onclick = () => changeSlideManually(+p.dataset.i));
  showSlide(0);
  $('lesson').scrollIntoView({ behavior: 'smooth' });
}

function getSlideImageUrl(slide, index) {
  if (slide.imageUrl) return slide.imageUrl;
  const kw = slide.searchKeyword || slide.heading || 'Topic';
  const mainTopic = currentLesson?.title || kw;
  const subject = currentLesson?.subject || 'Science';
  
  const seed = (index + 1) * 31415 + kw.length * 17;
  const prompt = `${kw}, ${mainTopic}, ${subject} technical educational photo illustration`;
  
  slide.imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=600&height=400&nologo=true&seed=${seed}`;
  return slide.imageUrl;
}

function getSubjectDomainIcon(subject = '', heading = '') {
  const text = (subject + ' ' + heading).toLowerCase();
  if (text.includes('wheel') || text.includes('turbine') || text.includes('engine') || text.includes('phys') || text.includes('mech')) return '⚙️';
  if (text.includes('chem') || text.includes('reaction') || text.includes('acid') || text.includes('bond')) return '🧪';
  if (text.includes('bio') || text.includes('cell') || text.includes('heart') || text.includes('plant')) return '🧬';
  if (text.includes('comp') || text.includes('code') || text.includes('cpu') || text.includes('circuit')) return '💻';
  return '📌';
}

function renderVisualSchematic(heading, parts = [], subject = '') {
  const icon = getSubjectDomainIcon(subject, heading);

  // ===== DYNAMIC TOPIC-AWARE SVG DIAGRAM GENERATOR =====
  // Reads the ACTUAL AI-generated parts and renders an accurate labeled radial/grid diagram
  // matching ANY topic (Lathe Machine, Solar Panel, Heart, CPU, etc.)
  const colors = ['#ffe066', '#80ffea', '#a8ffb2', '#ff928b', '#c4bcff', '#ffba6b'];
  const fills  = ['rgba(255,224,102,0.15)', 'rgba(128,255,234,0.15)', 'rgba(168,255,178,0.15)', 'rgba(255,146,139,0.15)', 'rgba(196,188,255,0.15)', 'rgba(255,186,107,0.15)'];
  const cx = 160, cy = 100;
  const partCount = Math.min(parts.length, 6);
  
  let nodesMarkup = '';
  let linesMarkup = '';
  
  if (partCount <= 4) {
    // Radial layout — parts placed at compass points around center
    const positions = [
      { x: 50, y: 35 },   // top-left
      { x: 270, y: 35 },  // top-right
      { x: 50, y: 155 },  // bottom-left
      { x: 270, y: 155 }, // bottom-right
    ];
    for (let i = 0; i < partCount; i++) {
      const p = positions[i];
      const col = colors[i % colors.length];
      const fill = fills[i % fills.length];
      const label = (parts[i].label || '').slice(0, 16);
      // Connector line from center to node
      linesMarkup += `<line x1="${cx}" y1="${cy}" x2="${p.x}" y2="${p.y}" stroke="${col}" stroke-width="2" stroke-dasharray="5,3" opacity="0.7"/>`;
      // Node circle + label
      nodesMarkup += `
        <circle cx="${p.x}" cy="${p.y}" r="22" stroke="${col}" stroke-width="2.5" fill="${fill}"/>
        <text x="${p.x}" y="${p.y + 1}" text-anchor="middle" dominant-baseline="middle" fill="${col}" font-size="9" font-weight="bold" font-family="'Patrick Hand', cursive">${label}</text>
        <text x="${p.x}" y="${p.y + 34}" text-anchor="middle" fill="rgba(255,255,255,0.6)" font-size="8" font-family="'Patrick Hand', cursive">${(parts[i].desc || '').slice(0, 28)}</text>`;
    }
  } else {
    // Grid layout — 3 on top row, rest on bottom row
    const topCount = Math.ceil(partCount / 2);
    const botCount = partCount - topCount;
    for (let i = 0; i < partCount; i++) {
      const isTop = i < topCount;
      const row = isTop ? 0 : 1;
      const col_idx = isTop ? i : i - topCount;
      const totalInRow = isTop ? topCount : botCount;
      const spacing = 280 / (totalInRow + 1);
      const px = 20 + spacing * (col_idx + 1);
      const py = row === 0 ? 38 : 162;
      const col = colors[i % colors.length];
      const fill = fills[i % fills.length];
      const label = (parts[i].label || '').slice(0, 14);
      linesMarkup += `<line x1="${cx}" y1="${cy}" x2="${px}" y2="${py}" stroke="${col}" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.6"/>`;
      nodesMarkup += `
        <circle cx="${px}" cy="${py}" r="20" stroke="${col}" stroke-width="2.5" fill="${fill}"/>
        <text x="${px}" y="${py + 1}" text-anchor="middle" dominant-baseline="middle" fill="${col}" font-size="8" font-weight="bold" font-family="'Patrick Hand', cursive">${label}</text>`;
    }
  }
  
  const shortTitle = (heading || 'System').slice(0, 20);
  const schematicDiagramSvg = `
    <svg viewBox="0 0 320 200" fill="none" style="width:100%; max-height:220px; margin:auto; display:block;">
      ${linesMarkup}
      <!-- Central Hub -->
      <rect x="${cx - 52}" y="${cy - 22}" width="104" height="44" rx="12" stroke="#ffe066" stroke-width="2.5" fill="rgba(255,224,102,0.12)"/>
      <text x="${cx}" y="${cy + 2}" text-anchor="middle" dominant-baseline="middle" fill="#ffe066" font-size="11" font-weight="bold" font-family="'Caveat', cursive">${shortTitle}</text>
      ${nodesMarkup}
    </svg>`;

  return `
    <div class="diax-schematic">
      <div class="diax-schematic__graphic">
        ${schematicDiagramSvg}
      </div>
      <div class="diax-schematic__hub">
        <span class="diax-schematic__icon">${icon}</span>
        <b class="diax-schematic__title">${heading}</b>
      </div>
      <div class="diax-schematic__parts">
        ${parts.map((p, i) => `
          <div class="diax-schematic__card c${i % 4}">
            <div class="diax-schematic__pin">${i + 1}</div>
            <div class="diax-schematic__content">
              <b>${p.label}</b>
              <span>${p.desc}</span>
            </div>
          </div>
        `).join('')}
      </div>
    </div>`;
}

function slideHTML(s, index) {
  if (!s) return '';
  const showImg = Boolean(s.hasLoadedPhoto && s.imageUrl);
  const imgTag = showImg ? `
    <div class="slide-canvas__imgwrap">
      <img class="slide-canvas__img" src="${s.imageUrl}" alt="${s.heading || 'Slide topic picture'}" loading="eager" />
    </div>` : '';

  const gridClass = showImg ? 'slide-canvas__grid' : 'slide-canvas__grid slide-canvas__grid--full';

  if (s.type === 'title') {
    return `<div class="${gridClass}">
      <div class="slide-canvas__main">
        <span class="kicker">${currentLesson?.subject || 'Lesson'}</span>
        <h2 class="serif slide-title">${s.heading || ''}</h2>
        <p class="slide-sub">${s.subtitle || ''}</p>
      </div>
      ${imgTag}
    </div>`;
  }

  if (s.type === 'flowchart') {
    return `<div class="${gridClass}">
      <div class="slide-canvas__main">
        <span class="kicker">Flowchart</span>
        <h3>${s.heading || ''}</h3>
        <div class="flowx">
          ${(s.steps || []).map((st, i, a) =>
            `<div class="flowx__node ${i % 2 ? 'alt' : ''}"><span class="flowx__num">${i + 1}</span><span>${st}</span></div>${i < a.length - 1 ? '<span class="flowx__arr">→</span>' : ''}`
          ).join('')}
        </div>
      </div>
      ${imgTag}
    </div>`;
  }

  if (s.type === 'diagram') {
    const headingLower = (s.heading || '').toLowerCase();
    const parts = s.parts || [];

    let diagramMarkup = '';
    if (headingLower.includes('cycle') || headingLower.includes('flow') || headingLower.includes('process') || headingLower.includes('loop')) {
      diagramMarkup = `
        <div class="diax-cycle">
          <div class="diax-cycle__center"><span>${s.heading}</span></div>
          <div class="diax-cycle__nodes">
            ${parts.map((p, i) => `
              <div class="diax-cycle__node c${i % 4}">
                <div class="diax-cycle__badge">${i + 1}</div>
                <div class="diax-cycle__text"><b>${p.label}</b><span>${p.desc}</span></div>
              </div>
            `).join('')}
          </div>
        </div>`;
    } else if (headingLower.includes('versus') || headingLower.includes('vs') || headingLower.includes('compare') || headingLower.includes('difference')) {
      diagramMarkup = `
        <div class="diax-compare">
          ${parts.map((p, i) => `
            <div class="diax-compare__col c${i % 4}">
              <div class="diax-compare__head"><b>${p.label}</b></div>
              <div class="diax-compare__body"><p>${p.desc}</p></div>
            </div>
          `).join('')}
        </div>`;
    } else {
      diagramMarkup = renderVisualSchematic(s.heading || '', parts, currentLesson?.subject || '');
    }

    return `<div class="${gridClass}">
      <div class="slide-canvas__main">
        <span class="kicker">Visual Diagram Schematic</span>
        <h3>${s.heading || ''}</h3>
        ${diagramMarkup}
      </div>
      ${imgTag}
    </div>`;
  }

  if (s.type === 'explanation') {
    return `<div class="${gridClass}">
      <div class="slide-canvas__main">
        <span class="kicker">In plain words</span>
        <h3>${s.heading || ''}</h3>
        <div class="expx">
          ${(s.points || []).map((p, i) =>
            `<div class="expx__pt"><span class="n">${i + 1}</span><div><b>${p.bold || ''}</b><p>${p.text || p}</p></div></div>`
          ).join('')}
        </div>
      </div>
      ${imgTag}
    </div>`;
  }

  return `<div class="${gridClass}">
    <div class="slide-canvas__main">
      <span class="kicker">${currentLesson?.subject || 'Lesson'}</span>
      <h3>${s.heading || 'Slide'}</h3>
      <p class="slide-sub">${s.subtitle || ''}</p>
    </div>
    ${imgTag}
  </div>`;
}

function showSlide(i) {
  const slides = currentLesson.slides || [];
  slideIx = Math.max(0, Math.min(slides.length - 1, i));
  $('deckStage').innerHTML = `<div class="slide-canvas">${slideHTML(slides[slideIx], slideIx)}</div>`;
  $('slideCount').textContent = `${slideIx + 1} / ${slides.length}`;
  $('deckRail').querySelectorAll('.rail-pip').forEach((p, ix) => p.classList.toggle('active', ix === slideIx));
}

function changeSlideManually(i) {
  if (narrating) {
    stopNarration();
  }
  showSlide(i);
}

$('prevSlide').onclick = () => changeSlideManually(slideIx - 1);
$('nextSlide').onclick = () => changeSlideManually(slideIx + 1);

/* ---------- tutor narration (Fish Audio / MsEdgeTTS / browser voices, free) ---------- */
let currentAudio = null;

$('tutorPlay').onclick = () => {
  if (narrating) {
    if (narrationPaused) {
      resumeNarration();
    } else {
      pauseNarration();
    }
  } else {
    narrating = true;
    narrationPaused = false;
    narrateSlide(slideIx);
  }
};

/* ---------- 🎓 Learn with AI Teacher — opens the immersive classroom overlay ---------- */
let _classroomLoading = null;
function loadClassroom() {
  if (window.OmkarClassroom) return Promise.resolve();
  if (_classroomLoading) return _classroomLoading;
  _classroomLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'classroom.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the AI Teacher.'));
    document.head.appendChild(s);
  });
  return _classroomLoading;
}
const _learnBtn = $('learnWithTeacher');
if (_learnBtn) _learnBtn.onclick = async () => {
  if (!currentLesson) return;
  if (narrating && typeof stopNarration === 'function') stopNarration(); // hand off from the quick-answer tutor
  const prev = _learnBtn.innerHTML;
  _learnBtn.disabled = true;
  _learnBtn.innerHTML = '<span class="emo">🎓</span><span>Entering classroom…</span>';
  try {
    await loadClassroom();
    // Notes language = what the slides are written in. Teacher language = what she SPEAKS.
    // They're independent: English notes with a Kannada-speaking teacher is a valid combo.
    const notesLang = currentLesson.language || $('language').value || 'English';
    const picked = $('teacherLang') ? $('teacherLang').value : '';
    window.OmkarClassroom.open(currentLesson, picked || notesLang, notesLang);
  } catch (e) {
    alert(e.message || 'Could not open the AI Teacher.');
  } finally {
    _learnBtn.disabled = false;
    _learnBtn.innerHTML = prev;
  }
};

function pickVoice(code) {
  const vs = speechSynthesis.getVoices();
  return vs.find(v => v.lang === code) || vs.find(v => v.lang.startsWith(code.split('-')[0])) || null;
}

function speakBrowser(text, code, callback) {
  if (!narrating || narrationPaused) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = code;
  const v = pickVoice(code);
  if (v) u.voice = v;
  u.onend = callback;
  u.onerror = callback;
  speechSynthesis.speak(u);
}

// language label -> BCP-47 code for the browser-voice fallback
function codeFor(label) {
  return LANG_CODE[label] || LANG_CODE[$('language').value] || 'en-US';
}

// Speak ONE line in a specific language: try backend neural TTS (Cartesia, which
// honours the language code), and fall back to the browser voice. done() fires when finished.
async function speakLine(text, langLabel, done) {
  if (!narrating || narrationPaused) return;
  const code = codeFor(langLabel);
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, language: langLabel, lessonTitle: currentLesson?.title || '' }),
    });
    if (res.ok) {
      const ct = res.headers.get('Content-Type') || '';
      if (ct.includes('audio')) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        currentAudio = new Audio(url);
        currentAudio.onended = () => { URL.revokeObjectURL(url); done(); };
        currentAudio.onerror = () => speakBrowser(text, code, done);
        if (!narrationPaused && narrating) {
          currentAudio.play().catch(() => speakBrowser(text, code, done));
        }
        return;
      }
    }
  } catch (e) { console.warn('Backend TTS failed, falling back to browser:', e); }
  speakBrowser(text, code, done);
}

function narrateSlide(index) {
  if (!narrating || narrationPaused) return;
  const lines = currentLesson?.narration || [];
  if (index >= lines.length) {
    stopNarration();
    return;
  }
  narrationIndex = index;
  showSlide(index);
  $('tutorCap').textContent = lines[index];
  
  $('tutorPlay').innerHTML = '<svg viewBox="0 0 24 24" fill="#fff"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';

  const lessonLang = currentLesson.language || $('language').value;
  speakLine(lines[index], lessonLang, () => {
    if (narrating && !narrationPaused) {
      narrateSlide(index + 1);
    }
  });
}

function startNarration() {
  narrating = true;
  narrationPaused = false;
  narrateSlide(slideIx);
}

function pauseNarration() {
  narrationPaused = true;
  if (currentAudio) {
    currentAudio.pause();
  }
  if (speechSynthesis.speaking) {
    speechSynthesis.pause();
  }
  $('tutorPlay').innerHTML = '<svg viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg>';
  $('tutorCap').textContent = 'Paused — press play to resume.';
}

function resumeNarration() {
  narrationPaused = false;
  $('tutorPlay').innerHTML = '<svg viewBox="0 0 24 24" fill="#fff"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
  
  if (currentAudio) {
    currentAudio.play().catch(() => {
      const lessonLang = currentLesson.language || $('language').value;
      const lines = currentLesson.narration;
      speakBrowser(lines[narrationIndex], codeFor(lessonLang), () => {
        if (narrating && !narrationPaused) {
          narrateSlide(narrationIndex + 1);
        }
      });
    });
  } else if (speechSynthesis.paused) {
    speechSynthesis.resume();
  } else {
    narrateSlide(narrationIndex);
  }
}

function stopNarration() {
  narrating = false;
  narrationPaused = false;
  speechSynthesis.cancel();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  $('tutorPlay').innerHTML = '<svg viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg>';
  $('tutorCap').textContent = 'Paused — press play to continue.';
}

/* ---------- download deck (locally built: designs + flowcharts + diagrams + images) ---------- */
$('dlPptx').onclick = async () => {
  if (!currentLesson) return;
  const btn = $('dlPptx');
  const label = btn.querySelector('span') || btn;
  const original = label.textContent;
  label.textContent = 'Designing deck…';
  btn.disabled = true;
  try {
    const res = await fetch('/api/deck-file', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lesson: currentLesson }),
    });
    if (!res.ok) {
      let msg = 'Could not build the deck.';
      try { msg = (await res.json()).error || msg; } catch {}
      status(msg);
    } else {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = ((currentLesson.title || 'lesson').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'lesson') + '.pptx';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      status('Deck ready — designed with flowcharts, diagrams & images ✓');
    }
  } catch (e) {
    status('Deck export failed: ' + (e.message || e));
  } finally {
    label.textContent = original;
    btn.disabled = false;
  }
};

/* ---------- library + stats + streak ---------- */
const SUBJECT_CLASS = (s = '') => {
  s = s.toLowerCase();
  if (s.includes('phys')) return 'phy';
  if (s.includes('math')) return 'math';
  if (s.includes('bio')) return 'bio';
  if (s.includes('chem')) return 'chem';
  return '';
};

/* Open a saved doubt: re-render its deck and replay the slides + voice. */
function openSavedDoubt(rec) {
  document.querySelector('.side__link[data-view="ask"]').click();
  if (!rec || !rec.lesson || !rec.lesson.slides?.length) {
    status('This doubt was saved before full replay existed — ask it again to rebuild the deck and voice.');
    return;
  }
  stopNarration();
  renderLesson(rec.lesson);
  status('');
  // the card click is a user gesture, so the tutor can start speaking right away
  setTimeout(startNarration, 500);
}

async function loadLibrary() {
  const d = await (await fetch('/api/doubts')).json();
  const doubts = d.doubts || [];

  // library cards — each card reopens the full saved deck and re-narrates it
  if ($('doubtsList')) {
    $('doubtsList').innerHTML = doubts.length
      ? doubts.map((x, i) => `<article class="doubt ${SUBJECT_CLASS(x.subject)}" data-i="${i}" role="button" tabindex="0" title="Open this lesson — replays the slides with voice">
          <span class="doubt__tag">${x.subject || 'Topic'}</span>
          <h4>${x.title || x.doubt}</h4>
          <div class="doubt__meta">${x.slides || '–'} slides · ${new Date(x.at).toLocaleDateString()}</div>
          <div class="doubt__open">
            <svg viewBox="0 0 24 24" fill="none"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>
            Open &amp; play
          </div>
        </article>`).join('')
      : '<p>No doubts yet — ask your first one and it\'ll be saved here forever.</p>';

    // attach open handlers
    $('doubtsList').querySelectorAll('.doubt[data-i]').forEach(card => {
      const open = () => openSavedDoubt(doubts[+card.dataset.i]);
      card.addEventListener('click', open);
      card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
  }

  // streak = distinct days with activity (min 1)
  const days = new Set(doubts.map(x => x.at?.slice(0, 10)));
  const streak = Math.max(1, days.size);

  if ($('statDoubts')) $('statDoubts').textContent = doubts.length;
  if ($('statStreak')) $('statStreak').textContent = streak;
  if ($('streakNum')) $('streakNum').textContent = streak;
  if ($('sidePromoText')) $('sidePromoText').textContent = doubts.length
    ? `${streak}-day streak. Keep it going!` : 'Ask one doubt today to start your streak.';

  // last-7-days week grid
  if ($('streakWeek')) {
    const labels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    let html = '';
    for (let i = 6; i >= 0; i--) {
      const dt = new Date(); dt.setDate(dt.getDate() - i);
      const key = dt.toISOString().slice(0, 10);
      html += `<div class="streak__cell"><div class="streak__box ${days.has(key) ? 'on' : ''}"></div><span>${labels[dt.getDay()]}</span></div>`;
    }
    $('streakWeek').innerHTML = html;
  }
}

/* ===================================================================
   FEATURE 1 — PRACTICE (active recall)
   =================================================================== */
let quizState = null; // { title, topic, questions, graded }

// keep the saved-doubts dropdown fresh whenever the library loads
function fillPracticeDoubts(doubts) {
  const sel = $('pracDoubt');
  if (!sel) return;
  sel.innerHTML = '<option value="">— choose —</option>' +
    doubts.map((x, i) => `<option value="${i}">${(x.title || x.doubt || 'Doubt').slice(0, 60)}</option>`).join('');
  sel._doubts = doubts;
}

async function loadPracticeBest() {
  try {
    const d = await (await fetch('/api/practice/history')).json();
    const best = (d.history || []).reduce((m, r) => Math.max(m, r.total ? Math.round((r.score / r.total) * 100) : 0), 0);
    if ($('pracBest')) $('pracBest').textContent = (d.history || []).length ? best + '%' : '—';
  } catch {}
}

function pStatus(t) { if ($('pracStatus')) $('pracStatus').textContent = t || ''; }

async function buildQuiz({ lesson = null, topic = '', language }) {
  $('quizBox').hidden = true;
  $('quizScore').hidden = true;
  $('quizRetry').hidden = true;
  pStatus('Writing your questions…');
  $('pracGo').disabled = true;
  try {
    const res = await fetch('/api/practice', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lesson, topic, language: language || 'Auto' }),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'Failed.');
    quizState = { title: d.quiz.title || 'Practice quiz', topic: topic || (lesson?.title) || '', questions: d.quiz.questions, graded: false };
    renderQuiz();
    pStatus('');
    $('quizBox').scrollIntoView({ behavior: 'smooth' });
  } catch (e) { pStatus('⚠ ' + e.message); }
  finally { $('pracGo').disabled = false; }
}

function renderQuiz() {
  $('quizBox').hidden = false;
  quizState.startTs = Date.now();
  $('quizTitle').textContent = quizState.title;
  $('quizProg').textContent = `${quizState.questions.length} questions`;
  $('quizSubmit').hidden = false;
  $('quizList').innerHTML = quizState.questions.map((q, i) => {
    if (q.type === 'mcq') {
      const opts = q.options.map((o, j) =>
        `<label class="opt"><input type="radio" name="q${i}" value="${j}"><span>${o}</span></label>`).join('');
      return `<div class="qq" data-i="${i}" data-type="mcq">
        <div class="qq__q"><span class="qq__n">${i + 1}</span>${q.question}</div>
        <div class="qq__opts">${opts}</div>
        <div class="qq__fb" hidden></div></div>`;
    }
    return `<div class="qq" data-i="${i}" data-type="short">
      <div class="qq__q"><span class="qq__n">${i + 1}</span>${q.question}</div>
      <textarea class="qq__short" rows="2" placeholder="Type your answer…"></textarea>
      <div class="qq__fb" hidden></div></div>`;
  }).join('');
}

$('quizSubmit') && ($('quizSubmit').onclick = async () => {
  if (!quizState || quizState.graded) return;
  $('quizSubmit').disabled = true;
  let score = 0;
  const total = quizState.questions.length;
  const cards = [...$('quizList').querySelectorAll('.qq')];
  const results = []; // { question, verdict, correct, keyPoints }

  for (const card of cards) {
    const i = +card.dataset.i;
    const q = quizState.questions[i];
    const fb = card.querySelector('.qq__fb');
    fb.hidden = false;

    if (q.type === 'mcq') {
      const picked = card.querySelector(`input[name="q${i}"]:checked`);
      const chosen = picked ? +picked.value : -1;
      const correct = chosen === q.answerIndex;
      if (correct) score++;
      card.querySelectorAll('.opt').forEach((el, j) => {
        if (j === q.answerIndex) el.classList.add('ok');
        else if (j === chosen) el.classList.add('bad');
        el.querySelector('input').disabled = true;
      });
      fb.className = 'qq__fb ' + (correct ? 'good' : 'wrong');
      fb.innerHTML = `<b>${correct ? '✓ Correct' : '✗ Not quite'}</b> ${q.explanation || ''}`;
      results.push({ question: q.question, verdict: correct ? 'correct' : 'wrong', correct, keyPoints: q.explanation || '' });
    } else {
      const ans = card.querySelector('.qq__short').value.trim();
      card.querySelector('.qq__short').disabled = true;
      if (!ans) {
        fb.className = 'qq__fb wrong';
        fb.innerHTML = `<b>✗ No answer</b> ${q.explanation || ''}`;
        results.push({ question: q.question, verdict: 'blank', correct: false, keyPoints: q.answer || q.explanation || '' });
        continue;
      }
      fb.className = 'qq__fb';
      fb.innerHTML = '<span class="qq__grading">Marking your answer…</span>';
      let verdict = 'wrong';
      try {
        const r = await fetch('/api/practice/grade', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: q.question, modelAnswer: q.answer, studentAnswer: ans, language: $('pracLang').value }),
        });
        const d = await r.json();
        const v = d.result;
        verdict = v.verdict;
        if (v.verdict === 'correct') score++;
        else if (v.verdict === 'partial') score += 0.5;
        fb.className = 'qq__fb ' + (v.verdict === 'correct' ? 'good' : v.verdict === 'partial' ? 'partial' : 'wrong');
        fb.innerHTML = `<b>${v.verdict === 'correct' ? '✓ Correct' : v.verdict === 'partial' ? '◐ Partly right' : '✗ Off track'} · ${v.score}/100</b> ${v.feedback}<div class="qq__model"><b>Model answer:</b> ${q.answer}</div>`;
      } catch (e) {
        verdict = 'partial';
        fb.className = 'qq__fb';
        fb.innerHTML = `<b>Model answer:</b> ${q.answer}`;
      }
      results.push({ question: q.question, verdict, correct: verdict === 'correct', keyPoints: q.answer || q.explanation || '' });
    }
  }

  quizState.graded = true;
  const pct = Math.round((score / total) * 100);
  const secs = Math.max(1, Math.round((Date.now() - (quizState.startTs || Date.now())) / 1000));
  const mmss = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const avg = Math.round(secs / total);
  const correctCount = results.filter(r => r.verdict === 'correct').length;
  const partialCount = results.filter(r => r.verdict === 'partial').length;
  const missed = results.filter(r => r.verdict === 'wrong' || r.verdict === 'blank');
  const verdictClass = v => v === 'correct' ? 'ok' : v === 'partial' ? 'partial' : 'bad';
  const verdictIcon = v => v === 'correct' ? '✓' : v === 'partial' ? '◐' : '✗';
  const headline = pct >= 80 ? 'Strong — you really know this.'
    : pct >= 50 ? 'Getting there — tighten up the misses below.'
    : 'Worth another pass. Review, then retry.';

  $('quizScore').hidden = false;
  $('quizScore').className = 'preport';
  $('quizScore').innerHTML = `
    <div class="preport__head">
      <div class="quiz__ring" style="--p:${pct}"><span>${pct}%</span></div>
      <div class="preport__msg"><b>${score % 1 ? score.toFixed(1) : score} / ${total} correct</b><p>${headline}</p></div>
    </div>

    <div class="preport__tiles">
      <div class="preport__tile"><span class="n">${score % 1 ? score.toFixed(1) : score}/${total}</span><span class="l">Marks</span></div>
      <div class="preport__tile"><span class="n">${pct}%</span><span class="l">Accuracy</span></div>
      <div class="preport__tile"><span class="n">${mmss}</span><span class="l">Time taken</span></div>
      <div class="preport__tile"><span class="n">${avg}s</span><span class="l">Avg / question</span></div>
      <div class="preport__tile"><span class="n">${correctCount}${partialCount ? ' (+' + partialCount + '◐)' : ''}</span><span class="l">Right answers</span></div>
    </div>

    <div class="preport__sec">
      <h4>Question breakdown</h4>
      <div class="preport__break">
        ${results.map((r, n) => `<span class="preport__chip ${verdictClass(r.verdict)}">${verdictIcon(r.verdict)} Q${n + 1}</span>`).join('')}
      </div>
    </div>

    ${missed.length ? `<div class="preport__sec weak">
      <h4>Weak points (${missed.length})</h4>
      <ul>${missed.map(r => `<li>${r.question}${r.keyPoints ? ` — <span style="color:var(--d-faint)">${r.keyPoints}</span>` : ''}</li>`).join('')}</ul>
    </div>` : `<div class="preport__sec"><h4>No weak points — clean sweep! 🎯</h4></div>`}

    <div class="preport__ai" id="quizFocus"><span class="preport__loading">Analysing where to focus…</span></div>
  `;
  $('quizSubmit').hidden = true;
  $('quizSubmit').disabled = false;
  $('quizRetry').hidden = false;
  $('quizScore').scrollIntoView({ behavior: 'smooth' });

  // save the score for history/best
  fetch('/api/practice/result', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: quizState.title, topic: quizState.topic, score, total }),
  }).then(loadPracticeBest).catch(() => {});

  // AI focus & weakness report (graceful — numeric report already shown)
  try {
    const r = await fetch('/api/practice/report', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: results, topic: quizState.topic, score, total, language: $('pracLang').value }),
    });
    const d = await r.json();
    const box = $('quizFocus');
    if (box && d.report) {
      const rep = d.report;

      // 🎯 Animated "What to Study" Revision Cards Grid
      const studyCardsHtml = (rep.weakAreas && rep.weakAreas.length) ? `
        <div class="preport__sec" style="margin-top:16px;">
          <div class="preport__sec-title">
            <span class="preport__icon-tag red">📚</span>
            <h4>What to Study <span class="preport__badge danger">${rep.weakAreas.length} Concepts Missed</span></h4>
          </div>
          <div class="preport__study-grid">
            ${rep.weakAreas.map((area, i) => `
              <div class="study-card c-${(i % 4) + 1}">
                <div class="study-card__badge">REVISION CARD ${i + 1}</div>
                <div class="study-card__title">${area}</div>
                <div class="study-card__hint">💡 Essential concept to review before retrying quiz</div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : '';

      // 🚀 Animated "Where to Focus Next" Action Roadmap Steps
      const focusStepsHtml = (rep.focusTips && rep.focusTips.length) ? `
        <div class="preport__sec" style="margin-top:18px;">
          <div class="preport__sec-title">
            <span class="preport__icon-tag purple">🎯</span>
            <h4>Where to Focus Next <span class="preport__badge accent">Action Plan</span></h4>
          </div>
          <div class="preport__roadmap">
            ${rep.focusTips.map((tip, i) => `
              <div class="roadmap-step">
                <div class="roadmap-step__num">0${i + 1}</div>
                <div class="roadmap-step__content">
                  <b>Step ${i + 1} Action</b>
                  <p>${tip}</p>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : '';

      // 📌 Glowing "Points to Remember" Detailed Cards
      const pointsHtml = (rep.pointsToRemember && rep.pointsToRemember.length) ? `
        <div class="preport__sec" style="margin-top:18px;">
          <div class="preport__sec-title">
            <span class="preport__icon-tag amber">📌</span>
            <h4>Detailed Points to Remember for "${quizState.topic || 'this topic'}"</h4>
          </div>
          <div class="preport__points-grid">
            ${rep.pointsToRemember.map((p, i) => `
              <div class="point-takeaway-card">
                <div class="point-takeaway-header">
                  <span class="point-num">#${i + 1}</span>
                  <h5>${p.title || 'Key Concept'}</h5>
                </div>
                <p>${p.detail || ''}</p>
              </div>
            `).join('')}
          </div>
        </div>
      ` : '';

      // 🎴 3D Interactive Flip Flashcards
      const flashHtml = (rep.flashcards && rep.flashcards.length) ? `
        <div class="preport__sec" style="margin-top:18px;">
          <div class="preport__sec-title">
            <span class="preport__icon-tag cyan">🎴</span>
            <h4>Revision Flashcards <span class="preport__badge info">Tap to Flip 🔄</span></h4>
          </div>
          <div class="preport__flash-grid">
            ${rep.flashcards.map((f, i) => `
              <div class="preport__flash" onclick="this.classList.toggle('flipped')">
                <div class="preport__flash-in">
                  <div class="preport__flash-face front">
                    <div class="flash-tag">QUESTION ${i + 1}</div>
                    <p class="flash-q">${f.q || ''}</p>
                    <span class="flash-tap-hint">Tap card to reveal answer 🔄</span>
                  </div>
                  <div class="preport__flash-face back">
                    <div class="flash-tag answer">ANSWER ${i + 1}</div>
                    <p class="flash-a">${f.a || ''}</p>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : '';

      box.innerHTML = `
        ${studyCardsHtml}
        ${focusStepsHtml}
        ${pointsHtml}
        ${flashHtml}
        ${rep.studyPlan ? `<div class="preport__plan-box">📌 <b>Study Plan:</b> ${rep.studyPlan}</div>` : ''}
        ${rep.encouragement ? `<div class="preport__encourage-box">💪 ${rep.encouragement}</div>` : ''}`;
    } else if (box) {
      box.innerHTML = missed.length
        ? '<p class="preport__plan">📌 Re-read the lesson on the topics marked ✗ above, then hit “New quiz”.</p>'
        : '<p class="preport__plan">💪 Perfect score — try a harder topic or exam-depth next.</p>';
    }
  } catch {
    const box = $('quizFocus');
    if (box) box.innerHTML = '<p class="preport__plan">📌 Review the questions you missed above, then try again.</p>';
  }
});

$('pracGo') && ($('pracGo').onclick = () => {
  const sel = $('pracDoubt');
  const chosen = sel.value !== '' && sel._doubts ? sel._doubts[+sel.value] : null;
  const topic = $('pracTopic').value.trim() || (chosen ? `${chosen.title || ''} (${chosen.subject || ''}): ${chosen.doubt || ''}` : '');
  if (!topic) return pStatus('Choose a saved doubt or type a topic first.');
  buildQuiz({ topic, language: $('pracLang').value });
});
$('quizRetry') && ($('quizRetry').onclick = () => $('pracGo').click());

// "Practice this" on a freshly built lesson → jump to Practice view, quiz the real deck
$('practiceThis') && ($('practiceThis').onclick = () => {
  if (!currentLesson) return;
  document.querySelector('.side__link[data-view="practice"]').click();
  buildQuiz({ lesson: currentLesson, language: $('language').value });
});

/* ===================================================================
   FEATURE 2 — SPEAKING COACH & MULTI-QUESTION AI INTERVIEWER
   =================================================================== */
let itvSession = null;
let itvRecorder = null, itvChunks = [];

function itvStatus(t) { if ($('itvStatus')) $('itvStatus').textContent = t || ''; }
function stageStatus(t) { if ($('itvStageStatus')) $('itvStageStatus').textContent = t || ''; }

let currentInterviewQuestionAudio = null;
let itvFrameCaptureTimer = null;
let currentItvFrames = [];

function stopQuestionAudio() {
  speechSynthesis.cancel();
  if (currentInterviewQuestionAudio) {
    currentInterviewQuestionAudio.pause();
    currentInterviewQuestionAudio = null;
  }
}

function captureItvFrame() {
  const v = $('itvVideo');
  if (!v || !v.videoWidth) return;
  const c = document.createElement('canvas');
  const w = 480, h = Math.round(v.videoHeight * (w / v.videoWidth)) || 360;
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(v, 0, 0, w, h);
  try { currentItvFrames.push(c.toDataURL('image/jpeg', 0.6)); } catch {}
}

async function speakInterviewQuestion(text, language) {
  stopQuestionAudio();
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        language: language || 'English',
        role: 'interviewer',
        section: 'interview'
      }),
    });
    if (res.ok) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentInterviewQuestionAudio = audio;
      audio.play().catch(() => {});
    }
  } catch (e) {
    console.warn('TTS question audio playback error:', e);
  }
}

$('itvStart') && ($('itvStart').onclick = async () => {
  const name = $('itvName').value.trim() || 'Candidate';
  const type = $('itvType').value;
  const skills = $('itvSkills').value.trim();
  const education = $('itvEdu').value;
  const role = $('itvRole').value.trim();
  const count = $('itvCount').value;
  const language = $('itvLang').value;
  const company = $('itvCompany') ? $('itvCompany').value : '';
  const jobDescription = $('itvJD') ? $('itvJD').value.trim() : '';
  const resumeText = itvResumeText || '';

  itvStatus(resumeText
    ? 'Reading your resume and building questions about your real projects…'
    : 'Generating your AI interview question set…');
  $('itvStart').disabled = true;

  try {
    const res = await fetch('/api/interview/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type, skills, education, role, count, language, resumeText, jobDescription, company }),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'Failed to start interview.');

    itvSession = {
      config: { name, type, skills, education, role, count, language },
      title: d.title || 'Live AI Interview',
      questions: d.questions || [],
      currentIx: 0,
      items: [],
      cameraStream: null,
    };

    // Open camera
    try {
      itvSession.cameraStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { width: { ideal: 1280 }, facingMode: 'user' },
      });
      $('itvVideo').srcObject = itvSession.cameraStream;
      } catch (e) {
      console.warn('Camera feed setup warning:', e);
    }

    $('itvSetup').hidden = true;
    $('itvStage').hidden = false;
    $('itvReport').hidden = true;
    itvStatus('');

    renderInterviewQuestion(0);
  } catch (e) {
    itvStatus('⚠ ' + e.message);
  } finally {
    $('itvStart').disabled = false;
  }
});

function renderInterviewQuestion(index) {
  if (!itvSession || !itvSession.questions[index]) return;
  const q = itvSession.questions[index];
  itvSession.currentIx = index;

  const isLast = index === itvSession.questions.length - 1;
  $('itvTitle').textContent = itvSession.title;
  $('itvProg').textContent = `Question ${index + 1} of ${itvSession.questions.length}`;
  $('itvQText').textContent = q.question;
  $('itvQHint').textContent = q.hint ? `💡 Key focus: ${q.hint}` : 'Listen to the interviewer and answer out loud.';
  $('itvNextBtn').hidden = true;
  if ($('itvNextBtn')) {
    $('itvNextBtn').textContent = isLast ? 'Finish & Evaluate Interview' : 'Next Question ➔';
  }
  $('itvRecordLbl').textContent = 'Start Spoken Answer';
  $('itvRecordBtn').classList.remove('rec');
  stageStatus('');

  // AI speaks the question out loud
  speakInterviewQuestion(q.question, itvSession.config.language);
}

$('itvReplayQ') && ($('itvReplayQ').onclick = () => {
  if (itvSession && itvSession.questions[itvSession.currentIx]) {
    speakInterviewQuestion(itvSession.questions[itvSession.currentIx].question, itvSession.config.language);
  }
});

$('itvRecordBtn') && ($('itvRecordBtn').onclick = async () => {
  if (itvRecorder && itvRecorder.state === 'recording') {
    itvRecorder.stop();
    return;
  }

  // STOP AI voice immediately when candidate clicks Start Spoken Answer
  stopQuestionAudio();

  if (!itvSession || !itvSession.cameraStream) {
    try {
      itvSession.cameraStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      $('itvVideo').srcObject = itvSession.cameraStream;
    } catch {
      stageStatus('Microphone/Camera blocked — please allow access.');
      return;
    }
  }

  currentItvFrames = [];
  setTimeout(captureItvFrame, 600);
  if (itvFrameCaptureTimer) clearInterval(itvFrameCaptureTimer);
  itvFrameCaptureTimer = setInterval(() => { if (currentItvFrames.length < 4) captureItvFrame(); }, 2000);

  const audioStream = new MediaStream(itvSession.cameraStream.getAudioTracks());
  itvRecorder = new MediaRecorder(audioStream);
  itvChunks = [];
  itvRecorder.ondataavailable = (e) => itvChunks.push(e.data);
  itvRecorder.onstop = async () => {
    if (itvFrameCaptureTimer) { clearInterval(itvFrameCaptureTimer); itvFrameCaptureTimer = null; }
    captureItvFrame();

    $('itvRecordBtn').classList.remove('rec');
    $('itvRecordLbl').textContent = 'Re-record Answer';
    stageStatus('Transcribing answer & analyzing vision presence…');

    const blob = new Blob(itvChunks, { type: 'audio/webm' });
    if (blob.size < 1000) {
      stageStatus('Answer was too short — please speak and record again.');
      return;
    }

    const fd = new FormData();
    fd.append('audio', blob, 'answer.webm');
    fd.append('question', itvSession.questions[itvSession.currentIx].question);
    fd.append('feedbackLanguage', itvSession.config.language);
    if (currentItvFrames.length) fd.append('frames', JSON.stringify(currentItvFrames.slice(0, 3)));

    try {
      const res = await fetch('/api/speaking-coach', { method: 'POST', body: fd });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed.');

      const currentQ = itvSession.questions[itvSession.currentIx];
      itvSession.items[itvSession.currentIx] = {
        question: currentQ.question,
        transcript: d.transcript,
        metrics: d.metrics,
        presence: d.presence,
      };

      const isLast = itvSession.currentIx === itvSession.questions.length - 1;
      stageStatus(isLast 
        ? `✓ Answer recorded (${d.metrics?.wordCount || 0} words). Click Finish & Evaluate Interview below to calculate score.`
        : `✓ Answer recorded (${d.metrics?.wordCount || 0} words). Click Next Question to continue.`);
      $('itvNextBtn').hidden = false;
    } catch (e) {
      stageStatus('⚠ Transcribing error: ' + e.message);
    }
  };

  itvRecorder.start();
  $('itvRecordBtn').classList.add('rec');
  $('itvRecordLbl').textContent = 'Stop & Save Answer';
  stageStatus('🔴 Interview live — answer out loud now, then tap Stop & Save.');
});

$('itvNextBtn') && ($('itvNextBtn').onclick = () => {
  if (!itvSession) return;
  const nextIx = itvSession.currentIx + 1;
  if (nextIx < itvSession.questions.length) {
    renderInterviewQuestion(nextIx);
  } else {
    finishAndEvaluateInterview();
  }
});

$('itvEndBtn') && ($('itvEndBtn').onclick = () => finishAndEvaluateInterview());

async function finishAndEvaluateInterview() {
  if (!itvSession) return;
  stageStatus('Evaluating full interview performance with AI Hiring Manager…');

  if (itvSession.cameraStream) {
    itvSession.cameraStream.getTracks().forEach(t => t.stop());
    itvSession.cameraStream = null;
  }

  try {
    const res = await fetch('/api/interview/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        interviewConfig: itvSession.config,
        items: itvSession.items.filter(Boolean),
        language: itvSession.config.language,
      }),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'Evaluation failed.');

    $('itvStage').hidden = true;
    renderFullInterviewReport(d.report);
  } catch (e) {
    stageStatus('⚠ Evaluation error: ' + e.message);
  }
}

function bar(label, val) {
  const tone = val >= 75 ? 'hi' : val >= 50 ? 'mid' : 'lo';
  return `<div class="met"><div class="met__top"><span>${label}</span><b>${val}</b></div>
    <div class="met__bar"><i class="${tone}" style="width:${val}%"></i></div></div>`;
}

function renderFullInterviewReport(rep) {
  const r = $('itvReport');
  r.hidden = false;
  
  const score = (typeof rep.overall === 'number') ? rep.overall : 0;
  const verdict = rep.verdict || (score >= 80 ? 'Outstanding' : score >= 65 ? 'Strong Candidate' : score >= 45 ? 'Good Effort' : 'Needs Improvement');
  const fluencyScore = (typeof rep.fluencyScore === 'number') ? rep.fluencyScore : 0;
  const technicalScore = (typeof rep.technicalScore === 'number') ? rep.technicalScore : 0;
  const confidenceScore = (typeof rep.confidenceScore === 'number') ? rep.confidenceScore : 0;
  const visualPresenceScore = (typeof rep.visualPresenceScore === 'number') ? rep.visualPresenceScore : 0;

  // Aggregate proctoring and camera vision flags from response & session items
  const items = itvSession?.items || [];
  const vision = rep.visionAnalysis || {};

  const hasMultiplePeople = Boolean(
    vision.multiplePeopleDetected || items.some(i => i.presence?.multiplePeopleDetected)
  );
  const multiplePeopleMsg = vision.multiplePeopleDetails ||
    items.map(i => i.presence?.multiplePeopleDetails).filter(Boolean).join('; ') ||
    'Two persons or secondary people were detected in camera frame during the interview.';

  const hasOtherActivity = Boolean(
    vision.otherActivitiesDetected || items.some(i => i.presence?.otherActivityDetected)
  );
  const otherActivityMsg = vision.otherActivityDetails ||
    items.map(i => i.presence?.otherActivityDetails).filter(Boolean).join('; ') ||
    'Non-interview activity detected (e.g. mobile phone usage, looking at notes, eating/drinking, off-camera speech).';

  const hasDistractions = Boolean(
    vision.distractionsDetected || items.some(i => i.presence?.distractionDetected)
  );
  const distractionMsg = vision.distractionDetails ||
    items.map(i => i.presence?.distractionDetails).filter(Boolean).join('; ') ||
    'Visual or environmental background distractions detected during camera recording.';

  const hasProctorAlert = hasMultiplePeople || hasOtherActivity || hasDistractions;

  const badList = Array.isArray(rep.whatWentBad) ? [...rep.whatWentBad] : [];
  if (hasOtherActivity && !badList.some(b => /non-interview|phone|note|eating|drinking|smoking|chewing|head|off-screen/i.test(b))) {
    badList.unshift(`Non-Interview Activity: ${otherActivityMsg}`);
  }
  if (hasMultiplePeople && !badList.some(b => /multiple|two person|2 person|proxy/i.test(b))) {
    badList.unshift(`Proctoring Flag: ${multiplePeopleMsg}`);
  }
  if (hasDistractions && !badList.some(b => /distract/i.test(b))) {
    badList.push(`Environment Flag: ${distractionMsg}`);
  }
  if (!badList.length) {
    badList.push('Weak answer depth or incomplete explanation.');
  }

  r.innerHTML = `
    <div class="itv-scorecard">
      <div class="itv-scorecard__header">
        <div class="itv-scorecard__ring" style="--p:${score}">
          <span class="itv-scorecard__num">${score}</span>
          <span class="itv-scorecard__lbl">/ 100</span>
        </div>
        <div class="itv-scorecard__headtext">
          <span class="itv-scorecard__badge">${verdict}</span>
          <h2>Interview Performance Assessment</h2>
          <p>Here is your full real-time interview evaluation generated by the AI Hiring Manager.</p>
        </div>
      </div>

      ${hasProctorAlert ? `
        <!-- 🚨 AI Camera Security & Proctoring Alert -->
        <div class="itv-proctor-alert">
          <div class="itv-proctor-alert__title">
            <span class="itv-proctor-alert__badge">🚨 AI Vision &amp; Proctoring Warning</span>
            <h4>Camera &amp; Behavioral Violations Detected</h4>
          </div>
          <ul class="itv-proctor-alert__list">
            ${hasMultiplePeople ? `<li class="crit"><strong>👥 Multiple Persons / 2 People Detected:</strong> ${multiplePeopleMsg}</li>` : ''}
            ${hasOtherActivity ? `<li class="warn"><strong>📱 Non-Interview Activity:</strong> ${otherActivityMsg}</li>` : ''}
            ${hasDistractions ? `<li class="info"><strong>🌀 Distraction Detected:</strong> ${distractionMsg}</li>` : ''}
          </ul>
        </div>
      ` : ''}

      <!-- Core Metrics Grid -->
      <div class="itv-metrics-grid">
        <div class="itv-metric-card">
          <span class="itv-metric-card__title">Fluency &amp; Pace</span>
          <div class="itv-metric-card__bar"><i style="width:${fluencyScore}%; background:#34c39b;"></i></div>
          <span class="itv-metric-card__val">${fluencyScore}%</span>
        </div>
        <div class="itv-metric-card">
          <span class="itv-metric-card__title">Technical Depth</span>
          <div class="itv-metric-card__bar"><i style="width:${technicalScore}%; background:#5b4ff0;"></i></div>
          <span class="itv-metric-card__val">${technicalScore}%</span>
        </div>
        <div class="itv-metric-card">
          <span class="itv-metric-card__title">Confidence &amp; Delivery</span>
          <div class="itv-metric-card__bar"><i style="width:${confidenceScore}%; background:#f5933b;"></i></div>
          <span class="itv-metric-card__val">${confidenceScore}%</span>
        </div>
        <div class="itv-metric-card">
          <span class="itv-metric-card__title">Visual &amp; Camera Presence</span>
          <div class="itv-metric-card__bar"><i style="width:${visualPresenceScore}%; background:${visualPresenceScore >= 70 ? '#34c39b' : visualPresenceScore >= 45 ? '#f5933b' : '#ff5c5c'};"></i></div>
          <span class="itv-metric-card__val">${visualPresenceScore}%</span>
        </div>
      </div>

      <!-- 4 Vibrant Analytics Cards -->
      <div class="itv-cards-grid">
        <!-- 🔴 What Went Bad Card -->
        <div class="itv-card itv-card--bad">
          <div class="itv-card__head">
            <span class="itv-card__icon">🔴</span>
            <h3>What Went Bad / Critical Mistakes</h3>
          </div>
          <ul>
            ${badList.map(b => `<li>✗ ${b}</li>`).join('')}
          </ul>
        </div>

        <!-- 🟢 Strengths Card -->
        <div class="itv-card itv-card--strengths">
          <div class="itv-card__head">
            <span class="itv-card__icon">🟢</span>
            <h3>Key Strengths</h3>
          </div>
          <ul>
            ${(rep.strengths && rep.strengths.length ? rep.strengths : ['Completed all interview questions.']).map(s => `<li>✓ ${s}</li>`).join('')}
          </ul>
        </div>

        <!-- 🟠 Weaknesses Card -->
        <div class="itv-card itv-card--weaknesses">
          <div class="itv-card__head">
            <span class="itv-card__icon">🟠</span>
            <h3>Areas to Work On / Weaknesses</h3>
          </div>
          <ul>
            ${(rep.improvements && rep.improvements.length ? rep.improvements : ['Practice structured speaking and maintain eye contact.']).map(s => `<li>⚠ ${s}</li>`).join('')}
          </ul>
        </div>

        <!-- 💜 What Would Make It Better Card -->
        <div class="itv-card itv-card--better">
          <div class="itv-card__head">
            <span class="itv-card__icon">💜</span>
            <h3>What Would Make It Better</h3>
          </div>
          <ul>
            <li>💡 <b>Use STAR Method:</b> Frame project and behavioral answers around Situation, Task, Action, and Result.</li>
            <li>💡 <b>Direct Eye Contact:</b> Look straight at the camera lens during explanations to boost visual score.</li>
            <li>💡 <b>Headline First:</b> Start technical answers with a 1-sentence summary before diving into details.</li>
          </ul>
        </div>
      </div>

      <!-- Question-by-Question Breakdown -->
      <div class="itv-qbreakdown">
        <h3>Question-by-Question Breakdown &amp; Model Answers</h3>
        <div class="itv-qlist">
          ${(rep.questionEvaluations || []).map((q, idx) => `
            <div class="itv-qitem">
              <div class="itv-qitem__head">
                <b>Q${idx + 1}: ${q.question}</b>
                <span class="itv-qitem__score ${q.score >= 80 ? 'hi' : q.score >= 60 ? 'mid' : 'lo'}">${typeof q.score === 'number' ? q.score : 0}/100</span>
              </div>
              <div class="itv-qitem__body">
                <div class="itv-qitem__ans">
                  <b>Your Spoken Answer:</b>
                  <p>${q.studentAnswer || '(No speech recorded)'}</p>
                </div>
                <div class="itv-qitem__fb">
                  <b>AI Feedback:</b>
                  <p>${q.feedback || 'Answer evaluated.'}</p>
                </div>
                <div class="itv-qitem__model">
                  <b>✨ Ideal Expert Model Answer:</b>
                  <p>${q.modelAnswer || ''}</p>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <button class="dbt-btn dbt-btn--primary" id="itvRestartBtn" style="margin-top:28px;">
        Start New AI Mock Interview
      </button>
    </div>
  `;

  $('itvRestartBtn').onclick = () => {
    r.hidden = true;
    $('itvSetup').hidden = false;
  };
  r.scrollIntoView({ behavior: 'smooth' });
}

// hook these loaders into the existing library refresh
const _loadLibrary = loadLibrary;
loadLibrary = async function () {
  await _loadLibrary();
  try {
    const d = await (await fetch('/api/doubts')).json();
    fillPracticeDoubts(d.doubts || []);
  } catch {}
  if (typeof loadPracticeBest === 'function') loadPracticeBest();
  if (typeof loadCoachReps === 'function') loadCoachReps();
};

/* ===================================================================
   FEATURE 3 — HACKATHONS & WORKSHOPS NEAR ME (real map + real events)
   =================================================================== */
let evtMap = null, evtUserMarker = null, evtMarkers = [], evtData = null;
let evtType = 'hackathon', evtScope = 'all', userLoc = null, eventsBooted = false;

function eStatus(t) { if ($('evtStatus')) $('evtStatus').textContent = t || ''; }

// init the Leaflet map once (High-Resolution HD Satellite tiles by default)
function ensureMap(center) {
  if (evtMap) { evtMap.setView([center.lat, center.lng], 10); setTimeout(() => evtMap.invalidateSize(), 80); return; }
  evtMap = L.map('evtMap', { zoomControl: true, scrollWheelZoom: true }).setView([center.lat, center.lng], 10);
  
  // Clear HD Satellite imagery layer
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri, USGS, NOAA', maxZoom: 19
  }).addTo(evtMap);
  
  // Clear high-contrast city & street labels overlay over satellite photos
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png', {
    subdomains: 'abcd', maxZoom: 19, opacity: 0.9
  }).addTo(evtMap);

  setTimeout(() => evtMap.invalidateSize(), 120);
}

function userIcon() {
  return L.divIcon({ className: '', html: '<span class="map-me"></span>', iconSize: [22, 22], iconAnchor: [11, 11] });
}
function eventIcon(type) {
  const c = type === 'workshop' ? 'wk' : 'hk';
  return L.divIcon({ className: '', html: `<span class="map-pin ${c}"></span>`, iconSize: [26, 34], iconAnchor: [13, 32], popupAnchor: [0, -30] });
}

async function locateMe() {
  if (!navigator.geolocation) { showManual('Your browser has no location support — type your city instead.'); return; }
  eStatus('📍 Getting your location… (allow the browser prompt)');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      ensureMap(userLoc);
      fetchEvents();
    },
    () => { showManual('Location blocked. Allow it in your browser, or type your city below.'); },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}
// preventScroll: focusing an input otherwise yanks the whole page down to it — that was
// what pushed the Competitions view below the fold when location was blocked.
function showManual(msg) { eStatus('⚠ ' + msg); $('evtManual').hidden = false; $('evtCity').focus({ preventScroll: true }); }

async function fetchEvents() {
  if (!userLoc) return;
  eStatus('Finding real hackathons & workshops near you…');
  clearEventMarkers();
  $('evtList').innerHTML = '<p class="evt-empty">Searching…</p>';
  try {
    const url = `/api/events?lat=${userLoc.lat}&lng=${userLoc.lng}&type=${evtType}&scope=${evtScope}`;
    const res = await fetch(url);
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'Failed.');
    evtData = d;
    renderEvents(d);
    eStatus(d.notices?.length ? '⚠ ' + d.notices.join(' ') : '');
  } catch (e) { eStatus('⚠ ' + e.message); $('evtList').innerHTML = '<p class="evt-empty">Could not load events — try again.</p>'; }
}

function clearEventMarkers() {
  evtMarkers.forEach((m) => evtMap && evtMap.removeLayer(m));
  evtMarkers = [];
}

/* ---------- Resume upload for the AI Interviewer ----------
   Reuses the same pdf.js loader as the doubt flow, so questions can be asked
   about the candidate's actual projects instead of generic textbook topics. */
let itvResumeText = '';
if ($('itvResumeBtn')) $('itvResumeBtn').onclick = () => $('itvResume').click();
if ($('itvResumeClear')) $('itvResumeClear').onclick = () => {
  itvResumeText = '';
  $('itvResume').value = '';
  $('itvResumeName').textContent = 'No resume attached';
  $('itvResumeClear').hidden = true;
};
if ($('itvResume')) $('itvResume').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  $('itvResumeName').textContent = 'Reading…';
  try {
    const lib = await loadPdfLib();
    const pdf = await lib.getDocument({ data: await f.arrayBuffer() }).promise;
    let text = '';
    for (let p = 1; p <= Math.min(pdf.numPages, 6); p++) {
      const content = await (await pdf.getPage(p)).getTextContent();
      text += content.items.map((it) => it.str).join(' ') + '\n';
    }
    text = text.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
    if (!text) throw new Error('No selectable text — this resume looks scanned.');
    itvResumeText = text;
    $('itvResumeName').textContent = `${f.name} · ${text.length.toLocaleString()} chars read`;
    $('itvResumeClear').hidden = false;
  } catch (err) {
    itvResumeText = '';
    $('itvResumeName').textContent = '⚠ ' + err.message;
  }
};

/* Registration-deadline badge — urgency is the whole point of a hackathon listing. */
function deadlineBadge(ev) {
  if (ev.daysLeft == null) return '';
  const d = ev.daysLeft;
  const cls = d <= 2 ? 'urgent' : d <= 7 ? 'soon' : 'ok';
  const txt = d === 0 ? 'Closes today!' : d === 1 ? 'Closes tomorrow' : `${d} days left to register`;
  return `<div class="evt__deadline ${cls}">⏳ ${txt}</div>`;
}

/* Build a calendar (.ics) reminder for the registration deadline — works with
   Google Calendar, Apple Calendar and Outlook, and needs no server or login. */
function downloadReminder(ev) {
  if (!ev || !ev.deadline) return;
  const dt = new Date(ev.deadline);
  if (isNaN(dt)) return;
  const stamp = (x) => x.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const end = new Date(dt.getTime() + 30 * 60000);
  const esc = (s) => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Omkar Hub//Hackathons//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${ev.id}@omkarhub`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(dt)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc('Register: ' + ev.title)}`,
    `DESCRIPTION:${esc(`Registration deadline for ${ev.title} on ${ev.source}.\n${ev.url}`)}`,
    `URL:${esc(ev.url)}`,
    `LOCATION:${esc(ev.location || 'Online')}`,
    // nudge the student a day before, and again an hour before
    'BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY', `DESCRIPTION:${esc(ev.title)} closes tomorrow`, 'END:VALARM',
    'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', `DESCRIPTION:${esc(ev.title)} closes in an hour`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (ev.title || 'hackathon').replace(/[^a-z0-9]+/gi, '-').slice(0, 50) + '-deadline.ics';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderEvents(d) {
  ensureMap(d.me);
  // the map now sizes to the flex layout, so Leaflet must re-measure its container
  if (evtMap) setTimeout(() => evtMap.invalidateSize(), 60);
  // user marker
  if (evtUserMarker) evtMap.removeLayer(evtUserMarker);
  evtUserMarker = L.marker([d.me.lat, d.me.lng], { icon: userIcon(), zIndexOffset: 1000 })
    .addTo(evtMap).bindPopup('<b>You are here</b>');

  $('evtNear').textContent = d.counts.near;
  $('evtOnline').textContent = d.counts.online;

  const bounds = [[d.me.lat, d.me.lng]];
  // place markers for events that have coordinates
  d.events.forEach((ev, i) => {
    if (ev.lat == null || ev.lng == null) return;
    const m = L.marker([ev.lat, ev.lng], { icon: eventIcon(ev.type) }).addTo(evtMap);
    m.bindPopup(
      `<b>${ev.title}</b><br>${ev.location}${ev.distanceKm != null ? ` · ${ev.distanceKm} km` : ''}` +
      `${ev.dates ? `<br>${ev.dates}` : ''}` +
      `${ev.prize ? `<br>🏆 ${ev.prize}` : ''}` +
      `<br><a href="${ev.url}" target="_blank" rel="noopener">Open on ${ev.source} →</a>`
    );
    ev._marker = m;
    evtMarkers.push(m);
    bounds.push([ev.lat, ev.lng]);
  });
  if (bounds.length > 1) evtMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });

  // list
  if (!d.events.length) { $('evtList').innerHTML = '<p class="evt-empty">No matching events found right now. Try “All”, or check back soon.</p>'; return; }
  $('evtList').innerHTML = d.events.map((ev, i) => `
    <article class="evt ${ev.type}" data-i="${i}">
      <div class="evt__top">
        <span class="evt__tag">${ev.type === 'workshop' ? 'Workshop' : 'Hackathon'}</span>
        <span class="evt__dist">${ev.mode === 'online' ? '🌐 Online' : (ev.distanceKm != null ? ev.distanceKm + ' km' : ev.location)}</span>
      </div>
      <h4>${ev.title || 'Untitled event'}</h4>
      <div class="evt__meta">
        <span>📍 ${ev.mode === 'online' ? 'Online — join from anywhere' : (ev.location || 'Location TBA')}</span>
        ${ev.dates ? `<span>📅 ${ev.dates}</span>` : ''}
      </div>
      ${deadlineBadge(ev)}
      ${ev.themes?.length ? `<div class="evt__themes">${ev.themes.slice(0, 6).map((t) => `<span>${t}</span>`).join('')}</div>` : ''}
      <div class="evt__foot">
        <span class="evt__foot-l">
          ${ev.prize ? `<span class="evt__prize">🏆 ${ev.prize}</span>` : ''}
          ${ev.source ? `<span class="evt__src">${ev.source}</span>` : ''}
        </span>
        <span class="evt__actions">
          ${ev.deadline ? `<button class="evt__remind" data-i="${i}" title="Add the registration deadline to your calendar">⏰ Remind me</button>` : ''}
          <a class="evt__link" href="${ev.url}" target="_blank" rel="noopener">View →</a>
        </span>
      </div>
    </article>`).join('');

  // "Remind me" → downloads a calendar invite for the registration deadline
  $('evtList').querySelectorAll('.evt__remind').forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    downloadReminder(d.events[+b.dataset.i]);
  });

  $('evtList').querySelectorAll('.evt').forEach((card) => {
    card.onclick = (e) => {
      if (e.target.closest('a')) return;
      const ev = d.events[+card.dataset.i];
      if (ev?._marker) { evtMap.setView([ev.lat, ev.lng], 13); ev._marker.openPopup(); }
    };
  });

  // Rendering the map (Leaflet fitBounds) nudges the whole page down — that's what pushed
  // Competitions below the fold once events loaded. Pin it back to the top after render.
  scrollToTop();
  requestAnimationFrame(scrollToTop);
  setTimeout(scrollToTop, 200);
}

/* controls */
document.querySelectorAll('#evtType .seg').forEach((b) => b.onclick = () => {
  document.querySelectorAll('#evtType .seg').forEach((x) => x.classList.remove('active'));
  b.classList.add('active'); evtType = b.dataset.type;
  if (userLoc) fetchEvents();
});
$('evtScope') && ($('evtScope').onchange = () => { evtScope = $('evtScope').value; if (userLoc) fetchEvents(); });
$('evtLocate') && ($('evtLocate').onclick = locateMe);
async function searchCity() {
  const q = ($('evtCityInput')?.value || '').trim();
  if (!q) return;
  eStatus(`🔍 Searching competitions in ${q}…`);
  try {
    const d = await (await fetch('/api/geocode?q=' + encodeURIComponent(q))).json();
    if (!d.lat) throw new Error(d.error || `City "${q}" not found.`);
    userLoc = { lat: d.lat, lng: d.lng };
    ensureMap(userLoc);
    if (evtMap) evtMap.setView([d.lat, d.lng], 11);
    fetchEvents();
  } catch (e) { eStatus('⚠ ' + e.message); }
}

$('evtCityGo') && ($('evtCityGo').onclick = searchCity);
$('evtCityInput') && ($('evtCityInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchCity(); }));
// when the Hackathons tab is opened: auto-locate the first time, refresh map sizing after
document.querySelector('.side__link[data-view="events"]')?.addEventListener('click', () => {
  if (evtMap) setTimeout(() => evtMap.invalidateSize(), 120);
  if (!eventsBooted) { eventsBooted = true; locateMe(); }
});
