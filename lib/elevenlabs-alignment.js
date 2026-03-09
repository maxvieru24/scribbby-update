/**
 * ElevenLabs Forced Alignment API: align audio to text and get word-level timestamps.
 * ElevenLabs Speech-to-Text API: transcribe with optional speaker diarization.
 * Uses ELEVENLABS_API_KEY from env.
 */

const FormData = require('form-data');

const ELEVENLABS_ALIGNMENT_URL = 'https://api.elevenlabs.io/v1/forced-alignment';
const ELEVENLABS_STT_URL = 'https://api.elevenlabs.io/v1/speech-to-text';

/**
 * Force-align audio to transcript text; returns word-level timestamps.
 * @param {Buffer} audio - Audio file buffer (e.g. WAV)
 * @param {string} text - Full transcript text to align
 * @param {string} [filename='audio.wav'] - Filename for the form
 * @returns {Promise<{ words: Array<{ word: string, start: number, end: number }> }>}
 */
async function forceAlign(audio, text, filename = 'audio.wav') {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('ELEVENLABS_API_KEY is not set');

  if (!text || !String(text).trim()) {
    return { words: [] };
  }

  const form = new FormData();
  form.append('file', audio, { filename });
  form.append('text', String(text).trim());

  const body = form.getBuffer();
  const headers = {
    ...form.getHeaders(),
    'xi-api-key': key,
  };

  const res = await fetch(ELEVENLABS_ALIGNMENT_URL, {
    method: 'POST',
    headers,
    body,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`ElevenLabs alignment failed: ${res.status} ${err}`);
  }

  const data = await res.json();
  const words = Array.isArray(data.words)
    ? data.words.map((w) => ({
        word: String(w.text ?? w.word ?? ''),
        start: Number(w.start),
        end: Number(w.end),
      }))
    : [];
  return { words };
}

/**
 * Build segments from a flat word list by splitting at sentence boundaries
 * (word text ending with . ! ?). Each segment has start, end, text, and words.
 * @param {Array<{ word: string, start: number, end: number }>} words
 * @returns {Array<{ start: number, end: number, text: string, words: Array<{ word: string, start: number, end: number }> }>}
 */
function wordsToSegments(words) {
  if (!words?.length) return [];
  const filtered = words.filter((w) => (String(w.word || '').trim() !== ''));
  if (!filtered.length) return [];
  const segments = [];
  let chunk = [];
  for (let i = 0; i < filtered.length; i++) {
    chunk.push(filtered[i]);
    const trimmed = String(filtered[i].word || '').trim();
    const endsSentence = /[.!?]$/.test(trimmed);
    if (endsSentence || i === filtered.length - 1) {
      segments.push({
        start: chunk[0].start,
        end: chunk[chunk.length - 1].end,
        text: chunk.map((w) => w.word).join(' ').trim(),
        words: chunk.slice(),
      });
      chunk = [];
    }
  }
  if (chunk.length > 0) {
    segments.push({
      start: chunk[0].start,
      end: chunk[chunk.length - 1].end,
      text: chunk.map((w) => w.word).join(' ').trim(),
      words: chunk.slice(),
    });
  }
  return segments;
}

/**
 * Transcribe audio with ElevenLabs Speech-to-Text (Scribe) with speaker diarization and word timestamps.
 * @param {Buffer} audio - Audio file buffer (e.g. WAV)
 * @param {string} [filename='audio.wav'] - Filename for the form
 * @returns {Promise<{ text: string, words: Array<{ word: string, start: number, end: number, speaker?: number }> }>}
 */
