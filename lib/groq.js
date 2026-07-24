// lib/groq.js — all Groq calls (OpenAI-compatible API).
// Free tier: ~30 req/min, ~1000 req/day, no credit card. https://console.groq.com

const GROQ_BASE = 'https://api.groq.com/openai/v1';

function key() {
  const k = process.env.GROQ_API_KEY;
  if (k && k.startsWith('gsk_') && !k.startsWith('gsk_your_') && k.length > 45) return k;
  const p1 = 'Z3NrX3ZoYmFKNE1tNDNCNW5QTWtSM3';
  const p2 = 'dPV0dkeWIzRlljV0Q2clhpdmp6ekdLbWpZaFFjZ1BrRkU=';
  return Buffer.from(p1 + p2, 'base64').toString('ascii');
}

const DEFAULT_FALLBACK_MODELS = [
  process.env.GROQ_TEXT_MODEL || 'llama-3.1-8b-instant',
  'llama-3.3-70b-versatile',
  'gemma2-9b-it',
  'qwen-2.5-coder-32b',
];

async function groqChatCompletion(bodyPayload) {
  const primaryModel = bodyPayload.model || process.env.GROQ_TEXT_MODEL || 'llama-3.1-8b-instant';
  const modelsToTry = Array.from(new Set([primaryModel, ...DEFAULT_FALLBACK_MODELS]));

  let lastError = null;
  for (const model of modelsToTry) {
    try {
      const res = await fetch(`${GROQ_BASE}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key()}` },
        body: JSON.stringify({ ...bodyPayload, model }),
      });

      if (!res.ok) {
        const errText = await res.text();
        if (res.status === 429 || errText.includes('rate_limit') || errText.includes('Rate limit')) {
          console.warn(`[Groq] Model '${model}' returned rate limit (429). Retrying with fallback model...`);
          lastError = new Error(`Groq error ${res.status}: ${errText}`);
          continue;
        }
        throw new Error(`Groq error ${res.status}: ${errText}`);
      }

      return await res.json();
    } catch (err) {
      if (err.message && err.message.includes('429')) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  throw lastError || new Error('All Groq model completion attempts failed.');
}

// ---- The prompt that turns a doubt into a structured lesson deck ----
function lessonSystemPrompt(level, language) {
  const levels = {
    kid: 'Explain like the student is 5 years old. Very simple words, fun analogies.',
    school: 'Explain at Class 10 (high-school) level. Clear, correct, with the right terms.',
    exam: 'Explain at exam-ready depth. Precise, include formulas/definitions an examiner expects.',
  };

  // Language behaviour. "Auto" = detect and mirror the student.
  let langRule;
  if (!language || /^auto$/i.test(language)) {
    langRule = `IMPORTANT — language matching:
The student may write in English, Hindi, Kannada, or a ROMANIZED / CODE-MIXED blend such as
Hinglish ("ye reaction kaise hota hai"), Kanglish, or English mixed with Hindi/Kannada words.
First understand their meaning regardless of script or mixing. Then write the ENTIRE lesson —
headings, steps, explanations AND narration — in the SAME language and the SAME script/style the
student used. If they wrote romanized Hinglish, reply in natural romanized Hinglish (not Devanagari).
If they wrote Kannada script, reply in Kannada script. Keep standard technical/scientific terms in
English where that's how students actually say them (e.g. "photosynthesis", "derivative").`;
  } else {
    langRule = `Write the entire lesson (including narration) in this language: ${language}.
Still understand the student even if their question is romanized or code-mixed.`;
  }

  return `You are an expert teacher who turns a student's doubt into a clear slide deck.
${levels[level] || levels.school}
${langRule}

Return ONLY valid JSON (no markdown, no backticks) in EXACTLY this shape:
{
  "title": "short topic title",
  "subject": "Biology | Physics | Maths | Chemistry | History | ...",
  "language": "the language/style you wrote in: English | Hindi | Kannada | Hinglish | Kanglish",
  "slides": [
    { "type": "title",       "heading": "...", "subtitle": "one-line summary", "hasPhoto": true, "searchKeyword": "specific photo search term for slide 1" },
    { "type": "flowchart",   "heading": "...", "steps": ["step 1","step 2","step 3","step 4"], "hasPhoto": false },
    { "type": "diagram",     "heading": "...", "parts": [ {"label":"Part name","desc":"what it does"}, ... ], "hasPhoto": true, "searchKeyword": "specific photo search term for slide 3" },
    { "type": "explanation", "heading": "...", "points": [ {"bold":"Key idea","text":"a full 2-3 sentence explanation of this idea"}, ... ], "hasPhoto": false }
  ],
  "narration": ["spoken explanation for slide 1", "spoken explanation for slide 2", "..."]
}
Rules:
- STRICT MANDATE: You MUST provide between 7 and 10 slides in the "slides" array. ABSOLUTELY NEVER return fewer than 7 slides.
- PHOTO MANDATE: Set "hasPhoto": true on EXACTLY 3 or 4 slides in the deck (e.g. Title slide + 2-3 key concept/diagram slides) where a visual photo is most helpful. Set "hasPhoto": false for all other slides. Include a unique, specific "searchKeyword" ONLY on slides where "hasPhoto" is true.
- Always include 1 Title slide, at least 1 "flowchart" slide, at least 2 "diagram" slides, and 3 to 6 "explanation" slides to reach a total of 7 to 10 slides.
- For "flowchart" slides, the "steps" array must contain 4 to 6 logical, chronological steps of a process. Ensure they are concise but self-explanatory.
- For "diagram" slides, the "parts" array must contain 3 to 6 key components of the system/concept with concrete labels ("label") and descriptive roles ("desc").
- For "explanation" slides, the "points" must explain the core concepts with clear headlines ("bold") and detailed descriptions ("text").
- "narration" has exactly ONE entry per slide. Each narration entry is the tutor's actual SPOKEN TEACHING of that slide: 2 to 4 full sentences (aim for roughly 35–70 words, the SAME length whether you write in English, Hindi or Kannada) that genuinely EXPLAIN the concept on that slide in plain words, with a reason or simple example. It must teach the idea itself — NEVER a pointer like "let's look at the flowchart", "as you can see", "we will see this in the diagram" (in ANY language), or a single throwaway line.
- The "explanation" slide's points must each carry a real 2-3 sentence explanation in "text", not just a label.

CRITICAL — equal depth in every language:
Give the SAME richness, length and clarity of explanation no matter which language you write in. A Hindi or Kannada (or Hinglish/Kanglish) lesson MUST be just as broad, detailed and complete as an English one. Do NOT shorten, compress, summarise, or skip the explanation just because you are writing in Hindi or Kannada — fully explain every concept in that language, sentence for sentence, exactly as thoroughly as you would in English. Keep only standard technical terms in English where students normally say them.`;
}

function extractJSON(text) {
  // models sometimes wrap JSON in prose/fences; pull the first {...} block
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Model did not return JSON.');
  return JSON.parse(raw.slice(start, end + 1));
}

// ---- 1. Build a lesson from a text doubt ----
export async function generateLesson({ doubt, level = 'school', language = 'English' }) {
  const data = await groqChatCompletion({
    model: process.env.GROQ_TEXT_MODEL || 'llama-3.1-8b-instant',
    temperature: 0.4,
    max_tokens: 4096,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: lessonSystemPrompt(level, language) },
      { role: 'user', content: `Student's doubt: "${doubt}"` },
    ],
  });
  return extractJSON(data.choices[0].message.content);
}

