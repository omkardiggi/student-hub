// server.js — serves the site + the real API. Run: npm install && npm start
import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  generateLesson, readImageDoubt, transcribeAudio, whisperLangToLabel, labelToWhisperHint,
  generatePractice, gradeShortAnswer, generatePracticeReport,
  generateVivaQuestion, analyseSpeech, coachSpeaking, analysePresence,
  generateDebateTopic, analyseDebate, generateAIDebateReply, generateInterviewQuestions, evaluateInterviewSession,
  answerFollowup, generateLessonExtras, generateTeacherScript,
} from './lib/groq.js';
import { buildDeckBuffer } from './lib/deck.js';
import { synthesize } from './lib/tts.js';
import { findEvents, geocode } from './lib/events.js';
import { store } from './lib/store.js';
import { waRouter } from './lib/wa-webhook.js';
import { tgRouter } from './lib/tg-webhook.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, fieldSize: 12 * 1024 * 1024 } });

app.use(express.json({ limit: '15mb' })); // big enough for base64 photos
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 },
}));

const need = (req, res, next) => {
  if (!req.session) req.session = {};
  if (!req.session.user) {
    req.session.user = { name: 'Student', email: 'guest@studenthub.internal' };
  }
  next();
};
const fail = (res, e) => { console.error(e); res.status(500).json({ error: e.message || 'Something went wrong.' }); };

/* ───────── Auth ───────── */
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });
    if (store.getUser(email)) return res.status(409).json({ error: 'Account already exists — just log in.' });
    store.addUser({ name: name || email.split('@')[0], email, hash: await bcrypt.hash(password, 10) });
    req.session.user = { name: name || email.split('@')[0], email };
    res.json({ user: req.session.user });
  } catch (e) { fail(res, e); }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const u = store.getUser(email || '');
    if (!u || !(await bcrypt.compare(password || '', u.hash)))
      return res.status(401).json({ error: 'Wrong email or password.' });
    req.session.user = { name: u.name, email: u.email };
    res.json({ user: req.session.user });
  } catch (e) { fail(res, e); }
});

app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/me', (req, res) => {
  if (req.session && !req.session.user) {
    req.session.user = { name: 'Student', email: 'guest@studenthub.internal' };
  }
  res.json({ user: (req.session && req.session.user) || { name: 'Student', email: 'guest@studenthub.internal' } });
});

/* ───────── Core: doubt -> lesson ───────── */
app.post('/api/doubt', need, async (req, res) => {
  try {
    let { doubt, level = 'school', language = 'English', imageDataUrl } = req.body;
    if (imageDataUrl) doubt = await readImageDoubt({ imageDataUrl }); // photo mode
    if (!doubt || !doubt.trim()) return res.status(400).json({ error: 'No doubt provided.' });
    const lesson = await generateLesson({ doubt, level, language });
    store.saveDoubt(req.session.user.email, {
      doubt,
      subject: lesson.subject,
      title: lesson.title,
      slides: lesson.slides?.length,
      lesson, // full deck: slides, narration, topicIntro, language — for replay
    });
    res.json({ doubt, lesson });
  } catch (e) { fail(res, e); }
});

/* ───────── AI Teacher: funny, cheeky teaching script (one line + gesture per slide) ───────── */
app.post('/api/teacher-script', need, async (req, res) => {
  try {
    const { lesson = null, language = 'English' } = req.body;
    if (!lesson || !Array.isArray(lesson.slides)) return res.status(400).json({ error: 'No lesson to teach.' });
    const script = await generateTeacherScript({
      lesson, language, studentName: (req.session.user.name || '').split(' ')[0],
    });
    res.json({ script });
  } catch (e) { fail(res, e); }
});

/* ───────── AI Teacher: live follow-up asked mid-lesson in the classroom ───────── */
app.post('/api/ask-teacher', need, async (req, res) => {
  try {
    const { question, lessonTitle = '', lessonContext = '', language = 'English', questionLanguage = '' } = req.body;
    if (!question || !question.trim()) return res.status(400).json({ error: 'No question provided.' });
    const answer = await answerFollowup({ question: question.trim(), lessonTitle, lessonContext, language, questionLanguage });
    res.json(answer);
  } catch (e) { fail(res, e); }
});

/* ───────── AI Teacher: post-lesson extras (summary / points / flashcards / practice / coding) ───────── */
app.post('/api/lesson-extras', need, async (req, res) => {
  try {
    const { lesson = null, language = 'English' } = req.body;
    if (!lesson || !Array.isArray(lesson.slides)) return res.status(400).json({ error: 'No lesson to summarise.' });
    const extras = await generateLessonExtras({ lesson, language });
    res.json({ extras });
  } catch (e) { fail(res, e); }
});

