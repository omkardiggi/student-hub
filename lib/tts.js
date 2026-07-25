// lib/tts.js — Neural voice via Fish Audio (for English Study Debate Coordinator & English Interviewer)
// or Cartesia (for all other cases and languages).
import 'dotenv/config';

// Fish Audio credentials (user-specified)
const FISH_AUDIO_API_KEY = process.env.FISH_AUDIO_API_KEY || '0dd30c6eb32543e09c37578d33f4cf2b';
const FISH_AUDIO_ENGLISH_VOICE_ID = process.env.FISH_AUDIO_VOICE_ID_ENGLISH || '8bfd8af689fb4dea8f5c6c07f7d58c31';

// Cartesia native voice IDs per language (user-specified premium voices)
const CARTESIA_DEFAULT_VOICES = {
  English: process.env.CARTESIA_VOICE_ID_ENGLISH || '63201864-3f35-4e34-8009-e1011672f760',
  Hindi: process.env.CARTESIA_VOICE_ID_HINDI || 'c1be4806-b6e0-40ea-9932-a887c51cb990',
  Hinglish: 'c1be4806-b6e0-40ea-9932-a887c51cb990',
  Kannada: process.env.CARTESIA_VOICE_ID_KANNADA || '37f0d97c-0c50-409a-b911-459a1ce20052',
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

/**
 * Synthesize speech audio buffer.
 * Rules:
 * - Use Fish Audio (API Key: 0dd30c6eb32543e09c37578d33f4cf2b, Voice ID: 8bfd8af689fb4dea8f5c6c07f7d58c31) ONLY FOR:
 *     1) Study Debate AI Coordinator when language is English.
 *     2) Interview Section Interviewer when language is English.
 * - For all other cases/roles/languages, use Cartesia voices.
 */
export async function synthesize({ text, language = 'English', lessonTitle = '', role = '', section = '', mode = '', caller = '' }) {
  if (!text || !text.trim()) {
    throw new Error('No text provided for synthesis.');
  }

  // Strip parentheticals like "Kannada (North Karnataka)"
  const cleanLang = String(language || 'English').replace(/\s*\(.*?\)\s*$/, '').trim() || 'English';
  const isEnglish = /^en(glish)?$/i.test(cleanLang) || cleanLang.toLowerCase() === 'english';

  const roleLower = String(role || '').toLowerCase();
  const sectionLower = String(section || '').toLowerCase();
  const modeLower = String(mode || '').toLowerCase();
  const callerLower = String(caller || '').toLowerCase();

  // Check if call is for Study Debate AI Coordinator
  const isDebateContext = sectionLower.includes('debate') || modeLower.includes('debate') || callerLower.includes('debate');
  const isCoordinatorRole = roleLower.includes('coordinator') || roleLower.includes('judge') || callerLower.includes('coordinator');
  const isStudyDebateCoordinator = isDebateContext && isCoordinatorRole;

  // Check if call is for Interview Section Interviewer
  const isInterviewContext = sectionLower.includes('interview') || modeLower.includes('interview') || callerLower.includes('interview');
  const isInterviewerRole = roleLower.includes('interviewer') || roleLower.includes('hiring') || callerLower.includes('interviewer');
  const isInterviewInterviewer = isInterviewContext || isInterviewerRole;

  const useFishAudio = isEnglish && (isStudyDebateCoordinator || isInterviewInterviewer);

  if (useFishAudio) {
    try {
      const response = await fetch('https://api.fish.audio/v1/tts', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${FISH_AUDIO_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          reference_id: FISH_AUDIO_ENGLISH_VOICE_ID,
          format: 'mp3'
        }),
      });

      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
      }
      const errText = await response.text();
      console.warn(`Fish Audio API error (${response.status}): ${errText}. Falling back to Cartesia TTS...`);
    } catch (err) {
      console.warn(`Fish Audio TTS request failed: ${err.message}. Falling back to Cartesia TTS...`);
    }
  }

  // Fallback / Standard: Cartesia TTS for all other cases
  return await synthesizeCartesia({ text, language: cleanLang });
}

async function synthesizeCartesia({ text, language }) {
  const cartesiaKey = process.env.CARTESIA_API_KEY || 'sk_car_KngcxAQiMhv5aX9PkkZB2U';

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

