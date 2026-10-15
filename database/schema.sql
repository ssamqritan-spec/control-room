-- =====================================================================
--  BURSARY CONTROL ROOM  -  ONE database for BOTH websites
--  Elimu Kenya  (site = 'elimu')   and   KMTC Bursary  (site = 'kmtc')
--
--  Run this ONCE in Supabase > SQL Editor on a fresh project.
--  It is safe to run again: nothing is dropped and no rows are touched.
--  There is NO demo or sample data in this file.
-- =====================================================================

-- ---------- TABLES ---------------------------------------------------
create table if not exists public.applications (
  id            uuid primary key default gen_random_uuid(),
  site          text not null check (site in ('elimu','kmtc')),
  ref           text not null unique,
  -- studies
  inst_type     text, institution text, year text, course text,
  helb          text,            -- Elimu: HELB / HEF support
  level         text,            -- KMTC: programme level
  adm_no        text,            -- KMTC: admission number
  other_support text,            -- KMTC: other support
  -- money (computed on the SERVER from the band, never trusted from the browser)
  band          int  not null check (band between 1 and 5),
  amount        int  not null,   -- what the student is TO RECEIVE
  fee           int  not null,   -- processing fee the student must PAY
  -- person
  student text, birth_year int, phone text, email text,
  county text, subcounty text, town text, location text, sublocation text,
  guardian text, relationship text, condition text, story text,
  -- progress
  status        text not null default 'pending_payment'
                check (status in ('pending_payment','payment_submitted','verified','payment_rejected')),
  created_at    timestamptz not null default now(),   -- moment the application was completed
  updated_at    timestamptz not null default now()
);

create table if not exists public.payments (
  id              uuid primary key default gen_random_uuid(),
  site            text not null check (site in ('elimu','kmtc')),
  ref             text not null references public.applications(ref),
  method          text default 'send_money',
  mpesa_code      text not null,
  phone           text,
  amount_reported int  not null,          -- fee the student was asked to pay
  amount_received int,                    -- what the admin confirmed on verification
  status          text not null default 'pending' check (status in ('pending','verified','rejected')),
  created_at      timestamptz not null default now(),   -- moment the student submitted payment
  reviewed_at     timestamptz,
  review_note     text
);
-- one M-Pesa code can only back one live payment (a rejected code may be retried)
create unique index if not exists payments_code_live on public.payments (upper(mpesa_code)) where status <> 'rejected';
create index if not exists payments_ref_idx   on public.payments (ref);
create index if not exists payments_site_idx  on public.payments (site, created_at desc);
create index if not exists applications_site_idx on public.applications (site, created_at desc);
create index if not exists applications_status_idx on public.applications (site, status);

