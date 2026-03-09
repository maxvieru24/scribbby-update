-- Table: public.profiles
-- References auth.users(id), stores subscription and usage metadata.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,

  plan text not null default 'free' check (plan in ('free', 'pro')),
  subscription_status text not null default 'inactive' check (
    subscription_status in ('inactive', 'active', 'canceled', 'past_due', 'trialing')
  ),
  billing_interval text check (billing_interval is null or billing_interval in ('month', 'year')),

  pro_started_at timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,

  jobs_created_total integer not null default 0,
  minutes_transcribed_total integer not null default 0,

  concurrent_jobs_limit integer not null default 1,
  daily_job_limit integer not null default 3,

  last_job_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can read own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Trigger: create a profile row when a new user is created in auth.users
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id)
  values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