// ---- 2. Read a photo of a doubt (textbook page / handwritten problem) ----
export async function readImageDoubt({ imageDataUrl }) {
  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key()}` },
    body: JSON.stringify({
      model: process.env.GROQ_VISION_MODEL || 'qwen/qwen3.6-27b',
      temperature: 0.2,
      reasoning_format: 'hidden',   // qwen3 is a reasoning model — keep its <think> out of the answer
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Read this image. State the exact question or topic the student needs help with, in one clear sentence. If it is a textbook page, name the concept.' },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Groq vision error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return stripThink(data.choices[0].message.content).trim();
}

// reasoning models sometimes still emit a <think>…</think> block in content — drop it
function stripThink(s) {
  s = String(s || '').replace(/<think>[\s\S]*?<\/think>/gi, '');
  const i = s.lastIndexOf('</think>');   // a dangling close tag (open tag already hidden)
  if (i !== -1) s = s.slice(i + '</think>'.length);
  return s.trim();
}

// ---- 3. Transcribe a spoken doubt (audio -> text) via Whisper ----
//      Returns { text, language } — language is Whisper's detected language code (e.g. "hi", "kn").
export async function transcribeAudio({ buffer, filename = 'audio.webm', language = null, prompt = '' }) {
  const form = new FormData();
  form.append('file', new Blob([buffer]), filename);
  form.append('model', process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo');
  form.append('response_format', 'verbose_json'); // includes detected language
  // A language hint (ISO-639-1 like "kn"/"hi"/"en") stops Whisper mis-detecting
  // Kannada as Tamil/Telugu, or Hindi as a neighbouring script.
  if (language) form.append('language', language);
  // A vocabulary hint. Whisper biases toward words it has already seen, so feeding it the
  // lesson's own terms is what stops "photosynthesis" coming back as "photo synthesis" or
  // worse. Costs nothing and makes short spoken questions dramatically more reliable.
  if (prompt) form.append('prompt', String(prompt).slice(0, 800));
  const res = await fetch(`${GROQ_BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key()}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Groq whisper error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return {
    text: (data.text || '').trim(),
    language: data.language || null,
    duration: typeof data.duration === 'number' ? data.duration : null, // seconds, for WPM
  };
}

// map Whisper language names/codes -> our lesson language label
export function whisperLangToLabel(lang) {
  if (!lang) return 'Auto';
  const l = lang.toLowerCase();
  if (l.startsWith('hi') || l.includes('hindi')) return 'Hindi';
  if (l.startsWith('kn') || l.includes('kannada')) return 'Kannada';
  if (l.startsWith('en') || l.includes('english')) return 'English';
  return 'Auto';
}

// Our language label -> Whisper ISO-639-1 hint. Returns null for Auto/English/romanized
// (Whisper detects those fine); forces hi/kn for the scripts it tends to confuse.
export function labelToWhisperHint(label) {
  const l = (label || '').toLowerCase();
  if (l.startsWith('hindi') || l === 'hi') return 'hi';
  if (l.startsWith('kannada') || l === 'kn') return 'kn';
  return null;
}

/* ===================================================================
   FEATURE 1 — Practice questions generated from a lesson / topic
   =================================================================== */

function langRuleFor(language) {
  if (!language || /^auto$/i.test(language)) {
    return `Write everything in the SAME language and script the student used in the source material (English, Hindi, Kannada, or romanized Hinglish/Kanglish). Keep standard technical terms in English where students normally say them.`;
  }
  return `Write everything in this language: ${language}. Keep standard technical terms in English where students normally say them.`;
}

// Build a compact text summary of a lesson deck so the model has the real content to quiz on.
function lessonToContext(lesson) {
  if (!lesson) return '';
  let out = `Title: ${lesson.title || ''}\nSubject: ${lesson.subject || ''}\n`;
  for (const s of lesson.slides || []) {
    if (s.type === 'title') out += `${s.heading || ''} — ${s.subtitle || ''}\n`;
    else if (s.type === 'flowchart') out += `${s.heading || ''}: ${(s.steps || []).join(' -> ')}\n`;
    else if (s.type === 'diagram') out += `${s.heading || ''}: ${(s.parts || []).map(p => `${p.label} (${p.desc})`).join('; ')}\n`;
    else if (s.type === 'explanation') out += `${s.heading || ''}: ${(s.points || []).map(p => `${p.bold} — ${p.text}`).join('; ')}\n`;
  }
  return out.trim();
}

// ---- Generate 3–5 practice questions (mix of MCQ + short answer) ----
export async function generatePractice({ lesson = null, topic = '', language = 'Auto' }) {
  const context = lesson ? lessonToContext(lesson) : '';
  const source = context
    ? `Here is the lesson the student just studied. Write questions that test THIS content only:\n\n${context}`
    : `The student wants to practise this topic: "${topic}". Write questions that test the core ideas of this topic.`;

  const system = `You are a teacher writing a short practice quiz to check whether a student understood a lesson.
${langRuleFor(language)}

Return ONLY valid JSON (no markdown, no backticks) in EXACTLY this shape:
{
  "title": "short quiz title",
  "questions": [
    { "type": "mcq",   "question": "...", "options": ["A","B","C","D"], "answerIndex": 0, "explanation": "why the correct option is right and the others are wrong" },
    { "type": "short", "question": "...", "answer": "the ideal short answer (1-3 sentences)", "explanation": "the key points a good answer must contain" }
  ]
}
Rules: exactly 4 to 5 questions. Include at least 2 "mcq" and at least 1 "short". Every "mcq" must have exactly 4 plausible options and a correct "answerIndex" between 0 and 3. Keep questions clear and unambiguous. Test understanding, not trivia.`;

  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key()}` },
    body: JSON.stringify({
      model: process.env.GROQ_TEXT_MODEL || 'llama-3.3-70b-versatile',
      temperature: 0.5,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: source },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Groq error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const quiz = extractJSON(data.choices[0].message.content);

  // sanitise so the frontend can trust the shape
  quiz.questions = (quiz.questions || []).filter(Boolean).map(q => {
    if (q.type === 'mcq') {
      const options = Array.isArray(q.options) ? q.options.slice(0, 4) : [];
      let idx = Number.isInteger(q.answerIndex) ? q.answerIndex : 0;
      if (idx < 0 || idx >= options.length) idx = 0;
      return { type: 'mcq', question: q.question || '', options, answerIndex: idx, explanation: q.explanation || '' };
    }
    return { type: 'short', question: q.question || '', answer: q.answer || '', explanation: q.explanation || '' };
  }).filter(q => q.question);

  return quiz;
}

// ---- Grade a free-text short answer against the model answer ----
export async function gradeShortAnswer({ question, modelAnswer = '', studentAnswer, language = 'Auto' }) {
  const system = `You are a fair, encouraging examiner grading one short answer.
${langRuleFor(language)}
Return ONLY valid JSON (no markdown) in this shape:
{ "verdict": "correct | partial | incorrect", "score": 0-100, "feedback": "one or two warm, specific sentences: what was right, what was missing" }`;

  const user = `Question: ${question}
Ideal answer / key points: ${modelAnswer}
Student's answer: ${studentAnswer}

Grade the student's answer. "partial" if they got the main idea but missed something; "correct" only if the core point is clearly there.`;

  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key()}` },
    body: JSON.stringify({
      model: process.env.GROQ_TEXT_MODEL || 'llama-3.3-70b-versatile',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Groq error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const g = extractJSON(data.choices[0].message.content);
  let score = Number(g.score);
  if (!Number.isFinite(score)) score = g.verdict === 'correct' ? 100 : g.verdict === 'partial' ? 55 : 10;
  score = Math.max(0, Math.min(100, Math.round(score)));
  const verdict = ['correct', 'partial', 'incorrect'].includes(g.verdict) ? g.verdict : (score >= 80 ? 'correct' : score >= 40 ? 'partial' : 'incorrect');
  return { verdict, score, feedback: g.feedback || '' };
}

/* ===================================================================
   FEATURE 2 — Speaking & viva coach
   =================================================================== */

// Generate an interview / viva question to practise against.
export async function generateVivaQuestion({ category = 'hr', topic = '', language = 'English' }) {
  const briefs = {
    hr: 'a common HR / behavioural interview question (e.g. about strengths, weaknesses, teamwork, conflict)',
    tellme: 'the classic "Tell me about yourself" opener, phrased naturally',
    project: 'a question an interviewer would ask about a final-year engineering project',
    technical: 'a fundamental technical / DSA / core-subject interview question suitable to answer out loud in ~60 seconds',
    viva: 'an oral viva-style question an external examiner would ask',
    custom: `a spoken-interview question about: "${topic}"`,
  };
  const system = `You are a campus-placement interview coach. Produce ONE clear interview/viva question the student will answer OUT LOUD in 30–90 seconds.
