-- ERYLA METYLA · Expectativas por unidad y mejora del curso
-- No modifica cursos, encuentros ni preguntas técnicas existentes.

alter table public.ticket_responses
  add column if not exists unit_expectation_text text
    check (unit_expectation_text is null or char_length(trim(unit_expectation_text)) between 5 and 500),
  add column if not exists unit_satisfaction smallint
    check (unit_satisfaction is null or unit_satisfaction between 1 and 5),
  add column if not exists instructor_strength text
    check (instructor_strength is null or char_length(trim(instructor_strength)) between 5 and 500),
  add column if not exists improvement_suggestion text
    check (improvement_suggestion is null or char_length(trim(improvement_suggestion)) between 5 and 500);

drop function if exists public.submit_active_ticket(uuid,text,jsonb,text,text,text,text,text,text,smallint);

create function public.submit_active_ticket(
  p_course_id uuid, p_email text, p_answers jsonb,
  p_full_name text default null, p_dni text default null,
  p_institution text default null, p_work_area text default null,
  p_expectation_text text default null,
  p_expectation_fulfillment text default null,
  p_course_usefulness smallint default null,
  p_unit_expectation_text text default null,
  p_unit_satisfaction smallint default null,
  p_instructor_strength text default null,
  p_improvement_suggestion text default null
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

  select encounter->'questions', coalesce(encounter->'grouping'->(selected_course.active_phase), '{}'::jsonb)
  into selected_questions, selected_grouping
  from jsonb_array_elements(selected_course.encounters) encounter
  where (encounter->>'number')::int = selected_course.active_encounter;

  if selected_course.active_encounter = 1 and selected_course.active_phase = 'entrance' then
    if nullif(trim(p_full_name), '') is null or nullif(trim(p_dni), '') is null
       or nullif(trim(p_institution), '') is null or nullif(trim(p_work_area), '') is null then
      raise exception 'Faltan datos del participante';
    end if;
    if nullif(trim(p_expectation_text), '') is null then raise exception 'Falta la expectativa inicial del curso'; end if;
    insert into public.participants (course_id, full_name, email, dni, institution, work_area)
    values (p_course_id, trim(p_full_name), lower(trim(p_email)), regexp_replace(p_dni, '[^0-9]', '', 'g'), trim(p_institution), trim(p_work_area))
    returning id into selected_participant;
  else
    select id into selected_participant from public.participants
    where course_id = p_course_id and email = lower(trim(p_email));
    if selected_participant is null then raise exception 'No encontramos tu registro del Ticket 1 con ese correo'; end if;
  end if;

  if selected_course.active_phase = 'entrance' and selected_course.active_encounter > 1
     and nullif(trim(p_unit_expectation_text), '') is null then
    raise exception 'Falta la expectativa de la unidad';
  end if;
  if selected_course.active_phase = 'exit' and p_unit_satisfaction is null then
    raise exception 'Falta indicar la satisfacción con la unidad';
  end if;
  if selected_course.active_phase = 'exit' and p_course_usefulness is null then
    raise exception 'Falta indicar la utilidad del encuentro';
  end if;
  if selected_course.active_encounter = final_encounter and selected_course.active_phase = 'exit' then
    if p_expectation_fulfillment is null then raise exception 'Falta cerrar la expectativa inicial'; end if;
    if nullif(trim(p_instructor_strength), '') is null or nullif(trim(p_improvement_suggestion), '') is null then
      raise exception 'Faltan las respuestas de mejora del curso';
    end if;
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
    expectation_text, expectation_fulfillment,
    unit_expectation_text, unit_satisfaction,
    instructor_strength, improvement_suggestion,
    course_usefulness, group_number
  ) values (
    p_course_id, selected_participant, selected_course.active_encounter, selected_course.active_phase, p_answers,
    case when selected_course.active_encounter = 1 and selected_course.active_phase = 'entrance' then nullif(trim(p_expectation_text), '') end,
    case when selected_course.active_encounter = final_encounter and selected_course.active_phase = 'exit' then p_expectation_fulfillment end,
    case when selected_course.active_encounter > 1 and selected_course.active_phase = 'entrance' then nullif(trim(p_unit_expectation_text), '') end,
    case when selected_course.active_phase = 'exit' then p_unit_satisfaction end,
    case when selected_course.active_encounter = final_encounter and selected_course.active_phase = 'exit' then nullif(trim(p_instructor_strength), '') end,
    case when selected_course.active_encounter = final_encounter and selected_course.active_phase = 'exit' then nullif(trim(p_improvement_suggestion), '') end,
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

revoke all on function public.submit_active_ticket(uuid,text,jsonb,text,text,text,text,text,text,smallint,text,smallint,text,text) from public;
grant execute on function public.submit_active_ticket(uuid,text,jsonb,text,text,text,text,text,text,smallint,text,smallint,text,text) to anon, authenticated;