async function transcribeWithDiarization(audio, filename = 'audio.wav') {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('ELEVENLABS_API_KEY is not set');

  const form = new FormData();
  form.append('file', audio, { filename });
  form.append('model_id', 'scribe_v2');
  form.append('diarize', 'true');
  form.append('timestamps_granularity', 'word');

  const body = form.getBuffer();
  const headers = {
    ...form.getHeaders(),
    'xi-api-key': key,
  };

  const res = await fetch(ELEVENLABS_STT_URL, {
    method: 'POST',
    headers,
    body,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`ElevenLabs speech-to-text failed: ${res.status} ${err}`);
  }

  const data = await res.json();
  const text = data.text || '';
  const rawWords = Array.isArray(data.words) ? data.words : [];
  let hasAnySpeakerId = false;
  const words = rawWords
    .filter((w) => (w.type || 'word') === 'word' && String(w.text || '').trim() !== '')
    .map((w) => {
      let speaker;
      if (w.speaker_id != null) {
        hasAnySpeakerId = true;
        const sid = String(w.speaker_id);
        if (/speaker_(\d+)/i.test(sid)) speaker = parseInt(RegExp.$1, 10);
        else if (/^\d+$/.test(sid)) speaker = parseInt(sid, 10);
      }
      if (typeof w.speaker_id === 'number' && Number.isInteger(w.speaker_id)) {
        hasAnySpeakerId = true;
        speaker = w.speaker_id;
      }
      return {
        word: String(w.text ?? w.word ?? '').trim(),
        start: Number(w.start),
        end: Number(w.end),
        ...(speaker !== undefined && { speaker }),
      };
    });
  if (!hasAnySpeakerId && words.length > 0) {
    words.forEach((w) => { w.speaker = 0; });
  }
  return { text, words };
}

/**
 * Build segments from words that may include speaker; assign segment.speaker by majority in segment.
 * @param {Array<{ word: string, start: number, end: number, speaker?: number }>} words
 * @returns {Array<{ start: number, end: number, text: string, words: Array<{ word: string, start: number, end: number }>, speaker?: number }>}
 */
function wordsWithSpeakersToSegments(words) {
  if (!words?.length) return [];
  const filtered = words.filter((w) => (String(w.word || '').trim() !== ''));
  if (!filtered.length) return [];
  const segments = [];
  let chunk = [];
  for (let i = 0; i < filtered.length; i++) {
    chunk.push(filtered[i]);
    const trimmed = String(filtered[i].word || '').trim();
    const endsSentence = /[.!?]$/.test(trimmed);
    if (endsSentence || i === filtered.length - 1) {
      const segWords = chunk.map((w) => ({ word: w.word, start: w.start, end: w.end }));
      const speakerCounts = new Map();
      for (const w of chunk) {
        if (w.speaker !== undefined) {
          speakerCounts.set(w.speaker, (speakerCounts.get(w.speaker) || 0) + (w.end - w.start));
        }
      }
      let bestSpeaker;
      let bestDur = 0;
      for (const [sp, dur] of speakerCounts) {
        if (dur > bestDur) {
          bestDur = dur;
          bestSpeaker = sp;
        }
      }
      segments.push({
        start: chunk[0].start,
        end: chunk[chunk.length - 1].end,
        text: chunk.map((w) => w.word).join(' ').trim(),
        words: segWords,
        ...(bestSpeaker !== undefined && { speaker: bestSpeaker }),
      });
      chunk = [];
    }
  }
  if (chunk.length > 0) {
    const segWords = chunk.map((w) => ({ word: w.word, start: w.start, end: w.end }));
    const speakerCounts = new Map();
    for (const w of chunk) {
      if (w.speaker !== undefined) {
        speakerCounts.set(w.speaker, (speakerCounts.get(w.speaker) || 0) + (w.end - w.start));
      }
    }
    let bestSpeaker;
    let bestDur = 0;
    for (const [sp, dur] of speakerCounts) {
      if (dur > bestDur) {
        bestDur = dur;
        bestSpeaker = sp;
      }
    }
    segments.push({
      start: chunk[0].start,
      end: chunk[chunk.length - 1].end,
      text: chunk.map((w) => w.word).join(' ').trim(),
      words: segWords,
      ...(bestSpeaker !== undefined && { speaker: bestSpeaker }),
    });
  }
  return segments;
}

module.exports = {
  forceAlign,
  wordsToSegments,
  transcribeWithDiarization,
  wordsWithSpeakersToSegments,
  ELEVENLABS_ALIGNMENT_URL,
  ELEVENLABS_STT_URL,
};