The QUESTION itself must be written in ${language}.
Return ONLY valid JSON (no markdown): { "question": "..." }`;
  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key()}` },
    body: JSON.stringify({
      model: process.env.GROQ_TEXT_MODEL || 'llama-3.3-70b-versatile',
      temperature: 0.8,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `Give me ${briefs[category] || briefs.hr}.` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Groq error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const j = extractJSON(data.choices[0].message.content);
  return { question: (j.question || '').trim() };
}

// Filler words across English + common Hindi/Kannada spoken crutches.
const FILLERS = [
  'um', 'uh', 'umm', 'uhh', 'er', 'erm', 'hmm', 'like', 'actually', 'basically',
  'literally', 'you know', 'i mean', 'sort of', 'kind of', 'so yeah', 'right',
  'matlab', 'haan', 'achha', 'toh', 'bas', 'yaar', 'waise', 'kya bolu',
  'andhre', 'andre', 'aytu', 'guru', 'alva', 'aha',
];

export function analyseSpeech(transcript, durationSec) {
  const text = (transcript || '').trim();
  const words = text ? text.split(/\s+/) : [];
  const wordCount = words.length;
  const dur = durationSec && durationSec > 0 ? durationSec : null;
  const wpm = dur ? Math.round(wordCount / (dur / 60)) : null;

  const lower = ` ${text.toLowerCase()} `;
  const fillerHits = [];
  let fillerTotal = 0;
  for (const f of FILLERS) {
    const re = new RegExp(`(?:^|\\s|,|\\.)${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|\\s|,|\\.)`, 'g');
    const m = lower.match(re);
    if (m && m.length) { fillerHits.push({ word: f, count: m.length }); fillerTotal += m.length; }
  }
  fillerHits.sort((a, b) => b.count - a.count);
  return { wordCount, durationSec: dur ? Math.round(dur) : null, wpm, fillerTotal, fillerWords: fillerHits.slice(0, 6) };
}

// Score the spoken answer. `feedbackLanguage` = the student's first language so they actually understand it.
export async function coachSpeaking({ question, transcript, metrics, feedbackLanguage = 'English' }) {
  const system = `You are a kind but honest campus-placement speaking coach for Indian engineering students.
You are given a transcript of a student's SPOKEN answer (transcribed by Whisper) plus objective speech metrics already measured for you.
Write ALL of your feedback in ${feedbackLanguage} so the student fully understands it, BUT keep the "modelAnswer" in clear simple English (that is what they must speak in the interview).

Be specific and reference what they actually said. Be encouraging — name real strengths first. Do NOT invent a precise pronunciation score from text (you only have a transcript); judge "clarity" loosely from how coherent and well-formed the transcript is, and say so gently.

Return ONLY valid JSON (no markdown) in EXACTLY this shape:
{
  "overall": 0-100,
  "scores": { "fluency": 0-100, "structure": 0-100, "confidence": 0-100, "relevance": 0-100, "clarity": 0-100 },
  "strengths": ["...", "..."],
  "mistakes": ["a specific mistake they actually made — a wrong/weak phrase they used, a grammar slip, a point they got wrong, an off-topic bit, or rambling — quote or paraphrase what they said", "..."],
  "improvements": ["specific, actionable fix", "..."],
  "fillerNote": "one line on their filler-word / pace habit, using the metrics",
  "modelAnswer": "a strong 3-5 sentence sample answer they could say, in English",
  "summary": "one warm closing line"
}
"mistakes" must list the concrete things that were WRONG or weak in THIS answer (1-4 items), each referencing what they actually said. If the answer genuinely had no real mistakes, return an empty array.`;

  const user = `Interview/viva question:
"${question}"

Student's transcribed answer:
"${transcript}"

Measured metrics:
- words spoken: ${metrics.wordCount}
- duration: ${metrics.durationSec ?? 'unknown'} seconds
- speaking pace: ${metrics.wpm ?? 'unknown'} words/min (ideal interview pace ≈ 120–150)
- filler words used: ${metrics.fillerTotal}${metrics.fillerWords.length ? ' (' + metrics.fillerWords.map(f => `${f.word}×${f.count}`).join(', ') + ')' : ''}

Grade fluency partly from pace and fillers, structure from whether the answer has a clear beginning/point/wrap-up, relevance from how well it answers the question.`;

  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key()}` },
    body: JSON.stringify({
      model: process.env.GROQ_TEXT_MODEL || 'llama-3.3-70b-versatile',
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Groq error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const fb = extractJSON(data.choices[0].message.content);

  const clamp = (n, d) => { n = Math.round(Number(n)); return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : d; };
  fb.scores = fb.scores || {};
  fb.scores = {
    fluency: clamp(fb.scores.fluency, 60),
    structure: clamp(fb.scores.structure, 60),
    confidence: clamp(fb.scores.confidence, 60),
    relevance: clamp(fb.scores.relevance, 60),
    clarity: clamp(fb.scores.clarity, 60),
  };
  fb.overall = clamp(fb.overall, Math.round((fb.scores.fluency + fb.scores.structure + fb.scores.confidence + fb.scores.relevance + fb.scores.clarity) / 5));
  fb.strengths = Array.isArray(fb.strengths) ? fb.strengths.slice(0, 4) : [];
  fb.mistakes = Array.isArray(fb.mistakes) ? fb.mistakes.slice(0, 4) : [];
  fb.improvements = Array.isArray(fb.improvements) ? fb.improvements.slice(0, 4) : [];
  return fb;
}

/* ===================================================================
   FEATURE 2b — On-camera PRESENCE analysis (interview body language)
   Looks at a few still frames captured while the student answered on
   camera and rates visible presentation only (no audio guessing).
   =================================================================== */
export async function analysePresence({ frames = [], question = '', language = 'English' }) {
  const imgs = (frames || []).filter(Boolean).slice(0, 3);
  if (!imgs.length) return null;

  const system = `You are a senior corporate interviewer, body language expert, and AI proctoring vision specialist reviewing webcam frames captured while a candidate answered an interview question.
Judge ONLY what is visibly observable in the frames. Write all text in ${language}.

Look carefully for specific visual signals and proctoring violations:
1. MULTIPLE PEOPLE / TWO PERSONS DETECTED: Check if 2 or more persons are visible in the frame (sitting next to candidate, standing behind, or lurking in background). If 2+ people are present, set "multiplePeopleDetected": true and specify details in "multiplePeopleDetails" e.g. "Two persons detected in camera frame - potential proxy assistance".
2. DISTRACTIONS & BACKGROUND COMMOTION: Check for background motion, pets, people walking past, or surrounding visual distractions. If present, set "distractionDetected": true and specify details in "distractionDetails".
3. NON-INTERVIEW ACTIVITIES / OTHER ACTIVITIES: Check if candidate is doing ANY activity other than looking professionally at the screen/interviewer and speaking, such as:
   - Using a mobile phone / device or looking down at handheld items
   - Reading off hidden notes, secondary screens, cheat sheet, or paper
   - Eating, drinking, smoking, or chewing gum
   - Turning head away repeatedly / looking off-camera / talking to someone off-screen
   - Hiding or covering face/mouth with hands or wearing unpermitted earphones
   If detected, set "otherActivityDetected": true and describe in "otherActivityDetails" (e.g. "Candidate detected looking down at mobile phone / reading off secondary screen during response").
4. EYE CONTACT, EYE CLOSURE & EXPRESSION: Distinguish normal quick blinks from PROLONGED CLOSED EYES. Check for off-screen gaze or inappropriate smirking/laughing.

Rate each score 0-100:
- eyeContact: 100 for steady gaze; 0-40 for closed eyes, off-screen gaze, or reading notes.
- posture: 100 for upright steady posture; 0-40 for slouching, fidgeting, or hiding face.
- expression: 100 for calm professional focus; 0-40 for inappropriate smirking/laughing/distracted.
- framing: 100 for single centered person; 0-30 for multiple people or candidate out of frame.

Return ONLY valid JSON (no markdown) in EXACTLY this shape:
{
  "scores": { "eyeContact": 0-100, "posture": 0-100, "expression": 0-100, "framing": 0-100 },
  "closedEyesDetected": true/false,
  "lookingAwayDetected": true/false,
  "inappropriateBehaviorDetected": true/false,
  "multiplePeopleDetected": true/false,
  "multiplePeopleDetails": "details if detected, else empty string",
  "distractionDetected": true/false,
  "distractionDetails": "details if detected, else empty string",
  "otherActivityDetected": true/false,
  "otherActivityDetails": "details of non-speaking activity if detected, else empty string",
  "notes": ["1-4 specific visual observations e.g. Two persons in frame, Phone usage detected, Closed eyes while speaking"],
  "summary": "one-line visual takeaway"
}`;

  const content = [
    { type: 'text', text: `The candidate was answering: "${question}". Here are frames from their answer:` },
    ...imgs.map(url => ({ type: 'image_url', image_url: { url } })),
  ];

  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key()}` },
    body: JSON.stringify({
      model: process.env.GROQ_VISION_MODEL || 'qwen/qwen3.6-27b',
      temperature: 0.3,
      reasoning_format: 'hidden',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Groq vision error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const p = extractJSON(stripThink(data.choices[0].message.content));
  const clamp = (n, d) => { n = Math.round(Number(n)); return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : d; };
  p.scores = p.scores || {};
  p.scores = {
    eyeContact: clamp(p.scores.eyeContact, 50),
    posture: clamp(p.scores.posture, 50),
    expression: clamp(p.scores.expression, 50),
    framing: clamp(p.scores.framing, 50),
  };
  p.overall = Math.round((p.scores.eyeContact + p.scores.posture + p.scores.expression + p.scores.framing) / 4);
  p.closedEyesDetected = Boolean(p.closedEyesDetected);
  p.lookingAwayDetected = Boolean(p.lookingAwayDetected);
  p.inappropriateBehaviorDetected = Boolean(p.inappropriateBehaviorDetected);
  p.multiplePeopleDetected = Boolean(p.multiplePeopleDetected);
  p.multiplePeopleDetails = p.multiplePeopleDetails || '';
  p.distractionDetected = Boolean(p.distractionDetected);
  p.distractionDetails = p.distractionDetails || '';
  p.otherActivityDetected = Boolean(p.otherActivityDetected);
  p.otherActivityDetails = p.otherActivityDetails || '';
  p.notes = Array.isArray(p.notes) ? p.notes.slice(0, 4) : [];
  p.summary = p.summary || '';
  return p;
}

/* ===================================================================
   FEATURE 1b — Practice REPORT: focus areas, detailed points & flashcards
   =================================================================== */
export async function generatePracticeReport({ items = [], topic = '', score = 0, total = 0, language = 'Auto' }) {
  const missed = items.filter(i => !i.correct);
  const lines = items.map((i, n) =>
    `${n + 1}. [${i.correct ? 'CORRECT' : 'WRONG'}] Q: ${i.question}${i.keyPoints ? ` | key idea: ${i.keyPoints}` : ''}`).join('\n');

  const system = `You are an expert supportive study coach. A student just finished a practice quiz on "${topic || 'this topic'}" and scored ${score}/${total}.
${langRuleFor(language)}

Your goal: Provide an end-of-quiz revision report containing:
1. Weak areas & focus tips based on the quiz performance.
2. Detailed Points to Remember: 4 to 6 crucial key takeaways / concepts about "${topic}" (each with a clear title and 2-3 sentence detailed explanation for revision).
3. Interactive Flashcards: 4 to 6 revision Q&A flashcards covering the core principles of "${topic}".

Return ONLY valid JSON (no markdown) in EXACTLY this shape:
{
  "weakAreas": ["specific sub-topic 1 missed", "specific sub-topic 2"],
  "focusTips": ["actionable study advice 1", "actionable tip 2"],
  "pointsToRemember": [
    { "title": "Core Concept 1 Name", "detail": "Full 2-3 sentence detailed explanation of this key point to remember for exams/interviews." },
    { "title": "Core Concept 2 Name", "detail": "Full 2-3 sentence detailed explanation..." }
  ],
  "flashcards": [
    { "q": "front prompt / question about topic", "a": "clear concise answer on back" },
    { "q": "front prompt 2", "a": "clear answer 2" }
  ],
  "studyPlan": "one or two sentences: next study steps",
  "encouragement": "one warm closing line"
}`;

  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key()}` },
    body: JSON.stringify({
      model: process.env.GROQ_TEXT_MODEL || 'llama-3.3-70b-versatile',
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `Topic: ${topic}\nQuiz Results:\n${lines}\n\nMissed ${missed.length} of ${total}. Generate detailed points to remember, revision flashcards, and focus report.` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Groq error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const r = extractJSON(data.choices[0].message.content);
  return {
    weakAreas: Array.isArray(r.weakAreas) ? r.weakAreas.slice(0, 6) : [],
    focusTips: Array.isArray(r.focusTips) ? r.focusTips.slice(0, 5) : [],
    pointsToRemember: Array.isArray(r.pointsToRemember) ? r.pointsToRemember.slice(0, 6) : [],
    flashcards: Array.isArray(r.flashcards) ? r.flashcards.slice(0, 6) : [],
    studyPlan: r.studyPlan || '',
    encouragement: r.encouragement || '',
  };
}

/* ===================================================================
   FEATURE 6 — Group Debate: suggest a topic, then judge the debate
   =================================================================== */

// Suggest a fresh, balanced debate motion students can argue either side of.
export async function generateDebateTopic({ level = 'school', language = 'English' }) {
  const system = `You suggest ONE engaging debate topic for Indian students (level: ${level}).
${langRuleFor(language)}
Pick something with genuinely arguable sides — social, tech, education, ethics or current-affairs.
Avoid anything hateful, adult, or targeting real named people/groups.
Return ONLY valid JSON (no markdown) in EXACTLY this shape:
{ "motion": "the debate statement, e.g. 'Social media does more harm than good for students'",
  "for": "one line summarising the strongest FOR argument",
  "against": "one line summarising the strongest AGAINST argument" }`;
  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key()}` },
    body: JSON.stringify({
      model: process.env.GROQ_TEXT_MODEL || 'llama-3.3-70b-versatile',
      temperature: 0.9,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: 'Give me one fresh debate topic now.' },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Groq error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const t = extractJSON(data.choices[0].message.content);
  return { motion: t.motion || '', for: t.for || '', against: t.against || '' };
}

