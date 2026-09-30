export function mean(values) {
  const clean = values.map(Number).filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
}

export function median(values) {
  const clean = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return null;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
}

export function standardDeviation(values) {
  const clean = values.map(Number).filter(Number.isFinite);
  if (!clean.length) return null;
  const average = mean(clean);
  return Math.sqrt(clean.reduce((total, value) => total + ((value - average) ** 2), 0) / clean.length);
}

export function describe(values) {
  const clean = values.map(Number).filter(Number.isFinite);
  if (!clean.length) return { n: 0, mean: null, median: null, min: null, max: null, sd: null, range: null };
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  return { n: clean.length, mean: mean(clean), median: median(clean), min, max, sd: standardDeviation(clean), range: max - min };
}

export function distribution(values) {
  const counts = new Map();
  values.filter(value => String(value || "").trim()).forEach(value => {
    const label = String(value).trim();
    counts.set(label, (counts.get(label) || 0) + 1);
  });
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count, share: total ? count / total * 100 : 0 }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "es"));
}

export const EXPECTATION_FULFILLMENT = ["Totalmente", "Parcialmente", "No cumplió"];

export const EXPECTATION_RULES = [
  { key: "knowledge", label: "Ampliar conocimientos y capacidades", terms: ["aprender", "conocimiento", "conocimientos", "comprender", "entender", "profundizar", "actualizar", "saber", "capacidad", "capacidades", "habilidad", "habilidades", "competencia", "competencias"] },
  { key: "tools", label: "Obtener herramientas y recursos", terms: ["herramienta", "herramientas", "recurso", "recursos", "estrategia", "estrategias", "tecnica", "tecnicas", "metodo", "metodos", "material", "materiales", "instrumento", "instrumentos"] },
  { key: "practice", label: "Aplicar y mejorar la práctica", terms: ["aplicar", "practica", "practicas", "implementar", "trabajo", "laboral", "aula", "tarea", "ensenanza", "resolver", "desempeno", "cotidiano"] },
  { key: "growth", label: "Desarrollo personal o profesional", terms: ["crecer", "crecimiento", "desarrollo", "profesional", "personal", "mejorar", "fortalecer", "potenciar", "objetivo", "objetivos", "meta", "metas", "confianza"] },
  { key: "exchange", label: "Intercambiar experiencias y colaborar", terms: ["compartir", "intercambiar", "intercambio", "experiencia", "experiencias", "colega", "colegas", "equipo", "red", "debatir", "escuchar", "colaborar"] },
  { key: "other", label: "Otras expectativas", terms: [] }
];

export function normalizeText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function classifyExpectation(value) {
  const words = new Set(normalizeText(value).split(" ").filter(Boolean));
  const scores = EXPECTATION_RULES.slice(0, -1).map(rule => ({
    rule,
    score: rule.terms.reduce((total, term) => total + (words.has(term) ? 1 : 0), 0)
  }));
  scores.sort((a, b) => b.score - a.score);
  return scores[0]?.score ? scores[0].rule : EXPECTATION_RULES.at(-1);
}

function responseMap(responses, encounterNumber, phase) {
  return new Map(responses
    .filter(row => Number(row.encounter_number) === Number(encounterNumber) && row.phase === phase)
    .map(row => [row.participant_id, row]));
}

function answerResult(rows, question) {
  const valid = rows.map(row => row.answers?.[question.id]).filter(value => String(value || "").trim());
  const correct = valid.filter(value => String(value).trim() === String(question.correct_answer || "").trim()).length;
  return { n: valid.length, correct, share: valid.length ? correct / valid.length * 100 : 0 };
}

function compareQuestion(question, entrances, exits) {
  const entrance = answerResult([...entrances.values()], question);
  const exit = answerResult([...exits.values()], question);
  const paired = [...entrances.keys()].filter(id => exits.has(id));
  let improved = 0;
  let unchanged = 0;
  let worsened = 0;
  paired.forEach(id => {
    const before = entrances.get(id).answers?.[question.id] === question.correct_answer ? 1 : 0;
    const after = exits.get(id).answers?.[question.id] === question.correct_answer ? 1 : 0;
    if (after > before) improved += 1;
    else if (after < before) worsened += 1;
    else unchanged += 1;
  });
  return { ...question, entrance, exit, change: exit.share - entrance.share, paired: paired.length, improved, unchanged, worsened };
}

function expectationAnalysis(responses) {
  const entrances = responses.filter(row => row.encounter_number === 1 && row.phase === "entrance" && row.expectation_text);
  const finalExits = responses.filter(row => row.phase === "exit" && row.expectation_fulfillment);
  const exitsByParticipant = new Map(finalExits.map(row => [row.participant_id, row]));
  return EXPECTATION_RULES.map(rule => {
    const categoryRows = entrances.filter(row => classifyExpectation(row.expectation_text).key === rule.key);
    const counts = Object.fromEntries(EXPECTATION_FULFILLMENT.map(label => [label, 0]));
    categoryRows.forEach(row => {
      const fulfillment = exitsByParticipant.get(row.participant_id)?.expectation_fulfillment;
      if (counts[fulfillment] !== undefined) counts[fulfillment] += 1;
    });
    return { key: rule.key, label: rule.label, count: categoryRows.length, counts };
  });
}

export function buildReportData(course, data) {
  const participants = data.participants || [];
  const responses = data.responses || [];
  const encounters = (course.encounters || []).map(encounter => {
    const entrances = responseMap(responses, encounter.number, "entrance");
    const exits = responseMap(responses, encounter.number, "exit");
    const paired = [...entrances.keys()].filter(id => exits.has(id)).length;
    return {
      ...encounter,
      entranceCount: entrances.size,
      exitCount: exits.size,
      paired,
      completionRate: entrances.size ? paired / entrances.size * 100 : 0,
      questions: (encounter.questions || []).filter(question => question.enabled !== false).map(question => compareQuestion(question, entrances, exits)),
      usefulness: describe([...exits.values()].map(row => row.course_usefulness)),
      unitExpectations: [...entrances.values()].map(row => row.unit_expectation_text).filter(Boolean),
      satisfaction: describe([...exits.values()].map(row => row.unit_satisfaction)),
      satisfactionDistribution: distribution([...exits.values()].map(row => row.unit_satisfaction))
    };
  });
  const lastNumber = course.encounters?.length || 1;
  const integrative = course.integrative_question?.enabled === false ? null : compareQuestion(
    course.integrative_question || {},
    responseMap(responses, 1, "entrance"),
    responseMap(responses, lastNumber, "exit")
  );
  const completedTickets = new Map(participants.map(item => [item.id, 0]));
  responses.forEach(row => completedTickets.set(row.participant_id, (completedTickets.get(row.participant_id) || 0) + 1));
  const expectedTickets = lastNumber * 2;
  const finalExits = responses.filter(row => Number(row.encounter_number) === Number(lastNumber) && row.phase === "exit");
  return {
    course,
    participants,
    responses,
    encounters,
    integrative,
    expectedTickets,
    fullyCompleted: [...completedTickets.values()].filter(count => count === expectedTickets).length,
    institutions: distribution(participants.map(item => item.institution)),
    workAreas: distribution(participants.map(item => item.work_area)),
    expectations: expectationAnalysis(responses),
    trainerFeedback: {
      strengths: finalExits.map(row => row.instructor_strength).filter(Boolean),
      improvements: finalExits.map(row => row.improvement_suggestion).filter(Boolean)
    }
  };
}
