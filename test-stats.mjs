import assert from "node:assert/strict";
import { buildReportData, classifyExpectation, describe, distribution } from "./stats.js";
import { buildCsvData } from "./exports.js";

assert.deepEqual(describe([1, 2, 3, 4, 5]), { n: 5, mean: 3, median: 3, min: 1, max: 5, sd: Math.sqrt(2), range: 4 });
assert.equal(distribution(["A", "A", "B"])[0].count, 2);
assert.equal(classifyExpectation("Quiero adquirir nuevas habilidades").key, "skills");
assert.equal(classifyExpectation("Necesito obtener nuevas herramientas").key, "tools");
assert.equal(classifyExpectation("Quiero practicar y aplicar lo aprendido").key, "practice");
assert.equal(classifyExpectation("Necesito refrescar y actualizar conocimientos anteriores").key, "refresh");
assert.equal(classifyExpectation("No tengo expectativas").key, "none");
assert.equal(classifyExpectation("").key, "none");
assert.equal(classifyExpectation("Quiero compartir experiencias con colegas").key, "other");

const q1 = { id: "e1q1", question: "Pregunta unidad", options: ["A", "B"], correct_answer: "A" };
const integrative = { id: "integrative", question: "Pregunta integradora", options: ["A", "B"], correct_answer: "A" };
const course = {
  name: "Curso", instructor: "Docente", modality: "Presencial", hours: 3,
  start_date: "2026-01-01", end_date: "2026-01-03",
  encounters: [
    { number: 1, title: "Inicio", questions: [q1] },
    { number: 2, title: "Cierre", questions: [{ ...q1, id: "e2q1" }] }
  ],
  integrative_question: integrative
};
const participants = [
  { id: "p1", full_name: "Ana Uno", email: "ana@example.com", dni: "12345678", institution: "Escuela A", work_area: "Aula", registered_at: "2026-01-01T10:00:00Z" },
  { id: "p2", full_name: "Beto Dos", email: "beto@example.com", dni: "23456789", institution: "Escuela B", work_area: "Gestión", registered_at: "2026-01-01T10:01:00Z" }
];
const responses = [
  { participant_id: "p1", encounter_number: 1, phase: "entrance", answers: { e1q1: "B", integrative: "B" }, expectation_text: "Obtener nuevas herramientas", responded_at: "2026-01-01T10:05:00Z" },
  { participant_id: "p1", encounter_number: 1, phase: "exit", answers: { e1q1: "A" }, unit_satisfaction: 4, course_usefulness: 5, responded_at: "2026-01-01T12:00:00Z" },
  { participant_id: "p1", encounter_number: 2, phase: "entrance", answers: { e2q1: "B" }, unit_expectation_text: "Aplicar estrategias en el aula", responded_at: "2026-01-02T10:00:00Z" },
  { participant_id: "p1", encounter_number: 2, phase: "exit", answers: { e2q1: "A", integrative: "A" }, expectation_fulfillment: "Totalmente", unit_satisfaction: 5, instructor_strength: "Explicaciones muy claras", improvement_suggestion: "Agregar más casos prácticos", responded_at: "2026-01-02T12:00:00Z" },
  { participant_id: "p2", encounter_number: 1, phase: "entrance", answers: { e1q1: "A", integrative: "A" }, expectation_text: "Compartir experiencias", responded_at: "2026-01-01T10:06:00Z" }
];

const report = buildReportData(course, { participants, responses });
assert.equal(report.encounters[0].questions[0].entrance.share, 50);
assert.equal(report.encounters[0].questions[0].exit.share, 100);
assert.equal(report.encounters[0].questions[0].improved, 1);
assert.equal(report.integrative.entrance.share, 50);
assert.equal(report.integrative.exit.share, 100);
assert.equal(report.integrative.improved, 1);
assert.equal(report.fullyCompleted, 1);
assert.equal(report.expectations.find(row => row.key === "tools").counts.Totalmente, 1);
assert.equal(report.expectations.find(row => row.key === "other").count, 1);
assert.equal(report.encounters[0].learning.entrance.mean, 0);
assert.equal(report.encounters[0].learning.exit.mean, 100);
assert.equal(report.encounters[0].learning.change.mean, 100);
assert.equal(report.encounters[0].learning.forecast.value, 100);
assert.equal(report.encounters[1].unitExpectationProfile.find(row => row.key === "practice").count, 1);
assert.equal(report.overallLearning.entrance.mean, 0);
assert.equal(report.overallLearning.exit.mean, 100);
assert.equal(report.overallLearning.change.mean, 100);
assert.equal(report.encounters[1].satisfaction.mean, 5);
assert.equal(report.encounters[1].unitExpectations[0], "Aplicar estrategias en el aula");
assert.equal(report.trainerFeedback.improvements[0], "Agregar más casos prácticos");

const hiddenReport = buildReportData({
  ...course,
  encounters: course.encounters.map(encounter => ({
    ...encounter,
    questions: encounter.questions.map(question => ({ ...question, enabled: false }))
  })),
  integrative_question: { ...integrative, enabled: false }
}, { participants, responses });
assert.equal(hiddenReport.encounters[0].questions.length, 0);
assert.equal(hiddenReport.encounters[0].learning.change.n, 0);
assert.equal(hiddenReport.encounters[0].learning.forecast.value, null);
assert.equal(hiddenReport.integrative, null);

const csv = buildCsvData(course, { participants, responses });
assert.equal(csv.rows.length, 2);
assert.ok(csv.headers.includes("nombre_y_apellido"));
assert.ok(csv.headers.includes("pregunta_integradora_entrada_1"));
assert.ok(csv.headers.includes("pregunta_integradora_salida_2"));
assert.ok(csv.headers.includes("fortalezas_capacitador"));
assert.ok(csv.headers.includes("encuentro_2_entrada_expectativa_unidad"));
assert.ok(csv.rows.every(row => row.length === csv.headers.length));

console.log("Pruebas estadísticas correctas");