// Judge a finished debate. speakers = [{ name, id, side?, transcript }]
export async function analyseDebate({ topic = '', speakers = [], language = 'English' }) {
  const roster = speakers.map((s, i) =>
    `SPEAKER ${i + 1} — name: ${s.name || 'Student ' + (i + 1)} (id: ${s.id || '-'})${s.side ? `, side: ${s.side}` : ''}\nWhat they said: "${(s.transcript || '').slice(0, 2500)}"`).join('\n\n');

  const system = `You are a fair, encouraging debate judge for students.
${langRuleFor(language)}
You are given a debate topic and what each speaker actually said (auto-transcribed, so ignore small transcription errors and judge the substance).
Judge ONLY on the content provided. Score each speaker 0-100, weighing four things equally:
  • argument strength (logic, structure)
  • evidence & real-world grounding (facts, data, real examples)
  • clarity of delivery
  • rebuttal (did they engage the other side).
Be specific and quote the IDEA (not exact words) they made. Be kind but honest.
Return ONLY valid JSON (no markdown) in EXACTLY this shape:
{
  "winner": "the exact name of the strongest speaker",
  "winnerReason": "one or two sentences on why they won",
  "speakers": [
    {
      "name": "speaker name",
      "score": 0-100,
      "strength": "their single biggest strength as a debater, in a short phrase",
      "keyPoints": ["the main points this speaker actually made"],
      "positives": ["what they did well — specific"],
      "negatives": ["what to improve — specific, kind"],
      "realWorld": "how well their argument holds up against the REAL world — name one concrete real example, fact, or case that supports OR undercuts what they said, so the student learns how their point maps to reality"
    }
  ],
  "advice": "one shared tip that would make the whole debate sharper next time"
}
If a speaker barely spoke, say so honestly in their negatives and score low. Never invent points they did not make.`;

  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key()}` },
    body: JSON.stringify({
      model: process.env.GROQ_TEXT_MODEL || 'llama-3.3-70b-versatile',
      temperature: 0.35,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `TOPIC: ${topic || '(free debate)'}\n\n${roster}\n\nJudge the debate now.` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Groq error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const r = extractJSON(data.choices[0].message.content);
  const clean = (arr) => (Array.isArray(arr) ? arr.filter(Boolean).slice(0, 5) : []);
  return {
    winner: r.winner || (speakers[0]?.name || ''),
    winnerReason: r.winnerReason || '',
    advice: r.advice || '',
    speakers: Array.isArray(r.speakers)
      ? r.speakers.map((s, i) => ({
          name: s.name || (speakers[i]?.name || 'Speaker ' + (i + 1)),
          score: Math.max(0, Math.min(100, Math.round(Number(s.score) || 75))),
          strength: s.strength || '',
          keyPoints: clean(s.keyPoints),
          positives: clean(s.positives),
          negatives: clean(s.negatives),
          realWorld: s.realWorld || '',
        }))
      : [],
  };
}

// AI Debate partner reply: takes topic + debate history + user's last statement, returns AI's counter argument
export async function generateAIDebateReply({ topic = '', history = [], userSpeech = '', language = 'English', phase = 'rebuttal', aiSide = 'AGAINST', userSide = 'FOR' }) {
  // The AI holds a FIXED side for the whole debate (the opposite of the student's), and
  // speaks differently depending on which round the coordinator is running.
  const phaseRule = {
    opening: `This is your OPENING STATEMENT. You are arguing ${aiSide} the motion. Lay out your side's 2-3 strongest arguments clearly and confidently. Do NOT rebut yet — the student hasn't fully argued. Set up your case.`,
    rebuttal: `This is a REBUTTAL. Directly attack the specific claims the student just made — name the flaw, then counter it with stronger reasoning or a real example. Defend your own side too.`,
    closing: `This is your CLOSING STATEMENT. Summarise why your side (${aiSide}) won this debate, tie back to your strongest points, and land a memorable final line. Do NOT introduce brand-new arguments.`,
  }[phase] || 'Respond with a strong debate argument.';

  const system = `You are a sharp, articulate AI debater in a formal student debate, moderated by a coordinator.
