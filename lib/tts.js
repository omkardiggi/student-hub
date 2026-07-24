// lib/tts.js — OPTIONAL neural voice via Cartesia or Microsoft Edge voices.
import 'dotenv/config';

const VOICE = {
  English: 'en-US-AriaNeural',
  Hindi: 'hi-IN-SwaraNeural',
  Hinglish: 'hi-IN-SwaraNeural',   // romanized Hindi reads best on the hi-IN voice
  Kannada: 'kn-IN-SapnaNeural',
  Kanglish: 'kn-IN-SapnaNeural',
};

// Cartesia native voice IDs per language (user-specified premium voices)
const CARTESIA_DEFAULT_VOICES = {
  English: '63201864-3f35-4e34-8009-e1011672f760',
  Hindi: 'c1be4806-b6e0-40ea-9932-a887c51cb990',
  Hinglish: 'c1be4806-b6e0-40ea-9932-a887c51cb990',
  Kannada: '37f0d97c-0c50-409a-b911-459a1ce20052',
  Kanglish: '37f0d97c-0c50-409a-b911-459a1ce20052',
  Tamil: '4014f0c9-d3eb-4eca-af2b-fd6004f526be',
  Telugu: '4418bb06-8329-49a1-bb11-53bb64ca0547',
  Malayalam: 'b426013c-002b-4e89-8874-8cd20b68373a',
  Marathi: '5c32dce6-936a-4892-b131-bafe474afe5f',
  Bengali: '2ba861ea-7cdc-43d1-8608-4045b5a41de5',
  Spanish: '02aeee94-c02b-456e-be7a-659672acf82d',
  French: '80e11491-2d8a-4361-ac61-c4f3e0a4f7e7',
  German: '42f14755-88c3-4124-aae3-5cc3a9618e8f',
  Japanese: '498e7f37-7fa3-4e2c-b8e2-8b6e9276f956',
  Chinese: 'eda5bbff-1ff1-4886-8ef1-4e69a77640a0',
  Portuguese: 'b603811e-54c2-4a0a-8854-09eab9ffa63f'
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
  // Strip parentheticals like "Kannada (North Karnataka)"
  language = String(language || 'English').replace(/\s*\(.*?\)\s*$/, '').trim() || 'English';

  const cartesiaKey = 'sk_car_KngcxAQiMhv5aX9PkkZB2U';

  const langKey = Object.keys(CARTESIA_DEFAULT_VOICES).find(
    k => k.toLowerCase() === language.toLowerCase()
  ) || 'English';

  const voiceId = CARTESIA_DEFAULT_VOICES[langKey] || CARTESIA_DEFAULT_VOICES.English;
  const langCode = CARTESIA_LANG_CODES[langKey] || 'en';

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
  }
  const errText = await response.text();
  throw new Error(`Cartesia TTS API error ${response.status}: ${errText}`);
}
