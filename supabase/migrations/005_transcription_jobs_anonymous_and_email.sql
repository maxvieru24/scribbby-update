-- Allow anonymous transcription jobs (user_id null) and store user email for assigned jobs.
-- Add transcript text and update RLS so only server (service role) inserts jobs.

alter table public.transcription_jobs
  alter column user_id drop not null;

alter table public.transcription_jobs
  add column if not exists user_email text,
  add column if not exists transcript_text text;

comment on column public.transcription_jobs.user_email is 'Email of the user who created the job when logged in; null for anonymous';
comment on column public.transcription_jobs.transcript_text is 'Full transcript text from Whisper';

-- Server inserts with service role; users only read their own (user_id = auth.uid()).
-- Anonymous jobs (user_id is null) are not readable via RLS by anyone.
drop policy if exists "Users can insert own jobs" on public.transcription_jobs;

-- Optional: allow service/backend to insert (service role bypasses RLS anyway).
-- No insert policy for anon key: only service role can insert.

-- Atomic increment of profiles.jobs_created_total (called by server after each transcription).
create or replace function public.increment_profile_jobs_created_total(p_user_id uuid)
returns void
language sql
security definer set search_path = public
as $$
  update public.profiles
  set jobs_created_total = jobs_created_total + 1,
      updated_at = now()
  where id = p_user_id;
$$;