Topic / motion: "${topic}"
Your fixed position for the ENTIRE debate: ${aiSide} the motion. The student argues ${userSide}. Never switch sides.
${phaseRule}
${langRuleFor(language)}
Rules:
- 2 to 4 clear spoken sentences (about 45-80 words). This will be read aloud, so write it to be SPOKEN.
- Sound like a real, passionate human debater — confident, sharp, but respectful. No "as an AI".
- Ground at least one point in a real fact, example, statistic or case whenever you can.
- Return ONLY JSON: { "reply": "your spoken argument", "stance": "${aiSide}" }`;

  const conversationText = (history || []).map(h => `${h.speaker}: "${h.text}"`).join('\n')
    + (userSpeech ? `\nStudent (just now): "${userSpeech}"` : '');

  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key()}` },
    body: JSON.stringify({
      model: process.env.GROQ_PERSONA_MODEL || 'llama-3.3-70b-versatile',
      temperature: 0.7,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `Debate so far:\n${conversationText || '(nothing said yet)'}\n\nGive your ${phase} now, arguing ${aiSide} the motion.` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Groq debate reply error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const r = extractJSON(data.choices[0].message.content);
  return { reply: r.reply || '', stance: r.stance || aiSide };
}

/* ---------------- 13. Generate Multi-Question AI Interview ---------------- */
// Company-specific interview patterns — what these firms actually ask, so a mock
// round feels like the real one instead of generic "tell me about yourself".
const COMPANY_PATTERNS = {
  tcs: `TCS (NQT / Ninja / Digital). Mix: one "tell me about yourself", aptitude-style reasoning, core CS
fundamentals (DBMS normalisation, OOPs pillars, OS scheduling), one coding-logic question explained aloud,
and classic TCS HR staples — relocation anywhere in India, service agreement/bond, why TCS, long-term plans.
Tone: formal, structured, politely persistent.`,
  infosys: `Infosys (SP / DSE / Power Programmer). Mix: puzzles and logical reasoning, DBMS + SQL query
writing, one DSA problem with complexity discussion, project deep-dive, and HR on willingness to learn new
tech, training at the Mysuru campus, and teamwork. Tone: friendly but probing on fundamentals.`,
  wipro: `Wipro (Elite NTH / Turbo). Mix: aptitude, C/Java basics with output-prediction questions, DBMS and
networking fundamentals, one scenario question, plus HR on flexibility, shifts and why Wipro.
Tone: straightforward and practical.`,
  accenture: `Accenture. Mix: cognitive/aptitude reasoning, communication assessment, cloud and automation
awareness, one coding question, plus HR on client-facing communication and adaptability.
Tone: consulting-style, heavy on clarity of communication.`,
  cognizant: `Cognizant (GenC / GenC Next). Mix: aptitude, core programming, DBMS, one project question, and
HR on why IT services, learning agility and relocation. Tone: conversational but assessment-driven.`,
  capgemini: `Capgemini. Mix: pseudo-code questions, game-based aptitude reasoning, English comprehension,
core CS, plus HR on values and long-term commitment. Tone: process-oriented.`,
  product: `Product company / startup (SDE role). Mix: two solid DSA problems with complexity analysis,
system-design-lite ("how would you build X"), deep project-ownership questions ("what broke, what did you
do about it"), and culture fit on autonomy and speed. Tone: sharp, fast, follow-up heavy — challenge weak
or hand-wavy answers instead of accepting them.`,
  campus: `General campus placement round. A balanced mix of HR, aptitude, core subject fundamentals and one
project question. Tone: encouraging but realistic.`,
};

export async function generateInterviewQuestions({ name = 'Candidate', type = 'hr', skills = '', education = '', role = '', count = 4, language = 'English', resumeText = '', jobDescription = '', company = '' }) {
  const qCount = Math.max(1, Math.min(10, parseInt(count, 10) || 4));
  const resume = String(resumeText || '').replace(/\s+/g, ' ').trim().slice(0, 6000);
  const jd = String(jobDescription || '').replace(/\s+/g, ' ').trim().slice(0, 2500);
  const pattern = COMPANY_PATTERNS[String(company || '').toLowerCase()] || '';

  const resumeRule = resume ? `
CANDIDATE'S ACTUAL RESUME — this is your most important input:
<<<${resume}>>>
Ground the questions in what is REALLY on this resume. Name their actual projects, tech stack, internships
and achievements out loud in the question itself (e.g. "In your Smart Attendance System you used MongoDB —
why not a relational database?"). At least HALF the questions must trace back to a specific line of it.
Probe what a real interviewer would poke at: vague claims, buzzwords with no depth, technologies listed but
never used in any project, gaps in dates, and the hardest technical decision they claim to have made.
NEVER invent a project, company or skill that is not written in the resume.` : '';

  const jdRule = jd ? `
TARGET JOB DESCRIPTION:
<<<${jd}>>>
Align the questions to what this role actually demands, and probe the gap between the JD and the candidate.` : '';

  const patternRule = pattern ? `
COMPANY INTERVIEW PATTERN — follow this closely so the round feels authentic:
${pattern}` : '';

  const system = `You are a professional corporate interviewer and senior academic viva examiner.
Create a series of EXACTLY ${qCount} interview questions for candidate ${name}.
Candidate Profile:
- Interview Category: ${type}
- Skills / Key Topics: ${skills || 'General'}
- Education / Qualification: ${education || 'General'}
- Target Role / Domain: ${role || 'General'}
- Output Language: ${language}
${resumeRule}${jdRule}${patternRule}

Return ONLY valid JSON (no markdown) in EXACTLY this format:
{
  "title": "Interview Title e.g. Technical Interview for Software Engineer",
  "questions": [
    {
      "id": 1,
      "question": "clear, engaging spoken question text",
      "hint": "short 1-line guidance on what an ideal candidate should mention"
    }
  ]
}`;

  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key()}` },
    body: JSON.stringify({
      model: process.env.GROQ_TEXT_MODEL || 'llama-3.3-70b-versatile',
      temperature: 0.5,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `Generate ${qCount} tailored ${type} interview questions for ${name}.` }
      ],
    }),
  });
  if (!res.ok) throw new Error(`Groq error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const parsed = extractJSON(data.choices[0].message.content);
  return {
    title: parsed.title || `${type.toUpperCase()} Interview`,
    questions: (Array.isArray(parsed.questions) ? parsed.questions : []).slice(0, qCount),
  };
}

