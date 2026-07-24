// lib/telegram.js — Telegram Bot API integration (send/receive/format).
import 'dotenv/config';

function cfg() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token.startsWith('your_')) throw new Error('TELEGRAM_BOT_TOKEN missing in .env');
  return token;
}

function escapeHtml(str = '') {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* ---------- send a plain text HTML message ---------- */
export async function sendText(chatId, body) {
  const token = cfg();
  // Telegram has a limit of 4096 characters per message
  const chunks = body.match(/[\s\S]{1,4000}/g) || [body];
  for (const chunk of chunks) {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: chunk,
        parse_mode: 'HTML',
      }),
    });
    if (!res.ok) console.error('Telegram sendText failed:', await res.text());
  }
}

/* ---------- send an audio voice note (tutor narration) ---------- */
export async function sendVoiceNote(chatId, mp3Buffer) {
  const token = cfg();
  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('voice', new Blob([mp3Buffer], { type: 'audio/mpeg' }), 'lesson.mp3');

  const res = await fetch(`https://api.telegram.org/bot${token}/sendVoice`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) console.error('Telegram sendVoiceNote failed:', await res.text());
}

/* ---------- download file sent by user (photo/voice doubt) ---------- */
export async function downloadFile(fileId) {
  const token = cfg();
  // 1) Get file path info
  const pathRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
  if (!pathRes.ok) throw new Error('Failed to get file path from Telegram');
  const pathJson = await pathRes.json();
  if (!pathJson.ok || !pathJson.result?.file_path) throw new Error('Could not resolve Telegram file path');
  
  const filePath = pathJson.result.file_path;
  // 2) Download file binary
  const fileUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;
  const bin = await fetch(fileUrl);
  if (!bin.ok) throw new Error('Failed to download file from Telegram server');
  const buffer = Buffer.from(await bin.arrayBuffer());
  
  // Try to determine mimeType from file path extension
  let mimeType = 'application/octet-stream';
  if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) mimeType = 'image/jpeg';
  else if (filePath.endsWith('.png')) mimeType = 'image/png';
  else if (filePath.endsWith('.ogg')) mimeType = 'audio/ogg';
  else if (filePath.endsWith('.mp3')) mimeType = 'audio/mpeg';

  return { buffer, mimeType };
}

/* ---------- format a lesson object into HTML for Telegram ---------- */
export function lessonToTelegram(lesson) {
  let m = `📚 <b>${escapeHtml(lesson.title)}</b> <i>(${escapeHtml(lesson.subject)})</i>\n`;
  for (const s of lesson.slides || []) {
    if (s.type === 'title') {
      if (s.subtitle) m += `\n${escapeHtml(s.subtitle)}\n`;
    } else if (s.type === 'flowchart') {
      m += `\n🔁 <b>${escapeHtml(s.heading)}</b>\n${(s.steps || []).map(escapeHtml).join('\n   ⬇️\n')}\n`;
    } else if (s.type === 'diagram') {
      m += `\n🧩 <b>${escapeHtml(s.heading)}</b>\n${(s.parts || []).map(p => `• <b>${escapeHtml(p.label)}</b> — ${escapeHtml(p.desc)}`).join('\n')}\n`;
    } else if (s.type === 'explanation') {
      m += `\n💡 <b>${escapeHtml(s.heading)}</b>\n${(s.points || []).map((p, i) => `${i + 1}. <b>${escapeHtml(p.bold)}</b> ${escapeHtml(p.text)}`).join('\n')}\n`;
    }
  }
  m += `\n— — —\n<i>Reply with another doubt, or send a photo / voice note. 🎧 Audio narration coming next.</i>`;
  return m.trim();
}

/* ---------- one combined narration string for the voice note ---------- */
export function narrationText(lesson) {
  return (lesson.narration || []).join(' … ') || lesson.title;
}
