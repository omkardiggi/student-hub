// lib/wa-webhook.js — the WhatsApp webhook (Meta calls this URL).
import express from 'express';
import { generateLesson, readImageDoubt, transcribeAudio } from './groq.js';
import { synthesize } from './tts.js';
import {
  sendText, sendVoiceNote, markRead, downloadMedia,
  lessonToWhatsApp, narrationText,
} from './whatsapp.js';
import { store } from './store.js';

export const waRouter = express.Router();

/* ---- 1. Verification handshake (Meta GETs this once when you set the webhook) ---- */
waRouter.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === (process.env.WA_VERIFY_TOKEN || 'studenthub-verify')) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

/* ---- 2. Inbound messages (Meta POSTs every incoming message here) ---- */
waRouter.post('/', async (req, res) => {
  res.sendStatus(200); // ACK immediately so Meta doesn't retry; work happens after.

  // If the bot isn't configured, do nothing (web app keeps working regardless).
  if (!process.env.WA_TOKEN || process.env.WA_TOKEN.startsWith('your_')) {
    console.log('WhatsApp message received but WA_TOKEN is not set — ignoring.');
    return;
  }

  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    if (!msg) return; // could be a status callback, ignore
    const from = msg.from; // user's phone number
    markRead(msg.id);

    // figure out the doubt text from whatever they sent
    let doubt = null;

    if (msg.type === 'text') {
      doubt = msg.text.body;
    } else if (msg.type === 'image') {
      await sendText(from, '🔍 Reading your photo…');
      const { buffer, mimeType } = await downloadMedia(msg.image.id);
      const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
      doubt = await readImageDoubt({ imageDataUrl: dataUrl });
    } else if (msg.type === 'audio' || msg.type === 'voice') {
      await sendText(from, '🎙️ Listening to your voice note…');
      const media = msg.audio || msg.voice;
      const { buffer } = await downloadMedia(media.id);
      const out = await transcribeAudio({ buffer, filename: 'doubt.ogg' });
      doubt = out.text;
    } else {
      return sendText(from, "Send me a doubt as text, a photo of the problem, or a voice note and I'll build you a lesson. 📚");
    }

    if (!doubt || !doubt.trim()) return sendText(from, "I couldn't make out a question there — try again?");

    // simple commands
    if (/^(hi|hello|hey|start|menu)$/i.test(doubt.trim())) {
      return sendText(from,
        "👋 *Welcome to Student Hub!*\nI turn any doubt into a mini-lesson.\n\n" +
        "• *Type* a question\n• *Send a photo* of a problem or textbook page\n• *Send a voice note*\n\n" +
        "Try: _\"How does photosynthesis work?\"_");
    }

    await sendText(from, '🧠 Building your lesson… one moment.');

    // Default: Auto — mirror whatever language/style the student used (Hinglish, Kannada, etc.).
    // Optional override: prefix the message with "hindi:", "kannada:", or "english:".
    let language = 'Auto';
    const lng = doubt.match(/^(hindi|kannada|english)\s*[:\-]\s*/i);
    if (lng) { language = lng[1][0].toUpperCase() + lng[1].slice(1).toLowerCase(); doubt = doubt.replace(lng[0], ''); }

    const lesson = await generateLesson({ doubt, level: 'school', language });

    // save to the same library the web app uses (keyed by wa:<number>)
    store.saveDoubt(`wa:${from}`, { doubt, subject: lesson.subject, title: lesson.title, slides: lesson.slides?.length });

    // 1) the lesson as formatted text
    await sendText(from, lessonToWhatsApp(lesson));

    // 2) the tutor narration as a voice note (best-effort; skips if edge-tts not installed)
    try {
      const voiceLang = lesson.language || (language === 'Auto' ? 'English' : language);
      const mp3 = await synthesize({ text: narrationText(lesson), language: voiceLang, lessonTitle: lesson.title });
      await sendVoiceNote(from, mp3);
    } catch (e) {
      console.log('Voice note skipped:', e.message);
    }
  } catch (e) {
    console.error('WA webhook error:', e);
  }
});