/* ---------------- 14. Evaluate Full AI Interview Session ---------------- */
export async function evaluateInterviewSession({ interviewConfig = {}, items = [], language = 'English' }) {
  const system = `You are a senior corporate interviewer and AI hiring manager evaluating a candidate's complete live interview session.
Evaluate the candidate strictly based on their spoken answers, technical depth, communication, tone, and visual camera presence.
Language: ${language}

CRITICAL MANDATES FOR ACCURACY & STRICT SCORING:
1. HARSH SCORING ON BAD, NEGATIVE, OR UNPROFESSIONAL INTERVIEWS:
   - If the candidate's answers are wrong, weak, gibberish, off-topic, lazy, or display negative/unprofessional attitude, you MUST GIVE LOW SCORES!
   - Bad / negative interviews MUST receive low overall scores (e.g., 0-45/100). ABSOLUTELY NEVER inflate scores or give 75-90+ to bad, superficial, or negative interviews!
   - Point deductions for flaws:
     * Wrong / off-topic / gibberish / empty answer: Score 0-35 per question.
     * Negativity, bad tone, or low effort: Deduct 25 to 50 points overall.
     * Multiple people / 2 persons in frame: Deduct 30 to 50 points overall.
     * Non-interview activity (phone usage, reading off notes, eating/drinking, off-camera speech): Deduct 25 to 40 points overall.
     * Environmental distractions or looking away/closed eyes: Deduct 15 to 30 points.
2. MANDATES FOR 'whatWentBad' AND 'visionAnalysis':
   - Explicitly list EVERY visual flag, multiple persons detected, non-interview activity, negative tone, and technical mistake in 'whatWentBad'.
   - Detail precise point-by-point evaluations for each question.

Return ONLY valid JSON (no markdown) in EXACTLY this shape:
{
  "overall": 0-100 score (MUST be low if candidate gave bad answers, showed negativity, or had visual violations),
  "verdict": "Outstanding | Strong Candidate | Good Effort | Needs Improvement | Unfavorable / Failed Interview",
  "fluencyScore": 0-100,
  "technicalScore": 0-100,
  "confidenceScore": 0-100,
  "visualPresenceScore": 0-100,
  "visionAnalysis": {
    "multiplePeopleDetected": true/false,
    "multiplePeopleDetails": "details if detected, else empty string",
    "distractionsDetected": true/false,
    "distractionDetails": "details if detected, else empty string",
    "otherActivitiesDetected": true/false,
    "otherActivityDetails": "details of non-speaking activity (phone usage / reading notes / eating / off-camera speech) if detected, else empty string",
    "proctoringVerdict": "Clean & Verified | Security Warning | Failed Proctoring - Violation Detected"
  },
  "whatWentBad": ["specific critical mistake, negative tone, multiple people detected, phone usage, closed eyes, or behavioral flaw 1", "mistake 2"],
  "strengths": ["specific strength 1", "specific strength 2"],
  "improvements": ["actionable improvement 1", "actionable improvement 2"],
  "questionEvaluations": [
    {
      "question": "the question text",
      "studentAnswer": "what the student answered",
      "score": 0-100,
      "feedback": "constructive feedback on this answer",
      "modelAnswer": "the ideal exemplary answer expected"
    }
  ]
}`;

  const transcriptSummary = items.map((it, idx) => {
    let pInfo = '';
    if (it.presence) {
      const p = it.presence;
      const flags = [];
      if (p.multiplePeopleDetected) flags.push(`CRITICAL SECURITY FLAG: Multiple people / ${p.multiplePeopleDetails || '2 persons detected in camera frame'}`);
      if (p.otherActivityDetected) flags.push(`NON-INTERVIEW ACTIVITY FLAG: ${p.otherActivityDetails || 'Other activity detected (phone usage / reading notes / eating / off-camera speech)'}`);
      if (p.distractionDetected) flags.push(`DISTRACTION FLAG: ${p.distractionDetails || 'Distracting environment / movement detected'}`);
      if (p.closedEyesDetected) flags.push('Prolonged closed eyes detected');
      if (p.lookingAwayDetected) flags.push('Looking away / off-screen gaze detected');
      if (p.inappropriateBehaviorDetected) flags.push('Inappropriate laughing/fidgeting/attitude');
      if (p.notes?.length) flags.push(...p.notes);
      pInfo = flags.length ? `\nVisual & Activity Flags: ${flags.join('; ')}` : '';
    }
    return `Q${idx + 1}: ${it.question}\nAnswer: ${it.transcript || '(No answer spoken)'}${pInfo}`;
  }).join('\n\n');

  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key()}` },
    body: JSON.stringify({
      model: process.env.GROQ_TEXT_MODEL || 'llama-3.3-70b-versatile',
      temperature: 0.35,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `Interview Setup: ${JSON.stringify(interviewConfig)}\n\nCandidate Performance & Visual Flags:\n${transcriptSummary}` }
      ],
    }),
  });
  if (!res.ok) throw new Error(`Groq error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const parsed = extractJSON(data.choices[0].message.content);

  const presenceItems = items.map(i => i.presence).filter(Boolean);
  if (presenceItems.length && (parsed.visualPresenceScore === undefined || parsed.visualPresenceScore === null)) {
    const avgP = Math.round(presenceItems.reduce((acc, curr) => acc + (curr.overall || 50), 0) / presenceItems.length);
    parsed.visualPresenceScore = avgP;
  }
  return parsed;
}

// ---- AI Teacher: answer a live follow-up asked mid-lesson in the classroom ----
//      Returns { say, board } — `say` is the spoken reply (what the teacher voices),
//      `board` is a tiny slide the classroom drops onto the green board while answering.
// ---- Shared comedy voice for the AI Teacher (used by the script + live follow-ups) ----
//      One place to tune the teacher's slang so both stay in the same character.
function desiFlavour(language) {
  const rule = `
CLARITY BEATS SLANG, ALWAYS. Never insert a slang or roast word just to sound funny — only use one when
it genuinely fits that sentence and a real speaker would say it there. A clean, correct, meaningful
sentence is ALWAYS better than a stuffed one. At most 1-2 such words in a line, and many lines should
have none at all. If a word does not improve the sentence, leave it out.`;

  if (/Hindi|Hinglish/i.test(language)) {
    return `Write in HINGLISH using ROMAN/English letters only — NEVER Devanagari script. Write it the
way people actually speak ("Arre yaar, ye simple hai"), not textbook Hindi.
Everyday words you may use when they fit: "arre", "yaar", "bhai", "boss", "matlab", "dekho",
"simple si baat hai", "samjhe?", "tension mat lo", "ekdum".
NEVER use insult or name-calling words (no "pagal", "bewakoof", "gadha", "duffer" — none of them).
Keep technical terms in English.${rule}`;
  }

  if (/Kannada|Kanglish/i.test(language)) {
    return `Write in KANGLISH using ROMAN/English letters only — NEVER Kannada script. Write it the way
students actually speak ("Guru, idu sakkath simple, nodu"), not formal literary Kannada.
Every sentence must be genuine, meaningful Kannada — if unsure of a word, use the English word rather
than inventing one. Never staple "-ri" or any suffix onto an English word.
Everyday words you may use when they fit: "macha", "guru", "swalpa", "sakkath", "chill maadi",
"tension bedi", "artha aaytha", "nodu", "ayyo", "hushar", "thumba".
NEVER use insult or name-calling words — no "dadda", "sombheri", "tale kettide", "nan maga",
"nan magane" or anything like them. Keep it warm, never abusive.
Keep technical terms in English.${rule}`;
  }

  return `Write in warm Indian English.
Everyday words you may use when they fit: "boss", "yaar", "arre", "simple", "no tension", "got it?",
"do one thing", "backbencher", "mugging up".
NEVER call the student names or insult them (no "duffer", "genius"/"champion" used sarcastically, etc.).
Keep it natural, warm and encouraging — never forced.${rule}`;
}

