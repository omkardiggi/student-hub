// lib/tts.js — OPTIONAL neural voice via Cartesia or Microsoft Edge voices.
import 'dotenv/config';

const VOICE = {
  English: 'en-US-AriaNeural',
  Hindi: 'hi-IN-SwaraNeural',
  Hinglish: 'hi-IN-SwaraNeural',   // romanized Hindi reads best on the hi-IN voice
  Kannada: 'kn-IN-SapnaNeural',
  Kanglish: 'kn-IN-SapnaNeural',
};

// Default Cartesia voices (multilingual-capable)
const CARTESIA_DEFAULT_VOICES = {
  English: 'a5136bf9-224c-4d76-b823-52bd5efcffcc', // Jameson (Narrator)
  Hindi: '3b554273-4299-48b9-9aaf-eefd438e3941',   // Indian Lady
  Hinglish: '3b554273-4299-48b9-9aaf-eefd438e3941',
  Kannada: '3b554273-4299-48b9-9aaf-eefd438e3941',
  Kanglish: '3b554273-4299-48b9-9aaf-eefd438e3941',
};

// Cartesia language codes mapping
const CARTESIA_LANG_CODES = {
  English: 'en',
  Hindi: 'hi',
  Hinglish: 'hi',
  Kannada: 'kn',
  Kanglish: 'kn',
};


export async function synthesize({ text, language = 'English', lessonTitle = '' }) {
  // A dialect variant like "Kannada (North Karnataka)" must still pick the Kannada voice —
  // strip the parenthetical so voice lookup always lands on the base language.
  language = String(language || 'English').replace(/\s*\(.*?\)\s*$/, '').trim() || 'English';

  const cartesiaKey = (process.env.CARTESIA_API_KEY && !process.env.CARTESIA_API_KEY.startsWith('your_'))
    ? process.env.CARTESIA_API_KEY
    : 'sk_car_KngcxAQiMhv5aX9PkkZB2U';

  // Use Cartesia neural voices
  if (cartesiaKey) {
    const langKey = Object.keys(CARTESIA_DEFAULT_VOICES).find(
      k => k.toLowerCase() === language.toLowerCase()
    ) || 'English';

    let voiceId = process.env[`CARTESIA_VOICE_ID_${langKey.toUpperCase()}`]
      || (langKey === 'Hinglish' && process.env.CARTESIA_VOICE_ID_HINDI)
      || (langKey === 'Kanglish' && process.env.CARTESIA_VOICE_ID_KANNADA)
      || process.env.CARTESIA_VOICE_ID
      || CARTESIA_DEFAULT_VOICES[langKey]
      || CARTESIA_DEFAULT_VOICES.English;

    const langCode = CARTESIA_LANG_CODES[langKey] || 'en';

    try {
      const response = await fetch('https://api.cartesia.ai/tts/bytes', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cartesiaKey}`,
          'Cartesia-Version': '2024-06-18',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model_id: 'sonic-3.5',
          transcript: text,
          voice: {
            mode: 'id',
            id: voiceId,
          },
          output_format: {
            container: 'mp3',
            sample_rate: 44100,
            bit_rate: 128000,
          },
          language: langCode,
        }),
      });

      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
      } else {
        const errText = await response.text();
        console.warn(`Cartesia API returned status ${response.status}: ${errText}. Falling back to MsEdgeTTS.`);
      }
    } catch (err) {
      console.warn('Cartesia generation failed. Falling back to MsEdgeTTS:', err.message);
    }
  }

  // Fallback: MsEdgeTTS
  let MsEdgeTTS, OUTPUT_FORMAT;
  try {
    ({ MsEdgeTTS, OUTPUT_FORMAT } = await import('msedge-tts'));
  } catch {
    throw new Error('msedge-tts not installed. Run "npm install msedge-tts" to enable neural voices.');
  }
  const tts = new MsEdgeTTS();
  await tts.setMetadata(VOICE[language] || VOICE.English, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(text);
  const chunks = [];
  for await (const c of audioStream) chunks.push(c);
  return Buffer.concat(chunks); // mp3 bytes
}
