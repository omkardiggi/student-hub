// lib/tts.js — OPTIONAL neural voice via Cartesia or Microsoft Edge voices.
import 'dotenv/config';

const VOICE = {
  English: 'en-US-AriaNeural',
  Hindi: 'hi-IN-SwaraNeural',
  Hinglish: 'hi-IN-SwaraNeural',   // romanized Hindi reads best on the hi-IN voice
  Kannada: 'kn-IN-SapnaNeural',
  Kanglish: 'kn-IN-SapnaNeural',
};

// Cartesia native voice IDs per language
const CARTESIA_DEFAULT_VOICES = {
  English: 'f9fc912e-52f0-448a-8bfa-47e9ca75f25a',   // Marilyn - Explainer
  Hindi: '9cebb910-d4b7-4a4a-85a4-12c79137724c',     // Aarti - Conversationalist
  Hinglish: '9cebb910-d4b7-4a4a-85a4-12c79137724c',  // Aarti
  Kannada: '7c6219d2-e8d2-462c-89d8-7ecba7c75d65',   // Divya - Joyful Narrator
  Kanglish: '7c6219d2-e8d2-462c-89d8-7ecba7c75d65',  // Divya
  Tamil: '4014f0c9-d3eb-4eca-af2b-fd6004f526be',     // Meena - Measured Professional
  Telugu: '4418bb06-8329-49a1-bb11-53bb64ca0547',    // Shanti - Calm Authority
  Malayalam: 'b426013c-002b-4e89-8874-8cd20b68373a', // Latha - Friendly Host
  Marathi: '5c32dce6-936a-4892-b131-bafe474afe5f',   // Anika - Enthusiastic Seller
  Bengali: '2ba861ea-7cdc-43d1-8608-4045b5a41de5',   // Rubel - City Guide
  Spanish: '02aeee94-c02b-456e-be7a-659672acf82d',   // Benito - Digital Voice
  French: '80e11491-2d8a-4361-ac61-c4f3e0a4f7e7',    // Vincent
  German: '42f14755-88c3-4124-aae3-5cc3a9618e8f',    // Jan
  Japanese: '498e7f37-7fa3-4e2c-b8e2-8b6e9276f956',  // Aiko - Calming Voice
  Chinese: 'eda5bbff-1ff1-4886-8ef1-4e69a77640a0',   // Kai - Commercial Man
  Portuguese: 'b603811e-54c2-4a0a-8854-09eab9ffa63f'// Bruno - Reliable Communicator
};

// Cartesia language codes mapping
const CARTESIA_LANG_CODES = {
  English: 'en',
  Hindi: 'hi',
  Hinglish: 'hi',
  Kannada: 'kn',
  Kanglish: 'kn',
  Tamil: 'ta',
  Telugu: 'te',
  Malayalam: 'ml',
  Marathi: 'mr',
  Bengali: 'bn',
  Spanish: 'es',
  French: 'fr',
  German: 'de',
  Japanese: 'ja',
  Chinese: 'zh',
  Portuguese: 'pt',
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