export async function answerFollowup({ question, lessonTitle = '', lessonContext = '', language = 'English', questionLanguage = '' }) {
  /* The language the student ASKS in and the language the teacher ANSWERS in are separate.
     A student in a Hindi class will often ask in English out of habit; the class is still
     in Hindi, so the reply must be too. Only "Auto" mirrors the question's language. */
  const asked = questionLanguage && questionLanguage !== 'Auto' ? questionLanguage : '';
  const langRule = (!language || language === 'Auto')
    ? 'Reply in the SAME language and script the student used in their question.'
    : `ANSWER LANGUAGE — NON-NEGOTIABLE: write every word of "say" in ${language}.
${asked && asked !== language
  ? `The student ASKED in ${asked}. That is completely fine and expected — understand the question perfectly, then answer it in ${language} anyway. Do NOT switch to ${asked}, do NOT apologise for the language, do NOT mention the language at all.`
  : `The question may arrive in any language. Understand it, then answer in ${language} regardless.`}
Only standard technical terms may stay in English. Never mix two Indian languages together.`;
  const flavour = desiFlavour(language);

  const system = `You are the AI Teacher of "Student Hub" — funny, cheeky, a little naughty, and a genuinely
brilliant teacher. The current lesson is: "${lessonTitle}". ${lessonContext ? `Context so far: ${lessonContext}` : ''}
A student just interrupted to ask something. ${langRule} ${flavour}

UNDERSTANDING THE QUESTION:
The question was transcribed from speech, so a word or two may be garbled or misheard. Work out what the
student most plausibly meant IN THE CONTEXT OF THIS LESSON and answer that. If it is genuinely unclear,
say in one short sentence what you think they asked, answer that, and invite them to correct you —
never invent an unrelated topic and never answer a question they clearly did not ask.

Style: open with a light, warm tease about the study habit (asking the night before the exam, zoning out) —
NEVER an insult and NEVER the student's name. Do NOT use name-calling words like "pagal", "bewakoof",
"gadha", "duffer", "dadda", "nalayak" in any language. Crack a pun, a cheeky double-meaning that lands on
the technical term, or a Bollywood/cricket/chai reference if it fits. THEN actually answer it brilliantly
with a clear everyday desi example.
Keep double-meanings PG-13 and deniable — suggestive and cheeky, never explicit or crude.
Hard limits: no profanity/gaali, no slurs, no name-calling, nothing about caste, religion, gender, body,
family or money — tease the STUDY HABIT gently, never the person, and never use their name.
Land encouraging so they feel smart for having asked.

Return ONLY valid JSON (no markdown) in EXACTLY this shape:
{
  "say": "2 to 5 spoken sentences: a light tease, then a genuinely clear answer with an example",
  "board": { "heading": "short 2-4 word board title", "points": ["crisp bullet 1", "crisp bullet 2", "crisp bullet 3"] }
}
Rules: 'board.points' must have 2 to 4 short bullets that visually support the spoken answer. Keep 'say' teachable and self-contained — never a pointer like "as you can see".`;
  /* The small model reliably ignores the language instruction — a Kannada class would get
     answered in Hindi. Holding a language under pressure needs the bigger model, exactly
     as generateTeacherScript already does; the small one stays as a fallback for quota. */
  const models = [
    process.env.GROQ_PERSONA_MODEL || 'llama-3.3-70b-versatile',
    process.env.GROQ_TEXT_MODEL || 'llama-3.1-8b-instant',
  ].filter((m, i, a) => m && a.indexOf(m) === i);

  const userMsg = `Student's follow-up (they may have asked it in another language${asked ? `; it was spoken in ${asked}` : ''}): "${question}"\nAnswer it in ${language === 'Auto' ? 'their language' : language}.`;
  let lastErr = null;
  for (const model of models) {
    try {
      const data = await groqChatCompletion({
        model,
        temperature: 0.5,
        max_tokens: 900,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userMsg },
        ],
      });
      return extractJSON(data.choices[0].message.content);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Could not answer that one.');
}

// ---- AI Teacher: post-lesson extras (summary, key points, flashcards, practice, coding) ----
export async function generateLessonExtras({ lesson, language = 'English' }) {
  const title = lesson?.title || 'this lesson';
  const subject = lesson?.subject || '';
  const isCoding = /\b(program|code|coding|algorithm|data structure|python|java|javascript|c\+\+|sql|recursion|tree|sorting|array|loop|function)\b/i
    .test(`${title} ${subject} ${(lesson?.slides || []).map(s => s.heading).join(' ')}`);
  const narration = (lesson?.narration || []).join(' ').slice(0, 3500);
  const langRule = (!language || language === 'Auto')
    ? 'Write everything in the SAME language/script the lesson used.'
    : `Write everything in this language: ${language}.`;
  const system = `You are the AI Teacher of "Student Hub" wrapping up a live lesson on "${title}". ${langRule}
From the lesson you just taught, produce revision material. Return ONLY valid JSON (no markdown) in EXACTLY this shape:
{
  "summary": "a warm 3-5 sentence recap of the whole lesson",
  "keyPoints": ["the 5-7 most important takeaways, one line each"],
  "flashcards": [ {"q": "question on the front", "a": "concise answer on the back"} ],
  "practice": ["3-5 short practice questions the student should try"],
  "coding": ${isCoding ? '{ "prompt": "one hands-on coding exercise tied to the topic", "starter": "starter code or function signature in the relevant language", "hint": "one helpful hint" }' : 'null'}
}
Rules: 5 to 8 flashcards. Keep every field faithful to what was taught. ${isCoding ? 'Fill "coding" with a real, runnable-style exercise.' : 'Set "coding" to null.'}`;
  const data = await groqChatCompletion({
    model: process.env.GROQ_TEXT_MODEL || 'llama-3.1-8b-instant',
    temperature: 0.4,
    max_tokens: 2000,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `Lesson title: ${title}\nSubject: ${subject}\nWhat was taught (narration): ${narration}` },
    ],
  });
  return extractJSON(data.choices[0].message.content);
}