create table if not exists public.events (
  id         bigint generated always as identity primary key,
  site       text not null,
  ref        text,
  event      text not null,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists events_site_idx on public.events (site, created_at desc);

-- Browsers can NEVER read or write tables directly. Only the functions below.
alter table public.applications enable row level security;
alter table public.payments     enable row level security;
alter table public.events       enable row level security;

-- ---------- FUNCTIONS CALLED BY THE TWO PUBLIC WEBSITES ---------------
create or replace function public.submit_application(p jsonb) returns json
language plpgsql security definer set search_path = public as $$
declare
  s text := lower(coalesce(p->>'site',''));
  b int;  amt int;  f int;  r text;
begin
  if s not in ('elimu','kmtc') then raise exception 'unknown site'; end if;
  begin b := (p->>'band')::int; exception when others then raise exception 'invalid band'; end;
  if b is null or b not between 1 and 5 then raise exception 'invalid band'; end if;
  if coalesce(trim(p->>'student'),'') = '' or coalesce(trim(p->>'phone'),'') = '' then
    raise exception 'name and phone are required';
  end if;
  amt := case b when 1 then 20000 when 2 then 16250 when 3 then 12500 when 4 then 8750 else 5000 end;
  f   := case b when 1 then 300   when 2 then 250   when 3 then 200   when 4 then 150  else 100  end;
  r   := (case s when 'kmtc' then 'KM-' else 'EK-' end) || upper(substr(md5(random()::text || clock_timestamp()::text),1,8));

  insert into applications(site,ref,inst_type,institution,year,course,helb,level,adm_no,other_support,band,amount,fee,
        student,birth_year,phone,email,county,subcounty,town,location,sublocation,guardian,relationship,condition,story)
  values (s,r,left(p->>'instType',40),left(p->>'institution',150),left(p->>'year',20),left(p->>'course',120),
        left(p->>'helb',30),left(p->>'level',30),left(p->>'admNo',40),left(p->>'otherSupport',40),b,amt,f,
        left(p->>'student',120),nullif(p->>'birthYear','')::int,left(p->>'phone',25),left(p->>'email',120),
        left(p->>'county',40),left(p->>'subcounty',120),left(p->>'town',120),left(p->>'location',120),left(p->>'sublocation',120),
        left(p->>'guardian',120),left(p->>'relationship',20),left(p->>'condition',80),left(p->>'story',600));

  insert into events(site,ref,event,detail) values (s,r,'application_completed',jsonb_build_object('band',b,'amount',amt,'fee',f));
  return json_build_object('ref',r,'amount',amt,'fee',f);
end $$;

create or replace function public.submit_payment(p_ref text, p_code text, p_phone text) returns void
language plpgsql security definer set search_path = public as $$
declare a applications%rowtype;
begin
  if p_code !~ '^[A-Za-z0-9]{10}$' then raise exception 'invalid code'; end if;
  select * into a from applications where ref = p_ref for update;
  if not found then raise exception 'unknown reference'; end if;
  if a.status = 'verified' then raise exception 'already verified'; end if;
  insert into payments(site,ref,mpesa_code,phone,amount_reported)
       values (a.site,a.ref,upper(p_code),left(p_phone,25),a.fee);
  update applications set status='payment_submitted', updated_at=now() where ref=a.ref;
  insert into events(site,ref,event,detail)
       values (a.site,a.ref,'payment_submitted',jsonb_build_object('mpesa_code',upper(p_code),'fee',a.fee));
end $$;

create or replace function public.application_status(p_ref text) returns text
language sql security definer set search_path = public stable as
$$ select status from applications where ref = p_ref $$;

-- ---------- FUNCTIONS USED ONLY BY THE CONTROL ROOM (service key) -----
create or replace function public.admin_overview() returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare out jsonb := '{}'::jsonb; s text; day0 timestamptz := date_trunc('day', now() at time zone 'Africa/Nairobi') at time zone 'Africa/Nairobi';
begin
  foreach s in array array['elimu','kmtc'] loop
    out := out || jsonb_build_object(s, jsonb_build_object(
      'applications',   (select count(*) from applications where site=s),
      'awaiting_payment',(select count(*) from applications where site=s and status='pending_payment'),
      'payment_submitted',(select count(*) from applications where site=s and status='payment_submitted'),
      'verified',       (select count(*) from applications where site=s and status='verified'),
      'rejected',       (select count(*) from applications where site=s and status='payment_rejected'),
      'to_receive_all', (select coalesce(sum(amount),0) from applications where site=s),
      'to_receive_paid',(select coalesce(sum(amount),0) from applications where site=s and status in ('payment_submitted','verified')),
      'to_receive_verified',(select coalesce(sum(amount),0) from applications where site=s and status='verified'),
      'fees_received',  (select coalesce(sum(amount_received),0) from payments where site=s and status='verified'),
      'fees_pending',   (select coalesce(sum(amount_reported),0) from payments where site=s and status='pending'),
      'today_applications',(select count(*) from applications where site=s and created_at>=day0),
      'today_payments', (select count(*) from payments where site=s and created_at>=day0),
      'bands', (select coalesce(jsonb_object_agg(band,n),'{}'::jsonb) from (select band,count(*) n from applications where site=s group by band) x),
      'daily', (select coalesce(jsonb_agg(jsonb_build_object('d',d::date,
                  'applications',(select count(*) from applications a where a.site=s and (a.created_at at time zone 'Africa/Nairobi')::date=d::date),
                  'payments',(select count(*) from payments p where p.site=s and (p.created_at at time zone 'Africa/Nairobi')::date=d::date)) order by d),'[]'::jsonb)
                from generate_series((now() at time zone 'Africa/Nairobi')::date-13,(now() at time zone 'Africa/Nairobi')::date,interval '1 day') d)
    ));
  end loop;
  return out;
end $$;

create or replace function public.admin_records(
  p_site text, p_view text, p_page int default 0, p_search text default '',
  p_status text default '', p_band int default null,
  p_from timestamptz default null, p_to timestamptz default null, p_size int default 25
) returns jsonb language plpgsql security definer set search_path = public stable as $$
declare q text := lower(coalesce(p_search,'')); total bigint; rows jsonb; lim int := least(greatest(p_size,1),20000); off int := greatest(p_page,0) * least(greatest(p_size,1),20000);
begin
  if p_site not in ('elimu','kmtc') then raise exception 'unknown site'; end if;

  if p_view = 'applications' then
    select count(*) into total from applications a
     where a.site=p_site and (p_status='' or a.status=p_status) and (p_band is null or a.band=p_band)
       and (p_from is null or a.created_at>=p_from) and (p_to is null or a.created_at<p_to)
       and (q='' or strpos(lower(concat_ws(' ',a.student,a.email,a.phone,a.ref,a.adm_no)),q)>0
            or exists(select 1 from payments p where p.ref=a.ref and strpos(lower(p.mpesa_code),q)>0));
    select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into rows from (
      select a.*,
        lp.mpesa_code, lp.status as payment_status, lp.created_at as paid_at, lp.id as payment_id,
        (select coalesce(sum(amount_received),0) from payments p where p.ref=a.ref and p.status='verified') as fee_received
      from applications a
      left join lateral (select * from payments p where p.ref=a.ref order by p.created_at desc limit 1) lp on true
      where a.site=p_site and (p_status='' or a.status=p_status) and (p_band is null or a.band=p_band)
        and (p_from is null or a.created_at>=p_from) and (p_to is null or a.created_at<p_to)
        and (q='' or strpos(lower(concat_ws(' ',a.student,a.email,a.phone,a.ref,a.adm_no)),q)>0
             or exists(select 1 from payments p where p.ref=a.ref and strpos(lower(p.mpesa_code),q)>0))
      order by a.created_at desc limit lim offset off) t;

  elsif p_view = 'payments' then
    select count(*) into total from payments p join applications a on a.ref=p.ref
     where p.site=p_site and (p_status='' or p.status=p_status) and (p_band is null or a.band=p_band)
       and (p_from is null or p.created_at>=p_from) and (p_to is null or p.created_at<p_to)
       and (q='' or strpos(lower(concat_ws(' ',a.student,a.email,a.phone,p.phone,p.ref,p.mpesa_code)),q)>0);
    select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into rows from (
      select p.id as payment_id, p.ref, p.mpesa_code, p.phone as pay_phone, p.amount_reported, p.amount_received,
             p.status as payment_status, p.created_at as paid_at, p.reviewed_at, p.review_note,
             a.id as application_id, a.student, a.phone, a.email, a.band, a.amount, a.fee, a.created_at as applied_at, a.status
      from payments p join applications a on a.ref=p.ref
      where p.site=p_site and (p_status='' or p.status=p_status) and (p_band is null or a.band=p_band)
        and (p_from is null or p.created_at>=p_from) and (p_to is null or p.created_at<p_to)
        and (q='' or strpos(lower(concat_ws(' ',a.student,a.email,a.phone,p.phone,p.ref,p.mpesa_code)),q)>0)
      order by p.created_at desc limit lim offset off) t;

  elsif p_view = 'activity' then
    select count(*) into total from events e left join applications a on a.ref=e.ref
     where e.site=p_site and (p_from is null or e.created_at>=p_from) and (p_to is null or e.created_at<p_to)
       and (q='' or strpos(lower(concat_ws(' ',e.event,e.ref,a.student)),q)>0);
    select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into rows from (
      select e.id, e.event, e.ref, e.detail, e.created_at, a.student, a.id as application_id
      from events e left join applications a on a.ref=e.ref
      where e.site=p_site and (p_from is null or e.created_at>=p_from) and (p_to is null or e.created_at<p_to)
        and (q='' or strpos(lower(concat_ws(' ',e.event,e.ref,a.student)),q)>0)
      order by e.created_at desc, e.id desc limit lim offset off) t;
  else
    raise exception 'unknown view';
  end if;
  return jsonb_build_object('total',total,'rows',rows);
end $$;

create or replace function public.admin_application(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare a applications%rowtype;
begin
  select * into a from applications where id = p_id;
  if not found then raise exception 'Application not found'; end if;
  return jsonb_build_object(
    'application', to_jsonb(a),
    'payments', (select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc),'[]'::jsonb) from payments p where p.ref=a.ref),
    'events',   (select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc, e.id desc),'[]'::jsonb) from events e where e.ref=a.ref));