/* ───────── Voice doubt -> text (Whisper) ───────── */
app.post('/api/stt', need, upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio uploaded.' });
    // No language field at all => auto-detect, which is what the classroom mic wants:
    // the student may ask in any language regardless of what the teacher speaks.
    const hint = labelToWhisperHint(req.body.language); // hi/kn when the picker is set to those
    const { text, language } = await transcribeAudio({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      language: hint,
      prompt: req.body.context || '',      // lesson vocabulary, so terms aren't misheard
    });
    res.json({ text, language: whisperLangToLabel(language) });
  } catch (e) { fail(res, e); }
});

/* ───────── Downloadable PPTX (locally generated, designed + illustrated) ───────── */
// Builds a real .pptx with drawn flowcharts, diagrams, styled cards and topic images
// (images from Pollinations — free, no key). Streams the file straight back.
app.post('/api/deck-file', need, async (req, res) => {
  try {
    const { lesson } = req.body;
    if (!lesson || !Array.isArray(lesson.slides)) return res.status(400).json({ error: 'No lesson to export.' });
    const withImages = req.body.images !== false;
    const buf = await buildDeckBuffer(lesson, { fetchImages: withImages });
    const safe = (lesson.title || 'lesson').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'lesson';
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.set('Content-Disposition', `attachment; filename="${safe}.pptx"`);
    res.send(buf);
  } catch (e) { console.error('deck-file error', e); res.status(500).json({ error: e.message || 'Could not build the deck.' }); }
});

/* ───────── Group Debate: AI-suggested topic ───────── */
app.post('/api/debate-topic', need, async (req, res) => {
  try {
    const { level = 'school', language = 'English' } = req.body;
    const topic = await generateDebateTopic({ level, language });
    res.json(topic);
  } catch (e) { fail(res, e); }
});

/* ───────── Group Debate: analyse the finished debate ───────── */
app.post('/api/debate-analyse', need, async (req, res) => {
  try {
    const { topic = '', speakers = [], language = 'English' } = req.body;
    const clean = (speakers || []).filter(s => s && (s.transcript || '').trim().length);
    if (!clean.length) return res.status(400).json({ error: 'No speech was captured to analyse.' });
    const report = await analyseDebate({ topic, speakers: clean, language });
    res.json({ report });
  } catch (e) { fail(res, e); }
});

/* ───────── Group Debate: AI debate opponent response ───────── */
app.post('/api/ai-debate-reply', need, async (req, res) => {
  try {
    const { topic = '', history = [], userSpeech = '', language = 'English',
            phase = 'rebuttal', aiSide = 'AGAINST', userSide = 'FOR' } = req.body;
    const reply = await generateAIDebateReply({ topic, history, userSpeech, language, phase, aiSide, userSide });
    res.json(reply);
  } catch (e) { fail(res, e); }
});

/* ───────── My Doubts library ───────── */
app.get('/api/doubts', need, (req, res) => res.json({ doubts: store.listDoubts(req.session.user.email) }));

/* ───────── Practice: generate a quiz from a lesson or topic ───────── */
app.post('/api/practice', need, async (req, res) => {
  try {
    const { lesson = null, topic = '', language = 'Auto' } = req.body;
    if (!lesson && !topic.trim()) return res.status(400).json({ error: 'Pick a lesson or a topic to practise.' });
    const quiz = await generatePractice({ lesson, topic, language });
    if (!quiz.questions?.length) return res.status(502).json({ error: 'Could not build questions — try again.' });
    res.json({ quiz });
  } catch (e) { fail(res, e); }
});

/* ───────── Practice: grade one free-text short answer ───────── */
app.post('/api/practice/grade', need, async (req, res) => {
  try {
    const { question, modelAnswer = '', studentAnswer, language = 'Auto' } = req.body;
    if (!question || !studentAnswer?.trim()) return res.status(400).json({ error: 'Missing answer.' });
    const result = await gradeShortAnswer({ question, modelAnswer, studentAnswer, language });
    res.json({ result });
  } catch (e) { fail(res, e); }
});