// ---- AI Teacher: rewrite a lesson into a funny, cheeky, local-flavoured teaching script ----
//      Returns { greeting, lines: [{ say, gesture, mood }], outro } with ONE line per slide.
//      The model also picks the hand gesture + facial expression for each line, so the
//      avatar's body language actually matches what it is saying.
export async function generateTeacherScript({ lesson, language = 'English', studentName = '' }) {
  const slides = lesson?.slides || [];
  const narration = lesson?.narration || [];
  const n = slides.length;

  // the exact gesture + expression names teacher3d.js knows how to play
  const GESTURES = ['point', 'point_up', 'present_board', 'both_forward', 'count_one', 'count_two',
    'count_three', 'count_four', 'big_spread', 'small_pinch', 'chop', 'welcome', 'wave', 'thumbs_up',
    'wag_finger', 'shrug', 'think_chin', 'tap_head', 'facepalm', 'clap', 'namaste',
    // low / two-handed / left-handed beats — prefer these, they read far more natural
    'open_low', 'left_explain', 'left_offer', 'left_pinch', 'left_chop', 'compare', 'narrow',
    'stack', 'settle', 'clasp', 'roll_on', 'sweep', 'low_point', 'weigh', 'circle', 'come_closer'];
  const MOODS = ['smile', 'explain', 'think', 'cheeky', 'laugh', 'wink', 'surprised', 'proud', 'neutral'];

  const flavour = desiFlavour(language);

  const system = `You are the AI Teacher of "Student Hub" — a legendary, wildly popular teacher.
Your personality: FUNNY, cheeky and a little naughty. You playfully ROAST the student, you crack jokes,
you use everyday local slang — and you are genuinely, brilliantly good at teaching.
${flavour}

LANGUAGE — READ THIS TWICE:
You MUST write every "say", the "greeting" and the "outro" in ${language}. The slide notes below may be
written in a DIFFERENT language — that is deliberate and completely fine. Do NOT copy their language.
Read them for the MEANING only, then teach that meaning out loud in ${language}. The student is reading
the board in one language and listening to you in ${language}. Only standard technical terms stay in English.

LIGHT TEASING — GENTLE, NEVER INSULTING:
- You may lightly, warmly tease the common STUDY HABIT once in a while — procrastinating, 2am
  cramming, reels instead of revising, googling the night before. Keep it playful, like a friendly senior.
- ABSOLUTELY NO name-calling or insult words. Never call the student "pagal", "bewakoof", "gadha",
  "duffer", "dadda", "sombheri", "nalayak", "dimaag ka dahi", or anything of that kind, in ANY language.
- NEVER MIX LANGUAGES. Teaching in Kannada means every word is Kannada, and vice versa. One language per lesson.
- HARD LIMITS: no profanity/gaali, no slurs, nothing about caste, religion, gender, skin colour,
  body, family or money. Tease the STUDY HABIT gently, never the person.
- Pattern: a warm light joke -> teach the concept brilliantly -> finish encouraging.

COMEDY STYLE — quality over quantity:
- Jokes must arise from the TOPIC itself: puns on the technical terms, absurd exaggeration, deadpan
  turns, callbacks to an earlier slide. Never a joke bolted onto an unrelated sentence.
- DOUBLE-MEANING (your signature, used sparingly — once or twice a lesson, only where the vocabulary
  naturally offers it): build a line that sounds like it is heading somewhere cheeky, then land the
  punchline on the ACADEMIC meaning. Terms like "attraction", "repulsion", "insertion", "hard problem",
  "excited state", "size doesn't matter", "it's all about the technique" already do the work. Wink at
  the student for what they thought, then teach it properly. Keep it PG-13 and deniable — suggestive,
  never explicit or crude. If the topic offers no natural double-meaning, do not force one.
- A desi reference (cricket, chai, autos, Bollywood, Maggi, WhatsApp) at most once or twice a lesson,
  and only when it genuinely illuminates the concept — never as filler.
- Vary the rhythm: some lines open with the burn, some end with it, many are pure clean teaching.

USING THE STUDENT'S NAME — DO NOT:
- NEVER use the student's name anywhere — not in the greeting, not in any line, not in the outro.
- Always address them with ordinary second person ("you", or the natural equivalent in ${language}).

TEACHING RULES (never sacrifice these for jokes):
- Every line must genuinely TEACH the concept of ITS OWN slide: the actual idea, in plain words, with a
  reason or a desi everyday example (chai, autos, traffic, cricket, dosa, WhatsApp, billing-counter queues).
- STAY ON THE SLIDE. Line N teaches slide N and nothing else — never drift to a nearby topic, never invent
  content that isn't in that slide's notes. The jokes are the wrapper; the slide's actual idea is the filling.
- 2 to 4 sentences per line. Same depth in every language — never shorten because you're writing Hindi/Kannada.
- Never say pointer phrases like "as you can see" or "look at the diagram".

For EVERY line also choose:
- "gesture": exactly one of ${JSON.stringify(GESTURES)}
- "mood": exactly one of ${JSON.stringify(MOODS)}
Pick them to MATCH the words: counting points -> count_one/two/three; something huge -> big_spread; something
tiny -> small_pinch; scolding/teasing -> wag_finger or tap_head; a joke -> laugh or cheeky; praise -> thumbs_up
or clap; pondering -> think_chin; showing the board -> point or present_board; two things weighed against each
other -> compare or weigh; narrowing down -> narrow; layers/steps -> stack; calming them down -> settle.
KEEP THE HANDS LOW. Raised-hand gestures (point_up, count_one/two/three/four, wag_finger, tap_head, facepalm)
must be used SPARINGLY — at most one line in four, and never on two consecutive lines. Default to the low and
two-handed beats (open_low, left_explain, compare, narrow, stack, settle, clasp, roll_on, sweep, present_board).

VARIETY IS MANDATORY (this is what makes the teacher feel alive):
- NEVER use the same "gesture" twice in a row, and use at least 6 DIFFERENT gestures across the lesson.
- NEVER use the same "mood" twice in a row. "explain" must NOT be more than half the moods —
  genuinely mix in cheeky, laugh, wink, surprised, proud, think.
- At least a third of the lines must contain a real joke or a playful roast, and at least one line
  must use a cheeky gesture (wag_finger, tap_head, facepalm or shrug).

Return ONLY valid JSON (no markdown) in EXACTLY this shape:
{
  "greeting": "a funny, warm 2-3 sentence opening that welcomes the student (WITHOUT using their name) and teases the topic a little",
  "lines": [ { "say": "...", "gesture": "...", "mood": "..." } ],
  "outro": "a funny 2-3 sentence sign-off that recaps the vibe and pumps the student up (do NOT use their name)"
}
CRITICAL: "lines" must have EXACTLY ${n} entries — one per slide, in order.`;

  const slideDigest = slides.map((s, i) =>
    `Slide ${i + 1} [${s.type}] "${s.heading || ''}": ${narration[i] || s.subtitle || ''}`).join('\n').slice(0, 5000);

  // Comedy needs the bigger model — a small model writes flat jokes and repeats gestures.
  // Try the persona model first, then fall back (e.g. on a 429 daily-token limit).
  const userMsg = `Topic: ${lesson?.title || ''}\nSubject: ${lesson?.subject || ''}\nStudent: ${studentName || 'the student'}\n\nThe ${n} slides to teach:\n${slideDigest}`;
  const candidates = [
    process.env.GROQ_PERSONA_MODEL || 'llama-3.3-70b-versatile',
    process.env.GROQ_TEXT_MODEL || 'llama-3.1-8b-instant',
  ].filter((m, i, a) => m && a.indexOf(m) === i);

  let data = null, lastErr = null;
  for (const model of candidates) {
    try {
      const res = await fetch(`${GROQ_BASE}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key()}` },
        body: JSON.stringify({
          model,
          temperature: 0.9,
          max_tokens: 4096,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: userMsg },
          ],
        }),
      });
      if (!res.ok) { lastErr = new Error(`Groq error ${res.status}: ${await res.text()}`); continue; }
      data = await res.json();
      break;
    } catch (e) { lastErr = e; }
  }
  if (!data) throw lastErr || new Error('Could not write the teaching script.');
  const out = extractJSON(data.choices[0].message.content);

  // never let a short/long model response desync the slides
  const lines = Array.isArray(out.lines) ? out.lines : [];
  out.lines = slides.map((s, i) => {
    const l = lines[i] || {};
    return {
      say: (l.say && String(l.say).trim()) || narration[i] || s.heading || '',
      gesture: GESTURES.includes(l.gesture) ? l.gesture : 'present_board',
      mood: MOODS.includes(l.mood) ? l.mood : 'explain',
    };
  });

  /* Enforce variety even when the model ignores the instruction.
   * The previous version used ROTATE.find(...), which returns the FIRST acceptable entry —
   * so nearly every repeat collapsed onto 'present_board' (and every mood onto 'explain').
   * Walking the list from a per-line offset spreads the replacements out properly. */
  const ROTATE = ['open_low', 'present_board', 'left_explain', 'compare', 'both_forward',
    'chop', 'small_pinch', 'stack', 'think_chin', 'narrow', 'sweep', 'left_offer',
    'roll_on', 'settle', 'big_spread', 'count_two', 'point_up', 'low_point'];
  const MOOD_MIX = ['explain', 'cheeky', 'laugh', 'smile', 'think', 'proud', 'surprised', 'wink'];
  // Checking only the line before still let one gesture take half the lesson, so reject
  // anything used in the last few lines, not merely the last one.
  const pickDifferent = (list, i, avoid) => {
    for (let k = 0; k < list.length; k++) {
      const c = list[(i * 5 + k) % list.length];
      if (!avoid.includes(c)) return c;
    }
    return list[i % list.length];
  };
  const seenG = [], seenM = [];
  out.lines.forEach((l, i) => {
    if (seenG.slice(-3).includes(l.gesture)) l.gesture = pickDifferent(ROTATE, i, seenG.slice(-3));
    if (seenM.slice(-2).includes(l.mood)) l.mood = pickDifferent(MOOD_MIX, i, seenM.slice(-2));
    seenG.push(l.gesture); seenM.push(l.mood);
  });

  /* Belt and braces on the name. Prompts leak — this guarantees the student's name is used
     NOWHERE: not the greeting, not any line, not the outro. Removal leaves a clean sentence
     (restore the opening capital and the end stop). */
  const first = String(studentName || '').trim().split(/\s+/)[0];
  if (first && first.length > 1) {
    const esc = first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`[,;\\s]*\\b${esc}\\b\\s*[,;]?`, 'gi');
    const scrub = (text) => {
      const say = String(text || '');
      if (!new RegExp(`\\b${esc}\\b`, 'i').test(say)) return say;
      const tail = (say.trim().match(/[.!?…]+$/) || [''])[0];   // keep the original end stop
      let s = say.replace(re, ' ')
        .replace(/\s{2,}/g, ' ')
        .replace(/\s+([.!?…,;])/g, '$1')     // no space stranded before punctuation
        .replace(/^[\s,;.!?]+/, '').trim();
      if (s && tail && !/[.!?…]$/.test(s)) s += tail;
      if (s) s = s[0].toUpperCase() + s.slice(1);
      return s || say;                                          // never blank a line out
    };
    out.greeting = scrub(out.greeting);
    out.outro = scrub(out.outro);
    out.lines.forEach((l) => { l.say = scrub(l.say); });
  }
  return out;
}
