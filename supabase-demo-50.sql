-- ERYLA METYLA · muestra demostrativa para informes
-- Agrega 50 participantes ficticios y completa todos los tickets del curso activo.
-- Es idempotente: si se ejecuta otra vez, no duplica participantes ni respuestas.

begin;

do $$
declare
  selected_course public.courses%rowtype;
  participant_number int;
  participant_dni text;
  selected_participant uuid;
  encounter jsonb;
  encounter_number int;
  phase_name text;
  question jsonb;
  question_order int;
  answers_json jsonb;
  answer_value text;
  answer_is_correct boolean;
  group_config jsonb;
  configured_groups int;
  assigned_group int;
  initial_expectation text;
  total_expected_responses int;
begin
  select * into selected_course
  from public.courses
  where is_active = true
  order by created_at desc
  limit 1;

  if not found then
    raise exception 'No hay un curso activo para generar la muestra';
  end if;

  if exists (
    select 1
    from public.participants
    where course_id = selected_course.id
      and dni between '99100001' and '99100050'
      and full_name not like 'Participante de prueba %'
  ) then
    raise exception 'El rango de DNI reservado para la muestra ya pertenece a otro participante';
  end if;

  for participant_number in 1..50 loop
    participant_dni := format('9910%s', lpad(participant_number::text, 4, '0'));

    insert into public.participants (
      course_id, full_name, email, dni, institution, work_area, registered_at
    ) values (
      selected_course.id,
      format('Participante de prueba %s', lpad(participant_number::text, 2, '0')),
      format('area%s@demo.eryla.test', mod(participant_number - 1, 5) + 1),
      participant_dni,
      case mod(participant_number - 1, 5)
        when 0 then 'Institución Norte'
        when 1 then 'Institución Centro'
        when 2 then 'Institución Sur'
        when 3 then 'Empresa de prueba'
        else 'Organismo público de prueba'
      end,
      case mod(participant_number - 1, 5)
        when 0 then 'Seguridad e Higiene'
        when 1 then 'Docencia'
        when 2 then 'Recursos Humanos'
        when 3 then 'Operaciones'
        else 'Administración'
      end,
      timestamptz '2026-09-29 07:30:00-03' + make_interval(mins => participant_number)
    )
    on conflict (course_id, dni) do nothing;

    select id into selected_participant
    from public.participants
    where course_id = selected_course.id
      and dni = participant_dni
      and full_name like 'Participante de prueba %';

    if selected_participant is null then
      raise exception 'No se pudo preparar el participante ficticio %', participant_number;
    end if;

    initial_expectation := case mod(participant_number - 1, 6)
      when 0 then 'Aprender y ampliar conocimientos para fortalecer mis capacidades como formador.'
      when 1 then 'Obtener herramientas, estrategias y métodos prácticos para planificar cursos.'
      when 2 then 'Aplicar lo aprendido y mejorar mi práctica de enseñanza en el trabajo.'
      when 3 then 'Mejorar mi desarrollo profesional y lograr objetivos con más confianza.'
      when 4 then 'Compartir experiencias y colaborar con colegas de otras áreas.'
      else 'Conocer nuevas perspectivas sobre la temática del curso.'
    end;

    for encounter in
      select value from jsonb_array_elements(selected_course.encounters)
    loop
      encounter_number := (encounter->>'number')::int;

      foreach phase_name in array array['entrance', 'exit'] loop
        answers_json := '{}'::jsonb;
        question_order := 0;

        for question in
          select value from jsonb_array_elements(encounter->'questions')
        loop
          if coalesce((question->>'enabled')::boolean, true) then
            question_order := question_order + 1;
            answer_is_correct := mod(participant_number + question_order * 2 + encounter_number * 3, 10)
              < case when phase_name = 'entrance' then 4 else 8 end;

            if answer_is_correct then
              answer_value := question->>'correct_answer';
            else
              select option into answer_value
              from jsonb_array_elements_text(question->'options') with ordinality as choices(option, position)
              where option <> question->>'correct_answer'
              order by mod(position + participant_number + encounter_number, 20), position
              limit 1;
            end if;

            answers_json := answers_json || jsonb_build_object(question->>'id', answer_value);
          end if;
        end loop;

        if (
          (encounter_number = 1 and phase_name = 'entrance')
          or (encounter_number = jsonb_array_length(selected_course.encounters) and phase_name = 'exit')
        ) and coalesce((selected_course.integrative_question->>'enabled')::boolean, true) then
          answer_is_correct := mod(participant_number, 10)
            < case when phase_name = 'entrance' then 3 else 8 end;

          if answer_is_correct then
            answer_value := selected_course.integrative_question->>'correct_answer';
          else
            select option into answer_value
            from jsonb_array_elements_text(selected_course.integrative_question->'options') with ordinality as choices(option, position)
            where option <> selected_course.integrative_question->>'correct_answer'
            order by mod(position + participant_number, 20), position
            limit 1;
          end if;

          answers_json := answers_json || jsonb_build_object(
            selected_course.integrative_question->>'id', answer_value
          );
        end if;

        group_config := coalesce(encounter->'grouping'->phase_name, '{}'::jsonb);
        if coalesce((group_config->>'enabled')::boolean, false) then
          configured_groups := greatest(2, least(100, coalesce(nullif(group_config->>'group_count', '')::int, 2)));
          assigned_group := mod(participant_number - 1, configured_groups) + 1;
        else
          assigned_group := null;
        end if;

        insert into public.ticket_responses (
          course_id, participant_id, encounter_number, phase, answers,
          expectation_text, expectation_fulfillment,
          unit_expectation_text, unit_satisfaction,
          instructor_strength, improvement_suggestion,
          course_usefulness, group_number, responded_at
        ) values (
          selected_course.id,
          selected_participant,
          encounter_number,
          phase_name,
          answers_json,
          case when encounter_number = 1 and phase_name = 'entrance' then initial_expectation end,
          case when encounter_number = jsonb_array_length(selected_course.encounters) and phase_name = 'exit' then
            case mod(participant_number, 10)
              when 6 then 'Parcialmente'
              when 7 then 'Parcialmente'
              when 8 then 'Parcialmente'
              when 9 then 'No cumplió'
              else 'Totalmente'
            end
          end,
          case when encounter_number > 1 and phase_name = 'entrance' then
            case mod(participant_number + encounter_number, 5)
              when 0 then 'Aprender estrategias concretas para planificar mejores clases.'
              when 1 then 'Comprender cómo adaptar los contenidos a distintos grupos.'
              when 2 then 'Obtener herramientas prácticas para mejorar la comunicación.'
              when 3 then 'Intercambiar experiencias aplicables a mi trabajo.'
              else 'Fortalecer mis capacidades para organizar una capacitación.'
            end
          end,
          case when phase_name = 'exit' then
            case mod(participant_number + encounter_number, 10)
              when 0 then 2
              when 1 then 3
              when 2 then 3
              when 3 then 4
              when 4 then 4
              when 5 then 4
              when 6 then 4
              else 5
            end
          end,
          case when encounter_number = jsonb_array_length(selected_course.encounters) and phase_name = 'exit' then
            case mod(participant_number, 4)
              when 0 then 'Explicó los contenidos con claridad y buenos ejemplos.'
              when 1 then 'Generó participación y escuchó las consultas del grupo.'
              when 2 then 'Relacionó la teoría con situaciones concretas de trabajo.'
              else 'Organizó bien los tiempos y mantuvo un buen ritmo.'
            end
          end,
          case when encounter_number = jsonb_array_length(selected_course.encounters) and phase_name = 'exit' then
            case mod(participant_number, 4)
              when 0 then 'Agregar más ejercicios prácticos y casos reales.'
              when 1 then 'Destinar más tiempo al intercambio entre participantes.'
              when 2 then 'Compartir un resumen de los conceptos principales.'
              else 'Incluir una actividad breve de repaso al cierre.'
            end
          end,
          case when phase_name = 'exit' then
            case mod(participant_number + encounter_number + 2, 10)
              when 0 then 2
              when 1 then 3
              when 2 then 3
              when 3 then 4
              when 4 then 4
              when 5 then 4
              when 6 then 4
              else 5
            end
          end,
          assigned_group,
          timestamptz '2026-09-29 08:00:00-03'
            + make_interval(
                hours => (encounter_number - 1) * 3 + case when phase_name = 'exit' then 2 else 0 end,
                mins => participant_number
              )
        )
        on conflict do nothing;
      end loop;
    end loop;
  end loop;

  total_expected_responses := 50 * jsonb_array_length(selected_course.encounters) * 2;

  if (
    select count(*) from public.participants
    where course_id = selected_course.id
      and dni between '99100001' and '99100050'
      and full_name like 'Participante de prueba %'
  ) <> 50 then
    raise exception 'La muestra no contiene exactamente 50 participantes';
  end if;

  if (
    select count(*)
    from public.ticket_responses r
    join public.participants p on p.id = r.participant_id
    where p.course_id = selected_course.id
      and p.dni between '99100001' and '99100050'
      and p.full_name like 'Participante de prueba %'
  ) <> total_expected_responses then
    raise exception 'La muestra no completó todos los tickets';
  end if;
end;
$$;

commit;

select
  count(distinct p.id) as participantes_de_prueba,
  count(r.id) as respuestas_de_prueba,
  count(distinct (r.encounter_number, r.phase)) as tickets_con_muestra
from public.participants p
join public.ticket_responses r on r.participant_id = p.id
where p.dni between '99100001' and '99100050'
  and p.full_name like 'Participante de prueba %';
