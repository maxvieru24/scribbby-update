-- Table: public.transcription_jobs
-- Tracks transcription tasks: metadata, progress, and link to transcript.

create table public.transcription_jobs (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references auth.users(id) on delete cascade,

  status text not null default 'queued' check (status in (
    'queued', 'downloading', 'converting', 'transcribing', 'saving', 'completed', 'failed'
  )),
  source_type text not null check (source_type in ('url', 'upload')),
  source_url text,
  original_filename text,
  title text,

  progress integer not null default 0 check (progress >= 0 and progress <= 100),
  step text not null default 'queued',

  duration_sec integer,
  language text,

  transcript_id uuid,
  error text,

  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

comment on column public.transcription_jobs.user_id is 'Owner of the transcription job';
comment on column public.transcription_jobs.source_type is 'Indicates whether transcription came from a file upload or external link';
comment on column public.transcription_jobs.source_url is 'Original media URL when source_type = url';
comment on column public.transcription_jobs.original_filename is 'Uploaded file name when source_type = upload';
comment on column public.transcription_jobs.title is 'User-facing title for the transcription';
comment on column public.transcription_jobs.progress is 'Progress percentage (0–100)';
comment on column public.transcription_jobs.step is 'Current processing step';
comment on column public.transcription_jobs.duration_sec is 'Audio duration in seconds';
comment on column public.transcription_jobs.language is 'Detected language of the transcript';
comment on column public.transcription_jobs.transcript_id is 'Reference to transcripts table';
comment on column public.transcription_jobs.error is 'Error message if job fails';

create index idx_transcription_jobs_user
  on public.transcription_jobs(user_id);

create index idx_transcription_jobs_status
  on public.transcription_jobs(status);

create index idx_transcription_jobs_created_at
  on public.transcription_jobs(created_at desc);

alter table public.transcription_jobs enable row level security;

create policy "Users can read own jobs"
  on public.transcription_jobs for select
  using (auth.uid() = user_id);

create policy "Users can insert own jobs"
  on public.transcription_jobs for insert
  with check (auth.uid() = user_id);

-- Allow users to update only their own jobs (e.g. for progress polling); workers use service role
create policy "Users can update own jobs"
  on public.transcription_jobs for update
  using (auth.uid() = user_id);