/* ───────── Practice: record a finished quiz score (for history/streak) ───────── */
app.post('/api/practice/result', need, (req, res) => {
  try {
    const { title = 'Practice', topic = '', score = 0, total = 0 } = req.body;
    store.saveQuizResult(req.session.user.email, { title, topic, score, total });
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

app.get('/api/practice/history', need, (req, res) => res.json({ history: store.listQuizzes(req.session.user.email) }));

/* ───────── Practice: AI focus/weakness report for a finished quiz ───────── */
app.post('/api/practice/report', need, async (req, res) => {
  try {
    const { items = [], topic = '', score = 0, total = 0, language = 'Auto' } = req.body;
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'No results to analyse.' });
    const report = await generatePracticeReport({ items, topic, score, total, language });
    res.json({ report });
  } catch (e) { res.status(200).json({ skipped: true, reason: e.message }); }
});

/* ───────── Speaking coach: get a practice question ───────── */
app.post('/api/viva-question', need, async (req, res) => {
  try {
    const { category = 'hr', topic = '', language = 'English' } = req.body;
    const { question } = await generateVivaQuestion({ category, topic, language });
    res.json({ question });
  } catch (e) { fail(res, e); }
});

/* ───────── Speaking coach: transcribe + score a recorded answer ───────── */
app.post('/api/speaking-coach', need, upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio uploaded.' });
    const question = req.body.question || '';
    const feedbackLanguage = req.body.feedbackLanguage || 'English';
    if (!question.trim()) return res.status(400).json({ error: 'Missing the question being answered.' });

    const hint = labelToWhisperHint(feedbackLanguage); // hi/kn so the script is read correctly
    const { text, duration } = await transcribeAudio({ buffer: req.file.buffer, filename: req.file.originalname || 'answer.webm', language: hint });
    if (!text) return res.status(422).json({ error: "Couldn't hear a clear answer — record again and speak up a little." });

    const metrics = analyseSpeech(text, duration);
    const feedback = await coachSpeaking({ question, transcript: text, metrics, feedbackLanguage });

    // Optional: on-camera presence from frames captured during the answer
    let presence = null;
    try {
      const frames = req.body.frames ? JSON.parse(req.body.frames) : [];
      if (Array.isArray(frames) && frames.length) {
        presence = await analysePresence({ frames, question, language: feedbackLanguage });
      }
    } catch (e) { console.warn('Presence analysis skipped:', e.message); }

    store.saveSpeaking(req.session.user.email, {
      question, transcript: text, metrics, overall: feedback.overall,
      presence: presence ? presence.overall : null,
    });
    res.json({ transcript: text, metrics, feedback, presence });
  } catch (e) { fail(res, e); }
});

/* ───────── Multi-Question AI Interview Session ───────── */
app.post('/api/interview/start', need, async (req, res) => {
  try {
    const { name, type = 'hr', skills = '', education = '', role = '', count = 4, language = 'English',
      resumeText = '', jobDescription = '', company = '' } = req.body;
    const sessionData = await generateInterviewQuestions({
      name, type, skills, education, role, count, language, resumeText, jobDescription, company,
    });
    res.json(sessionData);
  } catch (e) { fail(res, e); }
});

app.post('/api/interview/evaluate', need, async (req, res) => {
  try {
    const { interviewConfig = {}, items = [], language = 'English' } = req.body;
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'No answers were recorded to evaluate.' });
    const report = await evaluateInterviewSession({ interviewConfig, items, language });
    res.json({ report });
  } catch (e) { fail(res, e); }
});

app.get('/api/speaking-history', need, (req, res) => res.json({ history: store.listSpeaking(req.session.user.email) }));

/* ───────── TTS: neural voice audio (Cartesia / MsEdgeTTS) ───────── */
app.post('/api/tts', async (req, res) => {
  try {
    const { text, language = 'English', lessonTitle = '' } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'No text provided.' });
    const buffer = await synthesize({ text, language, lessonTitle });
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch (e) {
    fail(res, e);
  }
});

/* ───────── Hackathons & workshops near me ───────── */
app.get('/api/events', async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat), lng = parseFloat(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'Need your location (lat/lng).' });
    const type = ['hackathon', 'workshop', 'all'].includes(req.query.type) ? req.query.type : 'hackathon';
    const scope = req.query.scope === 'inperson' ? 'inperson' : 'all';
    const data = await findEvents({ lat, lng, type, scope });
    res.json(data);
  } catch (e) { fail(res, e); }
});

/* ───────── Geocode a typed city (fallback when geolocation is blocked) ───────── */
app.get('/api/geocode', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'Type a city name.' });
    const g = await geocode(q);
    if (!g) return res.status(404).json({ error: `Couldn't find "${q}".` });
    res.json({ location: q, ...g });
  } catch (e) { fail(res, e); }
});

/* ───────── WhatsApp bot webhook ───────── */
app.use('/webhook/whatsapp', waRouter);

/* ───────── Telegram bot webhook ───────── */
app.use('/webhook/telegram', tgRouter);

/* ───────── Static files ───────── */
// The AI Teacher's 3D avatar (model.fbx + embedded textures) is served from /avatar
// straight out of the avatar/ folder — no need to duplicate the 8.6 MB file into public/.
app.use('/avatar', express.static(join(__dirname, 'avatar'), { maxAge: '7d', immutable: true }));
app.use(express.static(join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`\n  Omkar Hub running →  http://localhost:${PORT}\n`));

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

export default app;
