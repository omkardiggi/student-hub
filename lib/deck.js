// lib/deck.js — build a REAL, richly-designed .pptx locally (no paid API).
//
// Why this exists: Presenton returned plain text slides (no flowcharts, diagrams,
// or images). This generator draws everything itself with pptxgenjs:
//   • a themed title slide with a topic image
//   • a flowchart slide with real boxes + arrows
//   • a diagram slide with a central concept node + connected part cards
//   • explanation slides with numbered point cards + an illustrative image
//
// Images come from Pollinations (https://image.pollinations.ai) — free, no API key,
// no signup. If an image can't be fetched, the slide falls back to a drawn panel so
// the deck is never broken.

import PptxGenJS from 'pptxgenjs';

/* ---------------- theme ---------------- */
const T = {
  ink:      '0B0B12',   // near-black slide bg
  ink2:     '141420',
  panel:    '1C1C2A',
  panel2:   '242437',
  line:     '3A3A52',
  text:     'F3F2F8',
  soft:     'B9B8C6',
  faint:    '8A8A9C',
  indigo:   '6C5CE7',
  indigoDk: '4B3FBE',
  amber:    'F5933B',
  teal:     '25C2A0',
  pink:     'E86FA6',
  accents:  ['6C5CE7', '25C2A0', 'F5933B', 'E86FA6', '4C9AF5', 'F2C94C'],
  serif:    'Georgia',
  sans:     'Segoe UI',
};

/* ---------------- free image fetch (Pollinations) ---------------- */
// Returns a data URL string, or null on any failure.
async function fetchImage(prompt, w = 1024, h = 640) {
  try {
    const seed = Math.floor(Math.random() * 1e6);
    const styled = `${prompt}, clean modern educational illustration, soft studio lighting, minimal, high detail, no text, no words, no letters`;
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(styled)}` +
                `?width=${w}&height=${h}&nologo=true&seed=${seed}&model=flux`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      console.warn(`Pollinations returned status ${res.status} for prompt: ${prompt}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) {
      console.warn(`Pollinations returned small buffer (${buf.length} bytes) for prompt: ${prompt}`);
      return null; // guard against error pages
    }
    const ct = res.headers.get('content-type') || 'image/jpeg';
    return `data:${ct};base64,${buf.toString('base64')}`;
  } catch (err) {
    console.error(`fetchImage failed for prompt "${prompt}":`, err.message || err);
    return null;
  }
}

/* ---------------- small drawing helpers ---------------- */
function backdrop(slide, pptx) {
  slide.background = { color: T.ink };
  // soft indigo glow top-left + amber glow bottom-right, faked with big low-opacity ovals
  slide.addShape(pptx.ShapeType.ellipse, { x: -2.2, y: -2.4, w: 6, h: 6, fill: { color: T.indigo, transparency: 88 }, line: { type: 'none' } });
  slide.addShape(pptx.ShapeType.ellipse, { x: 9.6, y: 4.2, w: 6, h: 6, fill: { color: T.amber, transparency: 90 }, line: { type: 'none' } });
}

function footer(slide, pptx, subject, n, total) {
  slide.addShape(pptx.ShapeType.line, { x: 0.6, y: 7.06, w: 12.13, h: 0, line: { color: T.line, width: 1 } });
  slide.addText('Student Hub', { x: 0.6, y: 7.05, w: 4, h: 0.35, fontSize: 10, color: T.faint, fontFace: T.sans, bold: true });
  slide.addText(subject || 'Lesson', { x: 4.6, y: 7.05, w: 4.13, h: 0.35, fontSize: 10, color: T.faint, align: 'center', fontFace: T.sans });
  slide.addText(`${n} / ${total}`, { x: 8.73, y: 7.05, w: 4, h: 0.35, fontSize: 10, color: T.faint, align: 'right', fontFace: T.sans });
}

function kicker(slide, pptx, label, color = T.indigo) {
  slide.addShape(pptx.ShapeType.roundRect, { x: 0.6, y: 0.55, w: 0.16, h: 0.16, rectRadius: 0.03, fill: { color }, line: { type: 'none' } });
  slide.addText(label.toUpperCase(), { x: 0.85, y: 0.44, w: 8, h: 0.36, fontSize: 12, color, bold: true, charSpacing: 2, fontFace: T.sans });
}

