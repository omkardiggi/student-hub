// lib/tts.js — Neural voice via Fish Audio (for English Study Debate Coordinator & English Interviewer)
// or Cartesia (for English, Hindi, Kannada).
import 'dotenv/config';

// Fish Audio credentials (user-specified)
const FISH_AUDIO_API_KEY = process.env.FISH_AUDIO_API_KEY || '0dd30c6eb32543e09c37578d33f4cf2b';
const FISH_AUDIO_ENGLISH_VOICE_ID = process.env.FISH_AUDIO_VOICE_ID_ENGLISH || '8bfd8af689fb4dea8f5c6c07f7d58c31';

// Cartesia credentials & native voice IDs per language
const CARTESIA_API_KEY = process.env.CARTESIA_API_KEY || 'sk_car_KngcxAQiMhv5aX9PkkZB2U';

const CARTESIA_DEFAULT_VOICES = {
  English: process.env.CARTESIA_VOICE_ID_ENGLISH || '63201864-3f35-4e34-8009-e1011672f760',
  Hindi: process.env.CARTESIA_VOICE_ID_HINDI || 'c1be4806-b6e0-40ea-9932-a887c51cb990',
  Kannada: process.env.CARTESIA_VOICE_ID_KANNADA || '37f0d97c-0c50-409a-b911-459a1ce20052',
};

// Cartesia ISO language codes mapping
const CARTESIA_LANG_CODES = {
  English: 'en',
  Hindi: 'hi',
  Kannada: 'kn',
};

/**
 * Synthesize speech audio buffer.
 * Rules:
 * - Use Fish Audio (API Key: 0dd30c6eb32543e09c37578d33f4cf2b, Voice ID: 8bfd8af689fb4dea8f5c6c07f7d58c31) ONLY FOR:
 *     1) Study Debate AI Coordinator when language is English.
 *     2) Interview Section Interviewer when language is English.
 * - For all other cases/roles/languages, use Cartesia voices:
 *     English: CARTESIA_VOICE_ID_ENGLISH (63201864-3f35-4e34-8009-e1011672f760)
 *     Hindi: CARTESIA_VOICE_ID_HINDI (c1be4806-b6e0-40ea-9932-a887c51cb990)
 *     Kannada: CARTESIA_VOICE_ID_KANNADA (37f0d97c-0c50-409a-b911-459a1ce20052)
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
  const cleanLang = String(language || 'English').replace(/\s*\(.*?\)\s*$/, '').trim() || 'English';
  const langLower = cleanLang.toLowerCase();

  let langKey = 'English';
  if (/hindi|^hi/i.test(langLower)) {
    langKey = 'Hindi';
  } else if (/kannada|^kn/i.test(langLower)) {
    langKey = 'Kannada';
  } else {
    langKey = 'English';
  }

  const voiceId = CARTESIA_DEFAULT_VOICES[langKey] || CARTESIA_DEFAULT_VOICES.English;
  const langCode = CARTESIA_LANG_CODES[langKey] || 'en';

  const response = await fetch('https://api.cartesia.ai/tts/bytes', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CARTESIA_API_KEY}`,
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