end $$;

create or replace function public.admin_review_payment(
  p_payment_id uuid, p_expected_status text, p_new_status text, p_note text default '', p_amount_received int default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare p payments%rowtype; a applications%rowtype; amt int; has_verified boolean;
begin
  if p_new_status not in ('verified','rejected','pending') then raise exception 'Invalid status'; end if;
  select * into p from payments where id = p_payment_id for update;
  if not found then raise exception 'Payment not found'; end if;
  if p.status <> p_expected_status then raise exception 'Another session changed this payment. Refresh and try again.'; end if;
  if p_new_status = 'rejected' and length(trim(coalesce(p_note,''))) < 3 then raise exception 'Provide a reason for rejecting.'; end if;
  select * into a from applications where ref = p.ref for update;

  amt := case when p_new_status='verified' then coalesce(p_amount_received, p.amount_reported) else null end;
  if amt is not null and (amt < 0 or amt > 1000000) then raise exception 'Invalid amount'; end if;

  update payments set status=p_new_status, amount_received=amt, reviewed_at=now(), review_note=left(coalesce(p_note,''),500) where id=p.id;

  select exists(select 1 from payments where ref=a.ref and status='verified') into has_verified;
  update applications set updated_at=now(), status = case
      when has_verified then 'verified'
      when exists(select 1 from payments where ref=a.ref and status='pending') then 'payment_submitted'
      when exists(select 1 from payments where ref=a.ref and status='rejected') then 'payment_rejected'
      else 'pending_payment' end
    where ref=a.ref;

  insert into events(site,ref,event,detail) values (a.site,a.ref,'payment_'||p_new_status,
     jsonb_build_object('mpesa_code',p.mpesa_code,'amount_received',amt,'note',left(coalesce(p_note,''),500)));
  return jsonb_build_object('ok',true,'payment_id',p.id,'status',p_new_status);
end $$;

-- ---------- PERMISSIONS ---------------------------------------------
-- Postgres gives EXECUTE to everyone by default, so revoke first.
revoke all on function
  public.submit_application(jsonb), public.submit_payment(text,text,text), public.application_status(text),
  public.admin_overview(), public.admin_records(text,text,int,text,text,int,timestamptz,timestamptz,int),
  public.admin_application(uuid), public.admin_review_payment(uuid,text,text,text,int)
from public, anon, authenticated;

-- the two public websites (publishable/anon key) may ONLY do these three things
grant execute on function public.submit_application(jsonb), public.submit_payment(text,text,text), public.application_status(text) to anon;

-- the control room (server-side service_role key) only
grant execute on function public.admin_overview(), public.admin_records(text,text,int,text,text,int,timestamptz,timestamptz,int),
  public.admin_application(uuid), public.admin_review_payment(uuid,text,text,text,int) to service_role;