/* ---------------- slide builders ---------------- */
function titleSlide(pptx, lesson, heroData) {
  const s = pptx.addSlide();
  s.background = { color: T.ink };
  // full-bleed hero image on the right ~55%, dark gradient panel on the left for text
  if (heroData) {
    s.addImage({ data: heroData, x: 6.0, y: 0, w: 7.33, h: 7.5, sizing: { type: 'cover', w: 7.33, h: 7.5 } });
    // scrim so text stays readable
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 8.3, h: 7.5, fill: { color: T.ink, transparency: 8 }, line: { type: 'none' } });
    s.addShape(pptx.ShapeType.rect, { x: 5.4, y: 0, w: 3.0, h: 7.5, fill: { color: T.ink, transparency: 45 }, line: { type: 'none' } });
  } else {
    backdrop(s, pptx);
  }
  s.addShape(pptx.ShapeType.roundRect, { x: 0.75, y: 1.7, w: 0.55, h: 0.14, rectRadius: 0.05, fill: { color: T.amber }, line: { type: 'none' } });
  s.addText((lesson.subject || 'Lesson').toUpperCase(), { x: 0.75, y: 1.95, w: 6, h: 0.4, fontSize: 15, color: T.amber, bold: true, charSpacing: 3, fontFace: T.sans });
  s.addText(lesson.title || lesson.slides?.[0]?.heading || 'Your Lesson', {
    x: 0.75, y: 2.45, w: 6.4, h: 2.4, fontSize: 40, color: T.text, bold: true, fontFace: T.serif, lineSpacingMultiple: 1.0, valign: 'top',
  });
  const sub = lesson.slides?.find(x => x.type === 'title')?.subtitle || '';
  if (sub) s.addText(sub, { x: 0.78, y: 4.85, w: 6.2, h: 1.2, fontSize: 16, color: T.soft, fontFace: T.sans, italic: true });
  s.addText('Built with Student Hub  ·  AI tutor deck', { x: 0.78, y: 6.7, w: 6, h: 0.4, fontSize: 11, color: T.faint, fontFace: T.sans });
  return s;
}

function flowchartSlide(pptx, s0, subject, n, total) {
  const s = pptx.addSlide();
  backdrop(s, pptx);
  kicker(s, pptx, 'Flowchart', T.teal);
  s.addText(s0.heading || 'How it works', { x: 0.6, y: 0.85, w: 12.1, h: 0.8, fontSize: 26, color: T.text, bold: true, fontFace: T.serif });

  const steps = (s0.steps || []).slice(0, 6);
  const perRow = steps.length <= 3 ? steps.length : (steps.length <= 4 ? 2 : 3);
  const rows = Math.ceil(steps.length / perRow);
  const areaX = 0.7, areaY = 2.0, areaW = 11.9;
  const gapX = 0.55, boxH = 1.15;
  const boxW = (areaW - gapX * (perRow - 1)) / perRow;
  const rowGap = rows > 1 ? 1.35 : 0;

  const pos = [];
  steps.forEach((step, i) => {
    const r = Math.floor(i / perRow);
    let col = i % perRow;
    const leftToRight = r % 2 === 0;              // snake layout
    if (!leftToRight) col = perRow - 1 - col;
    const x = areaX + col * (boxW + gapX);
    const y = areaY + r * (boxH + rowGap);
    pos.push({ x, y, r, leftToRight });
    const c = T.accents[i % T.accents.length];
    s.addShape(pptx.ShapeType.roundRect, { x, y, w: boxW, h: boxH, rectRadius: 0.09, fill: { color: T.panel }, line: { color: c, width: 1.75 }, shadow: { type: 'outer', color: '000000', opacity: 0.35, blur: 8, offset: 3, angle: 90 } });
    s.addText(`${i + 1}`, { x: x + 0.12, y: y + 0.1, w: 0.5, h: 0.4, fontSize: 13, color: c, bold: true, fontFace: T.sans });
    s.addText(step, { x: x + 0.15, y: y + 0.12, w: boxW - 0.3, h: boxH - 0.24, fontSize: 13, color: T.text, align: 'center', valign: 'middle', fontFace: T.sans });
  });

  // arrows between consecutive boxes
  for (let i = 0; i < steps.length - 1; i++) {
    const a = pos[i], b = pos[i + 1];
    if (a.r === b.r) {
      // horizontal arrow in the reading direction of this row
      const yMid = a.y + boxH / 2;
      const x1 = a.leftToRight ? a.x + boxW : a.x;
      const x2 = a.leftToRight ? b.x : b.x + boxW;
      s.addShape(pptx.ShapeType.line, { x: Math.min(x1, x2), y: yMid, w: Math.abs(x2 - x1), h: 0, line: { color: T.soft, width: 2, endArrowType: 'triangle', beginArrowType: a.leftToRight ? 'none' : 'triangle' } });
    } else {
      // wrap: short vertical arrow down at the end box
      const x = a.x + boxW / 2;
      s.addShape(pptx.ShapeType.line, { x, y: a.y + boxH, w: 0, h: rowGap, line: { color: T.soft, width: 2, endArrowType: 'triangle' } });
    }
  }
  footer(s, pptx, subject, n, total);
  return s;
}

