-- ERYLA METYLA · preguntas visibles u ocultas
-- Ejecutar una vez en el SQL Editor del proyecto existente.

create or replace function private.answer_keys_valid(answer_data jsonb, required_questions jsonb)
returns boolean language sql immutable
as $$
  select jsonb_typeof(answer_data) = 'object' and not exists (
    select 1 from jsonb_array_elements(required_questions) question
    where coalesce((question->>'enabled')::boolean, true)
      and nullif(trim(answer_data->>(question->>'id')), '') is null
  );
$$;
