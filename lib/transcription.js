/**
 * Groq Whisper V3 Large Turbo transcription.
 * Uses GROQ_API_KEY from env; endpoint: https://api.groq.com/openai/v1/audio/transcriptions
 */

const FormData = require('form-data');

const GROQ_TRANSCRIPTION_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const DEFAULT_MODEL = 'whisper-large-v3-turbo';

/**
 * Transcribe audio using Groq Whisper.
 * @param {Buffer} audio - Audio file buffer (e.g. WAV, MP3, WebM)
 * @param {string} [filename='audio.wav'] - Filename for the form (extension can affect behavior)
 * @param {string} [model] - Model name; default whisper-large-v3-turbo
 * @param {{ verbose?: boolean }} [opts] - If verbose true, request verbose_json with segment timestamps
 * @returns {Promise<{ text: string, segments?: Array<{ start: number, end: number, text: string, words?: Array<{ word: string, start: number, end: number }> }> }>}
 */
async function transcribe(audio, filename = 'audio.wav', model = DEFAULT_MODEL, opts = {}) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY is not set');

  const form = new FormData();
  form.append('file', audio, { filename });
  form.append('model', model);
  form.append('response_format', opts.verbose ? 'verbose_json' : 'json');
  if (opts.verbose) {
    form.append('timestamp_granularities[]', 'segment');
    form.append('timestamp_granularities[]', 'word');
  }

  // Send as a single Buffer so fetch sends the full multipart body (passing the stream
  // as body can result in empty/truncated upload and "multipart: NextPart: EOF" from Groq).
  const body = form.getBuffer();
  const headers = { ...form.getHeaders(), Authorization: `Bearer ${key}` };

  const res = await fetch(GROQ_TRANSCRIPTION_URL, {
    method: 'POST',
    headers,
    body,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq transcription failed: ${res.status} ${err}`);
  }

  const data = await res.json();
  const text = data.text || '';
  const segments = Array.isArray(data.segments)
    ? data.segments.map((s) => {
        const start = Number(s.start);
        const end = Number(s.end);
        const textTrimmed = (s.text || '').trim();
        const seg = { start, end, text: textTrimmed };
        if (Array.isArray(s.words) && s.words.length > 0) {
          seg.words = s.words.map((w) => ({
            word: String(w.word ?? ''),
            start: Number(w.start),
            end: Number(w.end),
          }));
        }
        return seg;
      }).filter((s) => s.text)
    : undefined;
  return { text, segments };
}

module.exports = { transcribe, DEFAULT_MODEL, GROQ_TRANSCRIPTION_URL };
