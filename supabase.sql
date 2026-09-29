-- ERYLA METYLA · Evaluación de capacitaciones por encuentros
-- Ejecutar una sola vez en un proyecto Supabase nuevo.
-- Luego crear el usuario administrador en Authentication > Users y ejecutar:
-- insert into public.admin_profiles (user_id) values ('UUID-DEL-USUARIO');

create extension if not exists pgcrypto;
create schema if not exists private;

create table public.admin_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  instructor text not null check (char_length(instructor) between 2 and 120),
  hours numeric(6,1) not null check (hours > 0 and hours <= 1000),
  modality text not null check (modality in ('Presencial', 'Online', 'Mixto')),
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  status text not null default 'open' check (status in ('open', 'closed')),
  is_active boolean not null default true,
  active_encounter smallint not null default 1 check (active_encounter between 1 and 12),
  active_phase text not null default 'entrance' check (active_phase in ('entrance', 'exit')),
  encounters jsonb not null check (jsonb_typeof(encounters) = 'array' and jsonb_array_length(encounters) between 1 and 12),
  integrative_question jsonb not null check (jsonb_typeof(integrative_question) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index one_active_course on public.courses (is_active) where is_active = true;

create table public.participants (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  full_name text not null check (char_length(trim(full_name)) between 3 and 160),
  email text not null check (email ~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'),
  dni text not null check (char_length(regexp_replace(dni, '[^0-9]', '', 'g')) between 6 and 10),
  institution text not null check (char_length(trim(institution)) between 2 and 180),
  work_area text not null check (char_length(trim(work_area)) between 2 and 180),
  registered_at timestamptz not null default now(),
  unique (course_id, email),
  unique (course_id, dni)
);

create table public.ticket_responses (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  encounter_number smallint not null check (encounter_number between 1 and 12),
  phase text not null check (phase in ('entrance', 'exit')),
  answers jsonb not null check (jsonb_typeof(answers) = 'object'),
  expectation_text text check (expectation_text is null or char_length(trim(expectation_text)) between 5 and 500),
  expectation_fulfillment text check (expectation_fulfillment is null or expectation_fulfillment in ('Totalmente', 'Parcialmente', 'No cumplió')),
  course_usefulness smallint check (course_usefulness is null or course_usefulness between 1 and 5),
  group_number smallint check (group_number is null or group_number between 1 and 100),
  responded_at timestamptz not null default now(),
  unique (participant_id, encounter_number, phase)
);

create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.admin_profiles where user_id = auth.uid()); $$;

create or replace function private.sanitized_question(question jsonb)
returns jsonb language sql immutable
as $$ select question - 'correct_answer'; $$;

create or replace function private.sanitized_encounters(items jsonb)
returns jsonb language sql immutable
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'number', (encounter->>'number')::int,
      'title', encounter->>'title',
      'grouping', coalesce(encounter->'grouping', '{}'::jsonb),
      'questions', (
        select coalesce(jsonb_agg(private.sanitized_question(question)), '[]'::jsonb)
        from jsonb_array_elements(encounter->'questions') question
      )
    ) order by (encounter->>'number')::int
  ), '[]'::jsonb)
  from jsonb_array_elements(items) encounter;
$$;

create or replace function public.get_active_ticket()
returns jsonb language sql stable security definer set search_path = public, private
as $$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'instructor', c.instructor,
    'hours', c.hours, 'modality', c.modality,
    'start_date', c.start_date, 'end_date', c.end_date,
    'status', c.status, 'active_encounter', c.active_encounter,
    'active_phase', c.active_phase,
    'encounter_count', jsonb_array_length(c.encounters),
    'encounters', private.sanitized_encounters(c.encounters),
    'integrative_question', private.sanitized_question(c.integrative_question)
  )
  from public.courses c where c.is_active = true
  order by c.created_at desc limit 1;
$$;

create or replace function private.answer_keys_valid(answer_data jsonb, required_questions jsonb)
returns boolean language sql immutable
as $$
  select jsonb_typeof(answer_data) = 'object' and not exists (
    select 1 from jsonb_array_elements(required_questions) question
    where nullif(trim(answer_data->>(question->>'id')), '') is null
  );
$$;

create or replace function public.submit_active_ticket(
  p_course_id uuid, p_email text, p_answers jsonb,
  p_full_name text default null, p_dni text default null,
  p_institution text default null, p_work_area text default null,
  p_expectation_text text default null,
  p_expectation_fulfillment text default null,
  p_course_usefulness smallint default null
)
returns jsonb language plpgsql security definer set search_path = public, private
as $$
declare
  selected_course public.courses%rowtype;
  selected_participant uuid;
  selected_questions jsonb;
  final_encounter int;
  selected_grouping jsonb;
  configured_groups int;
  assigned_group int;