function diagramSlide(pptx, s0, subject, n, total, imgData) {
  const s = pptx.addSlide();
  backdrop(s, pptx);
  kicker(s, pptx, 'Diagram', T.indigo);
  s.addText(s0.heading || 'The parts', { x: 0.6, y: 0.85, w: 12.1, h: 0.8, fontSize: 26, color: T.text, bold: true, fontFace: T.serif });

  const parts = (s0.parts || []).slice(0, 6);

  if (imgData) {
    // Layout with image on the right, single-column diagram on the left (widescreen friendly)
    const cx = 2.0;
    const cy = 4.0;

    // Central concept node
    s.addShape(pptx.ShapeType.ellipse, { x: cx - 1.0, y: cy - 0.8, w: 2.0, h: 1.6, fill: { color: T.indigoDk }, line: { color: T.indigo, width: 2.25 }, shadow: { type: 'outer', color: '000000', opacity: 0.4, blur: 12, offset: 4, angle: 90 } });
    s.addText(s0.heading || subject || 'Concept', { x: cx - 0.9, y: cy - 0.7, w: 1.8, h: 1.4, fontSize: 13, color: T.text, bold: true, align: 'center', valign: 'middle', fontFace: T.sans });

    // Part cards in a single column on the right side of the left panel
    const cardW = 3.2, cardH = 0.9;
    const startY = cy - ((parts.length - 1) * (cardH + 0.25)) / 2 - cardH / 2;
    parts.forEach((p, i) => {
      const y = startY + i * (cardH + 0.25);
      const x = 4.2;
      const c = T.accents[i % T.accents.length];

      // Connector
      s.addShape(pptx.ShapeType.line, { x: cx + 1.0, y: y + cardH / 2, w: 1.0, h: 0, line: { color: c, width: 1.75, dashType: 'dash' } });
      s.addShape(pptx.ShapeType.ellipse, { x: cx + 1.0 - 0.04, y: y + cardH / 2 - 0.05, w: 0.1, h: 0.1, fill: { color: c }, line: { type: 'none' } });

      // Card
      s.addShape(pptx.ShapeType.roundRect, { x, y, w: cardW, h: cardH, rectRadius: 0.08, fill: { color: T.panel }, line: { color: T.line, width: 1 } });
      s.addShape(pptx.ShapeType.roundRect, { x, y, w: 0.09, h: cardH, rectRadius: 0.02, fill: { color: c }, line: { type: 'none' } });
      s.addText(p.label || '', { x: x + 0.2, y: y + 0.06, w: cardW - 0.3, h: 0.3, fontSize: 12.5, color: T.text, bold: true, fontFace: T.sans });
      s.addText(p.desc || '', { x: x + 0.2, y: y + 0.36, w: cardW - 0.3, h: 0.48, fontSize: 10.5, color: T.soft, fontFace: T.sans, valign: 'top' });
    });

    // Big image on the right
    s.addShape(pptx.ShapeType.roundRect, { x: 7.9, y: 1.8, w: 4.8, h: 4.6, rectRadius: 0.12, fill: { color: T.panel }, line: { color: T.line, width: 1 } });
    s.addImage({ data: imgData, x: 8.0, y: 1.9, w: 4.6, h: 4.4, rounding: true, sizing: { type: 'cover', w: 4.6, h: 4.4 } });
  } else {
    // Original split-column layout if no image (center is 6.66)
    const cx = 6.66;
    const cy = 4.15;
    s.addShape(pptx.ShapeType.ellipse, { x: cx - 1.15, y: cy - 0.95, w: 2.3, h: 1.9, fill: { color: T.indigoDk }, line: { color: T.indigo, width: 2.25 }, shadow: { type: 'outer', color: '000000', opacity: 0.4, blur: 12, offset: 4, angle: 90 } });
    s.addText(s0.heading || subject || 'Concept', { x: cx - 1.05, y: cy - 0.8, w: 2.1, h: 1.6, fontSize: 13, color: T.text, bold: true, align: 'center', valign: 'middle', fontFace: T.sans });

    const leftParts = parts.filter((_, i) => i % 2 === 0);
    const rightParts = parts.filter((_, i) => i % 2 === 1);
    const cardW = 3.05, cardH = 1.0;

    const placeCol = (arr, side) => {
      const startY = cy - ((arr.length - 1) * (cardH + 0.35)) / 2 - cardH / 2;
      arr.forEach((p, i) => {
        const y = startY + i * (cardH + 0.35);
        const x = side === 'left' ? cx - 1.15 - 0.7 - cardW : cx + 1.15 + 0.7;
        const c = T.accents[(side === 'left' ? i * 2 : i * 2 + 1) % T.accents.length];

        // Connector
        const lineX1 = side === 'left' ? x + cardW : cx + 1.05;
        const lineX2 = side === 'left' ? cx - 1.05 : x;
        s.addShape(pptx.ShapeType.line, { x: Math.min(lineX1, lineX2), y: y + cardH / 2, w: Math.abs(lineX2 - lineX1), h: 0, line: { color: c, width: 1.75, dashType: 'dash' } });
        s.addShape(pptx.ShapeType.ellipse, { x: (side === 'left' ? cx - 1.09 : cx + 1.01) - 0.04, y: y + cardH / 2 - 0.05, w: 0.1, h: 0.1, fill: { color: c }, line: { type: 'none' } });

        // Card
        s.addShape(pptx.ShapeType.roundRect, { x, y, w: cardW, h: cardH, rectRadius: 0.08, fill: { color: T.panel }, line: { color: T.line, width: 1 } });
        s.addShape(pptx.ShapeType.roundRect, { x, y, w: 0.09, h: cardH, rectRadius: 0.02, fill: { color: c }, line: { type: 'none' } });
        s.addText(p.label || '', { x: x + 0.22, y: y + 0.08, w: cardW - 0.34, h: 0.34, fontSize: 13, color: T.text, bold: true, fontFace: T.sans });
        s.addText(p.desc || '', { x: x + 0.22, y: y + 0.42, w: cardW - 0.34, h: 0.52, fontSize: 10.5, color: T.soft, fontFace: T.sans, valign: 'top' });
      });
    };
    placeCol(leftParts, 'left');
    placeCol(rightParts, 'right');
  }

  footer(s, pptx, subject, n, total);
  return s;
}

