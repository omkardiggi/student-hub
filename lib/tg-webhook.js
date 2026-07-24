// lib/tg-webhook.js — the Telegram webhook handler.
import express from 'express';
import { generateLesson, readImageDoubt, transcribeAudio } from './groq.js';
import { synthesize } from './tts.js';
import {
  sendText, sendVoiceNote, downloadFile,
  lessonToTelegram, narrationText
} from './telegram.js';
import { store } from './store.js';

export const tgRouter = express.Router();

// Webhook endpoint (mounted under /webhook/telegram)
// Telegram doesn't require a handshake, but you can set a secret token.
// The secure path is: POST /webhook/telegram/:token
tgRouter.post('/:token', async (req, res) => {
  // Return 200 immediately to acknowledge receipt
  res.sendStatus(200);

  console.log('--- Incoming Telegram Webhook Request ---');
  console.log('Params token:', req.params.token);
  console.log('Body:', JSON.stringify(req.body, null, 2));

  const token = req.params.token;
  if (!token || token !== process.env.TELEGRAM_BOT_TOKEN) {
    console.warn('Unauthorized Telegram webhook access attempt.');
    return;
  }

  try {
    const msg = req.body?.message;
    if (!msg) return;

    const chatId = msg.chat?.id;
    if (!chatId) return;

    let doubt = null;

    // 1) Read the doubt depending on type
    if (msg.text) {
      doubt = msg.text;
    } else if (msg.photo && msg.photo.length > 0) {
      await sendText(chatId, '🔍 Reading your photo…');
      // Get the largest photo size
      const photoObj = msg.photo[msg.photo.length - 1];
      const { buffer, mimeType } = await downloadFile(photoObj.file_id);
      const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
      doubt = await readImageDoubt({ imageDataUrl: dataUrl });
    } else if (msg.voice) {
      await sendText(chatId, '🎙️ Listening to your voice note…');
      const { buffer } = await downloadFile(msg.voice.file_id);
      const out = await transcribeAudio({ buffer, filename: 'doubt.ogg' });
      doubt = out.text;
    } else {
      return sendText(chatId, "Send me a doubt as text, a photo of a problem, or a voice note and I'll build you a lesson. 📚");
    }

    if (!doubt || !doubt.trim()) {
      return sendText(chatId, "I couldn't make out a question there — try again?");
    }

    // Handle commands
    if (/^\/(start|help|menu)$/i.test(doubt.trim())) {
      return sendText(chatId,
        "👋 <b>Welcome to Student Hub!</b>\nI turn any doubt into a structured mini-lesson.\n\n" +
        "• <b>Type</b> a question\n• <b>Send a photo</b> of a problem or textbook page\n• <b>Send a voice note</b>\n\n" +
        "Try: <i>\"How does photosynthesis work?\"</i>");
    }

    await sendText(chatId, '🧠 Building your lesson… one moment.');

    // Language processing: Auto by default, or language code-based prefix (e.g. "hindi:...")
    let language = 'Auto';
    const lng = doubt.match(/^(hindi|kannada|english)\s*[:\-]\s*/i);
    if (lng) {
      language = lng[1][0].toUpperCase() + lng[1].slice(1).toLowerCase();
      doubt = doubt.replace(lng[0], '');
    }

    // Generate lesson
    const lesson = await generateLesson({ doubt, level: 'school', language });

    // Save to store
    store.saveDoubt(`tg:${chatId}`, {
      doubt,
      subject: lesson.subject,
      title: lesson.title,
      slides: lesson.slides?.length
    });

    // 1) Send text lesson
    await sendText(chatId, lessonToTelegram(lesson));

    // 2) Send audio narration
    try {
      const voiceLang = lesson.language || (language === 'Auto' ? 'English' : language);
      const mp3 = await synthesize({ text: narrationText(lesson), language: voiceLang, lessonTitle: lesson.title });
      await sendVoiceNote(chatId, mp3);
    } catch (e) {
      console.log('Voice note skipped:', e.message);
    }
  } catch (e) {
    console.error('Telegram webhook error:', e);
  }
});
