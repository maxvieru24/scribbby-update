-- Table: public.billing_customers
-- Maps auth.users to Stripe customers/subscriptions for webhooks and lookups.

create table public.billing_customers (
  user_id uuid primary key references auth.users(id) on delete cascade,

  stripe_customer_id text unique not null,
  stripe_subscription_id text unique,
  stripe_price_id text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.billing_customers.stripe_customer_id is 'Stripe customer ID (cus_...)';
comment on column public.billing_customers.stripe_subscription_id is 'Stripe subscription ID (sub_...)';
comment on column public.billing_customers.stripe_price_id is 'Stripe price ID for the active plan';

create index idx_billing_customers_stripe_customer
  on public.billing_customers(stripe_customer_id);

alter table public.billing_customers enable row level security;

create policy "Users can read own billing row"
  on public.billing_customers for select
  using (auth.uid() = user_id);

-- Inserts/updates/deletes are done server-side with the service role key (e.g. webhooks); no user policy needed.