function explanationSlide(pptx, s0, subject, n, total, imgData) {
  const s = pptx.addSlide();
  backdrop(s, pptx);
  kicker(s, pptx, 'In plain words', T.amber);
  s.addText(s0.heading || 'Explained', { x: 0.6, y: 0.85, w: 12.1, h: 0.8, fontSize: 26, color: T.text, bold: true, fontFace: T.serif });

  const pts = (s0.points || []).slice(0, 4);
  const colW = imgData ? 7.0 : 12.1;
  const startY = 2.0;
  const cardH = Math.min(1.15, (5.0 - (pts.length - 1) * 0.2) / Math.max(pts.length, 1));
  pts.forEach((p, i) => {
    const y = startY + i * (cardH + 0.2);
    const c = T.accents[i % T.accents.length];
    s.addShape(pptx.ShapeType.roundRect, { x: 0.6, y, w: colW, h: cardH, rectRadius: 0.08, fill: { color: T.panel }, line: { color: T.line, width: 1 } });
    s.addShape(pptx.ShapeType.ellipse, { x: 0.78, y: y + cardH / 2 - 0.28, w: 0.56, h: 0.56, fill: { color: c }, line: { type: 'none' } });
    s.addText(`${i + 1}`, { x: 0.78, y: y + cardH / 2 - 0.28, w: 0.56, h: 0.56, fontSize: 18, color: 'FFFFFF', bold: true, align: 'center', valign: 'middle', fontFace: T.sans });
    s.addText([
      { text: (p.bold || '') + '   ', options: { bold: true, color: T.text, fontSize: 15 } },
      { text: p.text || '', options: { color: T.soft, fontSize: 12.5 } },
    ], { x: 1.55, y: y + 0.08, w: colW - 1.15, h: cardH - 0.16, fontFace: T.sans, valign: 'middle', lineSpacingMultiple: 1.02 });
  });

  if (imgData) {
    // Big image on the right
    s.addShape(pptx.ShapeType.roundRect, { x: 7.9, y: 1.8, w: 4.8, h: 4.6, rectRadius: 0.12, fill: { color: T.panel }, line: { color: T.line, width: 1 } });
    s.addImage({ data: imgData, x: 8.0, y: 1.9, w: 4.6, h: 4.4, rounding: true, sizing: { type: 'cover', w: 4.6, h: 4.4 } });
  }
  footer(s, pptx, subject, n, total);
  return s;
}

