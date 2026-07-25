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
  English: process.env.CARTESIA_VOICE_ID_ENGLISH || '7ac18ded-a790-43a2-934c-0986e18292dd',
  Hindi: process.env.CARTESIA_VOICE_ID_HINDI || 'c3edccd2-23da-41f8-83f0-f34f8d985eb3',
  Hinglish: process.env.CARTESIA_VOICE_ID_HINDI || 'c3edccd2-23da-41f8-83f0-f34f8d985eb3',
  Kannada: process.env.CARTESIA_VOICE_ID_KANNADA || 'e7f56b14-ab11-49d9-b168-f0d5ab2ae463',
  Kanglish: process.env.CARTESIA_VOICE_ID_KANNADA || 'e7f56b14-ab11-49d9-b168-f0d5ab2ae463',
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


function resolveLangKey(lang) {
  const l = String(lang || 'English').replace(/\s*\(.*?\)\s*$/, '').trim().toLowerCase();
  if (l === 'hi' || l.startsWith('hi-') || l.includes('hindi')) return 'Hindi';
  if (l === 'hinglish') return 'Hinglish';
  if (l === 'kn' || l.startsWith('kn-') || l.includes('kannada')) return 'Kannada';
  if (l === 'kanglish') return 'Kanglish';
  if (l === 'ta' || l.startsWith('ta-') || l.includes('tamil')) return 'Tamil';
  if (l === 'te' || l.startsWith('te-') || l.includes('telugu')) return 'Telugu';
  if (l === 'ml' || l.startsWith('ml-') || l.includes('malayalam')) return 'Malayalam';
  if (l === 'mr' || l.startsWith('mr-') || l.includes('marathi')) return 'Marathi';
  if (l === 'bn' || l.startsWith('bn-') || l.includes('bengali')) return 'Bengali';
  if (l === 'es' || l.startsWith('es-') || l.includes('spanish')) return 'Spanish';
  if (l === 'fr' || l.startsWith('fr-') || l.includes('french')) return 'French';
  if (l === 'de' || l.startsWith('de-') || l.includes('german')) return 'German';
  if (l === 'ja' || l.startsWith('ja-') || l.includes('japanese')) return 'Japanese';
  if (l === 'zh' || l.startsWith('zh-') || l.includes('chinese')) return 'Chinese';
  if (l === 'pt' || l.startsWith('pt-') || l.includes('portuguese')) return 'Portuguese';
  return Object.keys(CARTESIA_DEFAULT_VOICES).find(k => k.toLowerCase() === l) || 'English';
}

export async function synthesize({ text, language = 'English', lessonTitle = '' }) {
  const envKey = process.env.CARTESIA_API_KEY;
  const cartesiaKey = (envKey && envKey.startsWith('sk_car_') && !envKey.includes('9FAhs83XS')) ? envKey : 'sk_car_1jFrVMrJN3WDuB1iwRF9Sr';
  const langKey = resolveLangKey(language);

  let voiceId;
  const envEng = process.env.CARTESIA_VOICE_ID_ENGLISH;
  const envHindi = process.env.CARTESIA_VOICE_ID_HINDI;
  const envKan = process.env.CARTESIA_VOICE_ID_KANNADA;

  if (langKey === 'English') {
    voiceId = (envEng && !envEng.includes('5a55be3b')) ? envEng : '7ac18ded-a790-43a2-934c-0986e18292dd';
  } else if (langKey === 'Hindi' || langKey === 'Hinglish') {
    voiceId = (envHindi && !envHindi.includes('13031f3d')) ? envHindi : 'c3edccd2-23da-41f8-83f0-f34f8d985eb3';
  } else if (langKey === 'Kannada' || langKey === 'Kanglish') {
    voiceId = (envKan && !envKan.includes('d2b9f01e')) ? envKan : 'e7f56b14-ab11-49d9-b168-f0d5ab2ae463';
  } else {
    voiceId = CARTESIA_DEFAULT_VOICES[langKey] || '7ac18ded-a790-43a2-934c-0986e18292dd';
  }

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
  console.error(`[Cartesia API Error ${response.status}]:`, errText);
  throw new Error(`Cartesia TTS API error ${response.status}: ${errText}`);
}
