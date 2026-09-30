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
  { key: "skills", label: "Adquirir nuevas habilidades" },
  { key: "tools", label: "Adquirir nuevas herramientas" },
  { key: "practice", label: "Practicar habilidades ya obtenidas" },
  { key: "refresh", label: "Refrescar conocimientos anteriores" },
  { key: "none", label: "Sin expectativas o sin respuesta" },
  { key: "other", label: "Otras respuestas" }
];

export function normalizeText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function includesAny(words, terms) {
  return terms.some(term => words.has(term));
}

export function classifyExpectation(value) {
  const normalized = normalizeText(value);
  const words = new Set(normalized.split(" ").filter(Boolean));
  const rule = key => EXPECTATION_RULES.find(item => item.key === key);
  const noExpectationPhrases = ["no tengo expectativas", "sin expectativas", "ninguna expectativa", "no espero nada", "no se", "ns nc", "sin respuesta", "no respondio"];
  const refreshTerms = ["refrescar", "recordar", "repasar", "actualizar", "recuperar", "reforzar", "renovar", "afianzar", "revisar"];
  const practiceTerms = ["practicar", "aplicar", "implementar", "ejercitar", "entrenar", "experimentar"];
  const toolTerms = ["herramienta", "herramientas", "recurso", "recursos", "estrategia", "estrategias", "tecnica", "tecnicas", "metodo", "metodos", "instrumento", "instrumentos", "material", "materiales"];
  const skillTerms = ["habilidad", "habilidades", "capacidad", "capacidades", "competencia", "competencias", "destreza", "destrezas"];

  if (!normalized || noExpectationPhrases.some(phrase => normalized.includes(phrase)) || ["ninguna", "nada"].includes(normalized)) return rule("none");
  if (includesAny(words, refreshTerms)) return rule("refresh");
  if (includesAny(words, practiceTerms) || normalized.includes("poner en practica") || normalized.includes("llevar a la practica")) return rule("practice");

  const toolScore = toolTerms.reduce((total, term) => total + (words.has(term) ? 1 : 0), 0);
  const skillScore = skillTerms.reduce((total, term) => total + (words.has(term) ? 1 : 0), 0);
  if (toolScore || skillScore) return toolScore > skillScore ? rule("tools") : rule("skills");
  return rule("other");
}