function summarySlide(pptx, lesson) {
  const s = pptx.addSlide();
  backdrop(s, pptx);
  kicker(s, pptx, 'Recap', T.teal);
  s.addText('Quick recap', { x: 0.6, y: 0.85, w: 12, h: 0.8, fontSize: 28, color: T.text, bold: true, fontFace: T.serif });
  const bullets = [];
  for (const sl of lesson.slides || []) {
    if (sl.type === 'flowchart' && sl.steps?.length) bullets.push(`${sl.heading}: ${sl.steps.join(' → ')}`);
    else if (sl.type === 'diagram' && sl.parts?.length) bullets.push(`${sl.heading}: ${sl.parts.map(p => p.label).join(', ')}`);
    else if (sl.type === 'explanation' && sl.points?.length) sl.points.forEach(p => bullets.push(`${p.bold}`));
  }
  s.addText(bullets.slice(0, 6).map(t => ({ text: t, options: { bullet: { code: '2022', indent: 18 }, color: T.soft, fontSize: 15, paraSpaceAfter: 10 } })),
    { x: 0.75, y: 2.0, w: 11.8, h: 4.6, fontFace: T.sans, valign: 'top' });
  return s;
}

/* ---------------- public API ---------------- */
// Returns a Node Buffer of the .pptx. Set fetchImages=false to skip network images.
export async function buildDeckBuffer(lesson, { fetchImages = true } = {}) {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'WIDE', width: 13.333, height: 7.5 });
  pptx.layout = 'WIDE';
  pptx.author = 'Student Hub';
  pptx.title = lesson.title || 'Lesson';

  const subject = lesson.subject || 'Lesson';
  const slides = lesson.slides || [];

  // Fire all image requests in parallel (title hero + one per diagram/explanation).
  const imgJobs = {};
  if (fetchImages) {
    imgJobs.hero = fetchImage(`${lesson.title || subject}, ${subject} concept`, 1024, 1024);
    slides.forEach((sl, i) => {
      if (sl.type === 'diagram') imgJobs[i] = fetchImage(`${sl.heading}, ${subject} diagram illustration`, 800, 800);
      if (sl.type === 'explanation') imgJobs[i] = fetchImage(`${sl.heading}, ${subject}`, 800, 900);
    });
  }
  const imgs = {};
  await Promise.all(Object.entries(imgJobs).map(async ([k, p]) => { imgs[k] = await p; }));

  const total = slides.length + 1; // +1 recap
  let hasTitle = false;
  slides.forEach((sl, i) => {
    const n = i + 1;
    if (sl.type === 'title') { titleSlide(pptx, lesson, imgs.hero); hasTitle = true; }
    else if (sl.type === 'flowchart') flowchartSlide(pptx, sl, subject, n, total);
    else if (sl.type === 'diagram') diagramSlide(pptx, sl, subject, n, total, imgs[i]);
    else if (sl.type === 'explanation') explanationSlide(pptx, sl, subject, n, total, imgs[i]);
  });
  if (!hasTitle) titleSlide(pptx, lesson, imgs.hero); // guarantee a cover
  summarySlide(pptx, lesson);

  return await pptx.write({ outputType: 'nodebuffer' });
}
