// lib/whatsapp.js — WhatsApp Cloud API integration (send/receive/format).
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
// You pay nothing to use the API; user-initiated chats are free for 24h,
// and the first 1,000 service conversations each month are free.

const GRAPH = 'https://graph.facebook.com/v22.0';

function cfg() {
  const token = process.env.WA_TOKEN;
  const phoneId = process.env.WA_PHONE_ID;
  if (!token || token.startsWith('your_')) throw new Error('WA_TOKEN missing in .env');
  if (!phoneId || phoneId.startsWith('your_')) throw new Error('WA_PHONE_ID missing in .env');
  return { token, phoneId };
}

/* ---------- send a plain text message ---------- */
export async function sendText(to, body) {
  const { token, phoneId } = cfg();
  // WhatsApp hard-limits a text body to 4096 chars — chunk if needed
  const chunks = body.match(/[\s\S]{1,3900}/g) || [body];
  for (const chunk of chunks) {
    const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messaging_product: 'whatsapp', recipient_type: 'individual',
        to, type: 'text', text: { preview_url: false, body: chunk },
      }),
    });
    if (!res.ok) console.error('WA sendText failed:', await res.text());
  }
}

/* ---------- mark a message read (the blue ticks) ---------- */
export async function markRead(messageId) {
  try {
    const { token, phoneId } = cfg();
    await fetch(`${GRAPH}/${phoneId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId }),
    });
  } catch { /* non-critical */ }
}

/* ---------- upload + send an audio voice note (the tutor narration) ---------- */
export async function sendVoiceNote(to, mp3Buffer) {
  const { token, phoneId } = cfg();
  // 1) upload media -> get an id
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('file', new Blob([mp3Buffer], { type: 'audio/mpeg' }), 'lesson.mp3');
  form.append('type', 'audio/mpeg');
  const up = await fetch(`${GRAPH}/${phoneId}/media`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
  });
  if (!up.ok) { console.error('WA media upload failed:', await up.text()); return; }
  const { id } = await up.json();
  // 2) send it as audio
  const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'audio', audio: { id } }),
  });
  if (!res.ok) console.error('WA sendVoiceNote failed:', await res.text());
}

/* ---------- download media a user sent (photo / voice doubt) ---------- */
export async function downloadMedia(mediaId) {
  const { token } = cfg();
  const meta = await (await fetch(`${GRAPH}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })).json();
  if (!meta.url) throw new Error('Could not resolve media URL.');
  const bin = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } });
  const buffer = Buffer.from(await bin.arrayBuffer());
  return { buffer, mimeType: meta.mime_type };
}

/* ---------- format a lesson object into a WhatsApp message ---------- */
export function lessonToWhatsApp(lesson) {
  let m = `📚 *${lesson.title}*  _(${lesson.subject})_\n`;
  for (const s of lesson.slides || []) {
    if (s.type === 'title') {
      m += `\n${s.subtitle || ''}\n`;
    } else if (s.type === 'flowchart') {
      m += `\n🔁 *${s.heading}*\n${(s.steps || []).join('\n   ⬇️\n')}\n`;
    } else if (s.type === 'diagram') {
      m += `\n🧩 *${s.heading}*\n${(s.parts || []).map(p => `• *${p.label}* — ${p.desc}`).join('\n')}\n`;
    } else if (s.type === 'explanation') {
      m += `\n💡 *${s.heading}*\n${(s.points || []).map((p, i) => `${i + 1}. *${p.bold}* ${p.text}`).join('\n')}\n`;
    }
  }
  m += `\n— — —\n_Reply with another doubt, or send a photo / voice note. 🎧 audio of this lesson coming next._`;
  return m.trim();
}

/* ---------- one combined narration string for the voice note ---------- */
export function narrationText(lesson) {
  return (lesson.narration || []).join(' … ') || lesson.title;
}