export function expectationProfile(values) {
  const rows = EXPECTATION_RULES.map(rule => ({ ...rule, count: 0, share: 0 }));
  values.forEach(value => {
    const category = classifyExpectation(value);
    rows.find(row => row.key === category.key).count += 1;
  });
  const total = values.length;
  rows.forEach(row => { row.share = total ? row.count / total * 100 : 0; });
  return rows;
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

function scoreResponse(response, questions) {
  if (!response || !questions.length) return null;
  const answered = questions.filter(question => String(response.answers?.[question.id] || "").trim());
  if (!answered.length) return null;
  const correct = answered.filter(question => response.answers?.[question.id] === question.correct_answer).length;
  return correct / answered.length * 100;
}

function forecastLearning(entrance, exit, change) {
  if (exit.mean === null || change.mean === null) return { value: null, lower: null, upper: null, confidence: "sin datos" };
  const value = Math.max(0, Math.min(100, exit.mean + change.mean * 0.5));
  const margin = change.n > 1 ? 1.96 * (change.sd || 0) / Math.sqrt(change.n) : 0;
  const lower = Math.max(0, value - margin);
  const upper = Math.min(100, value + margin);
  const confidence = change.n >= 30 && margin <= 8 ? "alta" : change.n >= 15 && margin <= 15 ? "media" : "baja";
  return { value, lower, upper, confidence };
}

function learningSummary(questions, entrances, exits, comparisons) {
  const pairedIds = [...entrances.keys()].filter(id => exits.has(id));
  const entranceScores = [];
  const exitScores = [];
  const changes = [];
  pairedIds.forEach(id => {
    const before = scoreResponse(entrances.get(id), questions);
    const after = scoreResponse(exits.get(id), questions);
    if (before === null || after === null) return;
    entranceScores.push(before);
    exitScores.push(after);
    changes.push(after - before);
  });
  const entrance = describe(entranceScores);
  const exit = describe(exitScores);
  const change = describe(changes);
  const bestQuestion = comparisons.length ? [...comparisons].sort((a, b) => b.change - a.change || b.exit.share - a.exit.share)[0] : null;
  const weakestQuestion = comparisons.length ? [...comparisons].sort((a, b) => a.exit.share - b.exit.share || a.change - b.change)[0] : null;
  return {
    entrance, exit, change,
    forecast: forecastLearning(entrance, exit, change),
    bestQuestion,
    weakestQuestion,
    entranceScores,
    exitScores,
    changes
  };
}

function overallLearning(encounters) {
  const entranceScores = encounters.flatMap(encounter => encounter.learning.entranceScores);
  const exitScores = encounters.flatMap(encounter => encounter.learning.exitScores);
  const changes = encounters.flatMap(encounter => encounter.learning.changes);
  const entrance = describe(entranceScores);
  const exit = describe(exitScores);
  const change = describe(changes);
  const eligible = encounters.filter(encounter => encounter.learning.change.mean !== null);
  const bestUnit = eligible.length ? [...eligible].sort((a, b) => b.learning.change.mean - a.learning.change.mean)[0] : null;
  const weakestUnit = eligible.length ? [...eligible].sort((a, b) => a.learning.exit.mean - b.learning.exit.mean)[0] : null;
  return { entrance, exit, change, forecast: forecastLearning(entrance, exit, change), bestUnit, weakestUnit };
}

function expectationAnalysis(participants, responses) {
  const entranceByParticipant = new Map(responses
    .filter(row => Number(row.encounter_number) === 1 && row.phase === "entrance")
    .map(row => [row.participant_id, row]));
  const entrances = participants.map(participant => ({
    participant_id: participant.id,
    expectation_text: entranceByParticipant.get(participant.id)?.expectation_text || ""
  }));
  const finalExits = responses.filter(row => row.phase === "exit" && row.expectation_fulfillment);
  const exitsByParticipant = new Map(finalExits.map(row => [row.participant_id, row]));
  return EXPECTATION_RULES.map(rule => {
    const categoryRows = entrances.filter(row => classifyExpectation(row.expectation_text).key === rule.key);
    const counts = Object.fromEntries(EXPECTATION_FULFILLMENT.map(label => [label, 0]));
    categoryRows.forEach(row => {
      const fulfillment = exitsByParticipant.get(row.participant_id)?.expectation_fulfillment;
      if (counts[fulfillment] !== undefined) counts[fulfillment] += 1;
    });
    return { key: rule.key, label: rule.label, count: categoryRows.length, share: entrances.length ? categoryRows.length / entrances.length * 100 : 0, counts };
  });
}

export function buildReportData(course, data) {
  const participants = data.participants || [];
  const responses = data.responses || [];
  const encounters = (course.encounters || []).map(encounter => {
    const entrances = responseMap(responses, encounter.number, "entrance");
    const exits = responseMap(responses, encounter.number, "exit");
    const paired = [...entrances.keys()].filter(id => exits.has(id)).length;
    const activeQuestions = (encounter.questions || []).filter(question => question.enabled !== false);
    const questions = activeQuestions.map(question => compareQuestion(question, entrances, exits));
    return {
      ...encounter,
      entranceCount: entrances.size,
      exitCount: exits.size,
      paired,
      completionRate: entrances.size ? paired / entrances.size * 100 : 0,
      questions,
      learning: learningSummary(activeQuestions, entrances, exits, questions),
      usefulness: describe([...exits.values()].map(row => row.course_usefulness)),
      unitExpectations: [...entrances.values()].map(row => row.unit_expectation_text).filter(Boolean),
      unitExpectationProfile: expectationProfile([...entrances.values()].map(row => row.unit_expectation_text || "")),
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
    expectations: expectationAnalysis(participants, responses),
    overallLearning: overallLearning(encounters),
    trainerFeedback: {
      strengths: finalExits.map(row => row.instructor_strength).filter(Boolean),
      improvements: finalExits.map(row => row.improvement_suggestion).filter(Boolean)
    }
  };
}
