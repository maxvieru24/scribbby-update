-- Add segments (word/segment timestamps) and optional audio URL for full playback from history.

alter table public.transcription_jobs
  add column if not exists segments jsonb,
  add column if not exists audio_url text;

comment on column public.transcription_jobs.segments is 'Array of { start, end, text, words?: [{ word, start, end }] } for timestamps and click-to-seek';
comment on column public.transcription_jobs.audio_url is 'Public URL of the transcribed audio (e.g. Supabase Storage) for playback from history';