begin
  select * into selected_course from public.courses
  where id = p_course_id and is_active = true and status = 'open' for update;
  if not found then raise exception 'El curso no está recibiendo respuestas'; end if;
  final_encounter := jsonb_array_length(selected_course.encounters);

  select encounter->'questions' into selected_questions
  from jsonb_array_elements(selected_course.encounters) encounter
  where (encounter->>'number')::int = selected_course.active_encounter;

  select coalesce(encounter->'grouping'->(selected_course.active_phase), '{}'::jsonb)
  into selected_grouping
  from jsonb_array_elements(selected_course.encounters) encounter
  where (encounter->>'number')::int = selected_course.active_encounter;

  if selected_course.active_encounter = 1 and selected_course.active_phase = 'entrance' then
    if nullif(trim(p_full_name), '') is null or nullif(trim(p_dni), '') is null
       or nullif(trim(p_institution), '') is null or nullif(trim(p_work_area), '') is null then
      raise exception 'Faltan datos del participante';
    end if;
    insert into public.participants (course_id, full_name, email, dni, institution, work_area)
    values (p_course_id, trim(p_full_name), lower(trim(p_email)), regexp_replace(p_dni, '[^0-9]', '', 'g'), trim(p_institution), trim(p_work_area))
    returning id into selected_participant;
  else
    select id into selected_participant from public.participants
    where course_id = p_course_id and email = lower(trim(p_email));
    if selected_participant is null then raise exception 'No encontramos tu registro del Ticket 1 con ese correo'; end if;
  end if;

  if selected_course.active_encounter = 1 and selected_course.active_phase = 'entrance' then
    selected_questions := selected_questions || jsonb_build_array(selected_course.integrative_question);
  elsif selected_course.active_encounter = final_encounter and selected_course.active_phase = 'exit' then
    selected_questions := selected_questions || jsonb_build_array(selected_course.integrative_question);
  end if;
  if not private.answer_keys_valid(p_answers, selected_questions) then raise exception 'Faltan respuestas obligatorias'; end if;

  if coalesce((selected_grouping->>'enabled')::boolean, false) then
    configured_groups := greatest(2, least(100, coalesce((selected_grouping->>'group_count')::int, 2)));
    select candidate.number into assigned_group
    from generate_series(1, configured_groups) as candidate(number)
    left join (
      select group_number, count(*) as total
      from public.ticket_responses
      where course_id = p_course_id
        and encounter_number = selected_course.active_encounter
        and phase = selected_course.active_phase
        and group_number is not null
      group by group_number
    ) counts on counts.group_number = candidate.number
    order by coalesce(counts.total, 0), random()
    limit 1;
  end if;

  insert into public.ticket_responses (
    course_id, participant_id, encounter_number, phase, answers,
    expectation_text, expectation_fulfillment, course_usefulness, group_number
  ) values (
    p_course_id, selected_participant, selected_course.active_encounter, selected_course.active_phase, p_answers,
    case when selected_course.active_encounter = 1 and selected_course.active_phase = 'entrance' then nullif(trim(p_expectation_text), '') end,
    case when selected_course.active_encounter = final_encounter and selected_course.active_phase = 'exit' then p_expectation_fulfillment end,
    case when selected_course.active_phase = 'exit' then p_course_usefulness end,
    assigned_group
  );

  return jsonb_build_object(
    'group_number', assigned_group,
    'group_count', case when assigned_group is not null then configured_groups end,
    'expected_participants', case when assigned_group is not null then (selected_grouping->>'expected_participants')::int end
  );
exception when unique_violation then
  raise exception 'Este ticket ya fue completado con ese correo o DNI';
end;
$$;

alter table public.admin_profiles enable row level security;
alter table public.courses enable row level security;
alter table public.participants enable row level security;
alter table public.ticket_responses enable row level security;

create policy "Admins read profiles" on public.admin_profiles for select to authenticated using ((select private.is_admin()));
create policy "Admins manage courses" on public.courses for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "Admins manage participants" on public.participants for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "Admins manage responses" on public.ticket_responses for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

revoke all on public.admin_profiles, public.courses, public.participants, public.ticket_responses from anon;
revoke all on function public.get_active_ticket() from public;
revoke all on function public.submit_active_ticket(uuid,text,jsonb,text,text,text,text,text,text,smallint) from public;
revoke all on schema private from public;
grant usage on schema public to anon, authenticated;
grant execute on function public.get_active_ticket() to anon, authenticated;
grant execute on function public.submit_active_ticket(uuid,text,jsonb,text,text,text,text,text,text,smallint) to anon, authenticated;
grant select, insert, update, delete on public.courses, public.participants, public.ticket_responses to authenticated;
grant select on public.admin_profiles to authenticated;
