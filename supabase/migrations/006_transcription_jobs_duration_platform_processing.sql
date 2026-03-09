-- Add source_platform and processing_sec to transcription_jobs.
-- duration_sec already exists in 003.

alter table public.transcription_jobs
  add column if not exists source_platform text,
  add column if not exists processing_sec integer;

comment on column public.transcription_jobs.source_platform is 'Platform/site when source_type=url (e.g. youtube, instagram, tiktok); null otherwise';
comment on column public.transcription_jobs.processing_sec is 'Total processing time in seconds (download + convert + transcribe)';
