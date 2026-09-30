import { DataClient, DEFAULT_COURSE } from "./data.js?v=20260930-5";
import { buildReportData } from "./stats.js?v=20260930-4";
import { buildCsvData, downloadCsv } from "./exports.js?v=20260930-4";

const client = new DataClient();
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}

function dateOnly(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

function percent(value) {
  return `${Number(value || 0).toLocaleString("es-AR", { maximumFractionDigits: 1 })} %`;
}

function activeEncounter(course) {
  return course?.encounters?.find(item => Number(item.number) === Number(course.active_encounter));
}

function courseHeader(course) {
  const encounter = activeEncounter(course);
  const open = course.status === "open";
  return `<div class="course-card__top"><div><span class="eyebrow">ERYLA METYLA · ${escapeHtml(encounter?.title || `Encuentro ${course.active_encounter}`)}</span><h2>${escapeHtml(course.name)}</h2><div>Profesor/a: <strong>${escapeHtml(course.instructor)}</strong></div></div><span class="status-badge${open ? "" : " status-badge--closed"}">${open ? "Abierto" : "Cerrado"}</span></div><div class="course-meta"><span>${dateOnly(course.start_date)} — ${dateOnly(course.end_date)}</span><span>${escapeHtml(course.modality)} · ${escapeHtml(course.hours)} horas</span></div>`;
}

function setMessage(element, text, type = "error") {
  element.textContent = text || "";
  element.className = `form-message${type === "success" ? " form-message--success" : type === "info" ? " form-message--info" : ""}`;
}

function unavailable(message) {
  const panel = $("[data-unavailable-panel]");
  const formPanel = $("[data-form-panel]");
  if (formPanel) formPanel.hidden = true;
  panel.hidden = false;
  panel.innerHTML = `<img class="brand-logo brand-logo--notice" src="assets/brand/ERYLA_METYLA_Logo_Horizontal.svg" alt="ERYLA METYLA Aprendizaje"><h1>Ticket no disponible</h1><p>${escapeHtml(message)}</p>`;
}

function questionHtml(question, index, integrative = false) {
  const options = (question.options || []).map(option => `<label><input type="radio" name="answer_${escapeHtml(question.id)}" value="${escapeHtml(option)}" required><span>${escapeHtml(option)}</span></label>`).join("");
  return `<fieldset class="field technical-question"><legend><span>${integrative ? "Pregunta integradora" : `Pregunta ${index + 1}`}</span>${escapeHtml(question.question)}</legend><div class="radio-list">${options}</div></fieldset>`;
}

async function initHome() {
  const status = $("[data-home-status]");
  try {
    const course = await client.getActiveTicket();
    if (!course) throw new Error("Todavía no hay un curso configurado.");
    const encounter = activeEncounter(course);
    const open = course.status === "open";
    status.textContent = open ? `${course.name} · ${encounter?.title || `Encuentro ${course.active_encounter}`} · Está habilitada la ${course.active_phase === "entrance" ? "Entrada" : "Salida"}.` : `${course.name} · El curso está cerrado.`;
    $$('[data-ticket-link]').forEach(link => {
      const active = open && link.dataset.ticketLink === course.active_phase;
      link.classList.toggle("choice-card--disabled", !active);
      link.setAttribute("aria-disabled", String(!active));
      if (!active) link.addEventListener("click", event => event.preventDefault());
    });
    $$('[data-ticket-description]').forEach(text => {
      const phase = text.dataset.ticketDescription;
      text.textContent = phase === course.active_phase && open ? `${encounter?.title || `Encuentro ${course.active_encounter}`} · Disponible ahora.` : "No está habilitado en este momento.";
    });
  } catch (error) {
    status.textContent = error.message;
    $$('[data-ticket-link]').forEach(link => { link.classList.add("choice-card--disabled"); link.addEventListener("click", event => event.preventDefault()); });
  }
}

async function initTicket(phase) {
  try {
    const course = await client.getActiveTicket();
    if (!course) return unavailable("Todavía no hay un curso configurado.");
    $("[data-course-header]").innerHTML = courseHeader(course);
    if (course.status !== "open") return unavailable("El curso está cerrado y no recibe nuevas respuestas.");
    if (course.active_phase !== phase) return unavailable(`Ahora está habilitado el ticket de ${course.active_phase === "entrance" ? "entrada" : "salida"} del Encuentro ${course.active_encounter}.`);
    const encounter = activeEncounter(course);
    if (!encounter) return unavailable("La configuración del encuentro no es válida.");
    const firstEntrance = phase === "entrance" && Number(course.active_encounter) === 1;
    const unitEntrance = phase === "entrance" && Number(course.active_encounter) > 1;
    const finalExit = phase === "exit" && Number(course.active_encounter) === Number(course.encounter_count);
    const questions = (encounter.questions || []).filter(question => question.enabled !== false);
    if ((firstEntrance || finalExit) && course.integrative_question?.enabled !== false) questions.push(course.integrative_question);

    $("[data-ticket-kicker]").textContent = `${encounter.title} · ${phase === "entrance" ? "Antes de comenzar" : "Al finalizar"}`;
    $("[data-ticket-title]").textContent = `Ticket ${course.active_encounter} · ${phase === "entrance" ? "Entrada" : "Salida"}`;
    $("[data-questions]").innerHTML = questions.map((question, index) => questionHtml(question, index, question.id === course.integrative_question.id)).join("");
    const profile = $("[data-profile-fields]");
    if (profile) {
      profile.hidden = !firstEntrance;
      $("[data-dni-only]").hidden = firstEntrance;
      $$('input', profile).forEach(input => { input.required = firstEntrance; });
      $("[name=dni_repeat]").required = !firstEntrance;
      $("[data-expectation]").hidden = !firstEntrance;
      $("[name=expectation_text]").required = firstEntrance;
      $("[data-unit-expectation]").hidden = !unitEntrance;
      $("[name=unit_expectation_text]").required = unitEntrance;
    }
    const finalFields = $("[data-final-fields]");
    if (finalFields) {
      finalFields.hidden = !finalExit;
      $$('input, textarea', finalFields).forEach(input => { input.required = finalExit; });
    }
    $("[data-form-panel]").hidden = false;

    $("#ticket-form").addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const message = $("[data-form-message]");
      if (!form.reportValidity()) return;
      const values = new FormData(form);
      const answers = Object.fromEntries(questions.map(question => [question.id, values.get(`answer_${question.id}`)]));
      const button = $('button[type=submit]', form);
      button.disabled = true;
      setMessage(message, "Guardando…", "info");
      try {
        const result = await client.submitTicket({
          course_id: course.id,
          email: firstEntrance ? values.get("email") : null,
          full_name: values.get("full_name"), dni: firstEntrance ? values.get("dni") : values.get("dni_repeat"),
          institution: values.get("institution"), work_area: values.get("work_area"),
          expectation_text: values.get("expectation_text"),
          expectation_fulfillment: values.get("expectation_fulfillment"),
          unit_expectation_text: values.get("unit_expectation_text"),
          unit_satisfaction: values.get("unit_satisfaction"),
          instructor_strength: values.get("instructor_strength"),
          improvement_suggestion: values.get("improvement_suggestion"),
          course_usefulness: values.get("course_usefulness"), answers
        });
        form.reset();
        if (result?.group_number) {
          form.hidden = true;
          const success = $("[data-success-panel]");
          success.hidden = false;
          success.innerHTML = `<span class="eyebrow">Sorteo completado</span><h2>Pertenecés al grupo ${escapeHtml(result.group_number)}</h2><p>Anotalo para la actividad de este encuentro.</p><div class="group-result__number" aria-label="Grupo ${escapeHtml(result.group_number)}">${escapeHtml(result.group_number)}</div>`;
        } else {
          setMessage(message, "Respuesta guardada correctamente. Gracias por participar.", "success");
          button.hidden = true;
        }
      } catch (error) {
        setMessage(message, error.message);
        button.disabled = false;
      }
    });
  } catch (error) {
    unavailable(`No pudimos cargar el ticket. ${error.message}`);
  }
}

function editorQuestion(question, id, label) {
  const options = (question.options || []).join("\n");
  const optionTags = (question.options || []).map(option => `<option${option === question.correct_answer ? " selected" : ""}>${escapeHtml(option)}</option>`).join("");
  const enabled = question.enabled !== false;
  return `<div class="question-editor-card${enabled ? "" : " question-editor-card--disabled"}" data-editor-question data-question-id="${escapeHtml(id)}"><div class="question-editor-card__header"><strong>${escapeHtml(label)}</strong><label class="question-toggle"><input type="checkbox" data-question-enabled${enabled ? " checked" : ""}><span>${enabled ? "Visible" : "Oculta"}</span></label></div><div class="field"><label>Enunciado</label><input data-question-text maxlength="240" required value="${escapeHtml(question.question)}"></div><div class="field"><label>Opciones de respuesta</label><textarea data-question-options rows="4" required>${escapeHtml(options)}</textarea><small>Una opción por línea.</small></div><div class="field"><label>Respuesta correcta</label><select data-correct-answer required>${optionTags}</select></div></div>`;
}

function blankQuestion(id, label) {
  return { id, enabled: true, question: label, options: ["Opción A", "Opción B", "Opción C"], correct_answer: "Opción A" };
}

function normalizeQuestion(question, id, label) {
  const fallback = blankQuestion(id, label);
  return { ...fallback, ...(question || {}), id, enabled: question?.enabled !== false };
}

function normalizeGrouping(value = {}) {
  const normalizePhase = phase => ({
    enabled: Boolean(value?.[phase]?.enabled),
    expected_participants: Math.max(1, Math.min(5000, Number(value?.[phase]?.expected_participants) || 30)),
    group_count: Math.max(2, Math.min(100, Number(value?.[phase]?.group_count) || 5))
  });
  return { entrance: normalizePhase("entrance"), exit: normalizePhase("exit") };
}

function normalizeEncounters(encounters, count) {
  return Array.from({ length: count }, (_, offset) => {
    const number = offset + 1;
    const previous = encounters.find(item => Number(item.number) === number);
    return {
      number,
      title: previous?.title || `Encuentro ${number}`,
      grouping: normalizeGrouping(previous?.grouping),
      questions: Array.from({ length: 3 }, (__, questionOffset) => normalizeQuestion(previous?.questions?.[questionOffset], `e${number}q${questionOffset + 1}`, `Pregunta ${questionOffset + 1} de la unidad ${number}`))
    };
  });
}

function groupingEditor(encounter) {
  const grouping = normalizeGrouping(encounter.grouping);
  const phaseEditor = (phase, label) => {
    const values = grouping[phase];
    return `<section class="grouping-editor" data-grouping-phase="${phase}"><div class="grouping-editor__header"><strong>${label}</strong><label class="switch-field"><input type="checkbox" data-group-enabled${values.enabled ? " checked" : ""}><span>Sortear grupos</span></label></div><div class="form-grid grouping-editor__fields"><div class="field"><label>Participantes esperados</label><input type="number" data-expected-participants min="1" max="5000" value="${values.expected_participants}" required></div><div class="field"><label>Cantidad de grupos</label><input type="number" data-group-count min="2" max="100" value="${values.group_count}" required></div></div></section>`;
  };
  return `<div class="grouping-editor-wrap"><span class="section-kicker">Organización de grupos</span><p class="muted">Configurá el sorteo por separado para cada momento.</p>${phaseEditor("entrance", "Entrada")}${phaseEditor("exit", "Salida")}</div>`;
}

function renderEditors(encounters, integrative) {
  $("[data-encounter-editor]").innerHTML = encounters.map(encounter => `<details class="encounter-card" data-encounter-card data-number="${encounter.number}"${encounter.number === 1 ? " open" : ""}><summary><strong>Ticket ${encounter.number}</strong><span>${escapeHtml(encounter.title)}</span></summary><div class="encounter-card__body"><div class="field"><label>Nombre del encuentro</label><input data-encounter-title required maxlength="120" value="${escapeHtml(encounter.title)}"></div>${groupingEditor(encounter)}${encounter.questions.map((question, index) => editorQuestion(question, `e${encounter.number}q${index + 1}`, `Pregunta ${index + 1}`)).join("")}</div></details>`).join("");
  $("[data-integrative-editor]").innerHTML = editorQuestion(normalizeQuestion(integrative, "integrative", "Pregunta integradora del curso"), "integrative", "Pregunta integradora");
}

function collectQuestion(card, forcedId) {
  const options = $("[data-question-options]", card).value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  const correct = $("[data-correct-answer]", card).value;
  if (options.length < 2) throw new Error("Cada pregunta necesita al menos dos opciones.");
  if (!options.includes(correct)) throw new Error("Seleccioná una respuesta correcta válida.");
  return { id: forcedId, enabled: $("[data-question-enabled]", card).checked, question: $("[data-question-text]", card).value.trim(), options, correct_answer: correct };
}

function collectEncounters() {
  return $$('[data-encounter-card]').map(card => {
    const number = Number(card.dataset.number);
    const grouping = {};
    $$('[data-grouping-phase]', card).forEach(section => {
      const phase = section.dataset.groupingPhase;
      const expected = Number($("[data-expected-participants]", section).value);
      const groupCount = Number($("[data-group-count]", section).value);
      const enabled = $("[data-group-enabled]", section).checked;
      if (enabled && groupCount > expected) throw new Error(`En el Ticket ${number} ${phase === "entrance" ? "Entrada" : "Salida"}, la cantidad de grupos no puede superar a los participantes esperados.`);
      grouping[phase] = { enabled, expected_participants: expected, group_count: groupCount };
    });
    return { number, title: $("[data-encounter-title]", card).value.trim(), grouping, questions: $$('[data-editor-question]', card).map((questionCard, index) => collectQuestion(questionCard, `e${number}q${index + 1}`)) };
  });
}

function syncCorrectSelect(textarea) {
  const card = textarea.closest("[data-editor-question]");
  const select = $("[data-correct-answer]", card);
  const current = select.value;
  const options = textarea.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  select.innerHTML = options.map(option => `<option${option === current ? " selected" : ""}>${escapeHtml(option)}</option>`).join("");
}

function fillCourseForm(course) {
  const form = $("#course-form");
  ["id", "name", "instructor", "hours", "modality", "start_date", "end_date"].forEach(key => { form.elements[key].value = course[key] ?? ""; });
  form.elements.encounter_count.value = course.encounters.length;
  renderEditors(course.encounters, course.integrative_question);
}

function renderActivation(course) {
  const select = $("#active-encounter");
  select.innerHTML = course.encounters.map(item => `<option value="${item.number}"${Number(item.number) === Number(course.active_encounter) ? " selected" : ""}>${escapeHtml(item.title)}</option>`).join("");
  const phase = $(`[name=active_phase][value=${course.active_phase}]`);
  if (phase) phase.checked = true;
}

function renderReportScopes(course) {
  const select = $("#report-scope");
  if (!select) return;
  select.innerHTML = `<option value="general">General · Curso completo</option>${course.encounters.map(encounter => {
    const label = `Ticket ${encounter.number} · ${escapeHtml(encounter.title)}`;
    return `<option value="ticket:${encounter.number}:both">${label} · Entrada y Salida</option><option value="ticket:${encounter.number}:entrance">${label} · Solo Entrada</option><option value="ticket:${encounter.number}:exit">${label} · Solo Salida</option>`;
  }).join("")}`;
}

function renderGroupingStatus(course, courseData = { responses: [] }) {
  const target = $("[data-grouping-status]");
  if (!target || !course) return;
  const encounterNumber = Number($("#active-encounter").value || course.active_encounter);
  const phase = $("[name=active_phase]:checked")?.value || course.active_phase;
  const encounter = course.encounters.find(item => Number(item.number) === encounterNumber);
  const grouping = normalizeGrouping(encounter?.grouping)[phase];
  const responses = (courseData.responses || []).filter(row => Number(row.encounter_number) === encounterNumber && row.phase === phase);
  const counts = Array.from({ length: grouping.group_count }, (_, index) => responses.filter(row => Number(row.group_number) === index + 1).length);
  $("#activate-ticket-button").textContent = grouping.enabled ? "Habilitar ticket y sorteo" : "Habilitar este ticket";
  if (!grouping.enabled) {
    target.innerHTML = `<strong>Sin sorteo para este ticket</strong><span>Podés activarlo en la configuración del encuentro.</span>`;
    return;
  }
  const estimatedBase = Math.floor(grouping.expected_participants / grouping.group_count);
  const remainder = grouping.expected_participants % grouping.group_count;
  const estimate = remainder ? `${grouping.group_count - remainder} grupos de ${estimatedBase} y ${remainder} de ${estimatedBase + 1}` : `${grouping.group_count} grupos de ${estimatedBase}`;
  target.innerHTML = `<strong>${responses.length} de ${grouping.expected_participants} respuestas</strong><span>${grouping.group_count} grupos · estimación: ${escapeHtml(estimate)}.</span>${responses.length ? `<div class="group-chip-row">${counts.map((count, index) => `<span>Grupo ${index + 1}: ${count}</span>`).join("")}</div>` : ""}`;
}

function updateStatus(course) {
  const badge = $("[data-course-status]");
  const open = course?.status === "open";
  badge.textContent = course ? (open ? `Abierto · Ticket ${course.active_encounter} ${course.active_phase === "entrance" ? "Entrada" : "Salida"}` : "Curso cerrado") : "Sin configurar";
  badge.className = `status-badge${open ? "" : " status-badge--closed"}`;
  $("#toggle-course-button").textContent = course && !open ? "Reabrir curso" : "Cerrar curso";
  $("#toggle-course-button").disabled = !course;
  $("#activate-ticket-button").disabled = !course;
}

function reportTableQuestion(question) {
  return `<tr><td>${escapeHtml(question.question)}</td><td>${question.entrance.correct}/${question.entrance.n}<br><span class="muted">${percent(question.entrance.share)}</span></td><td>${question.exit.correct}/${question.exit.n}<br><span class="muted">${percent(question.exit.share)}</span></td><td>${question.change >= 0 ? "+" : ""}${percent(question.change)}</td><td>${question.improved} / ${question.unchanged} / ${question.worsened}</td></tr>`;
}

function phaseReportTable(encounter, phase) {
  const phaseLabel = phase === "entrance" ? "Entrada" : "Salida";
  if (!encounter.questions.length) return `<p class="muted">No hay preguntas técnicas activas en esta etapa.</p>`;
  return `<table class="report-table"><thead><tr><th>Pregunta</th><th>Correctas</th><th>Porcentaje</th></tr></thead><tbody>${encounter.questions.map(question => {
    const result = question[phase];
    return `<tr><td>${escapeHtml(question.question)}</td><td>${result.correct}/${result.n}</td><td>${percent(result.share)}</td></tr>`;
  }).join("")}</tbody></table><p class="report-meta">Resultados correspondientes únicamente a ${phaseLabel}.</p>`;
}

function barList(rows) {
  if (!rows.length) return `<p class="muted">Sin datos todavía.</p>`;
  return `<div class="bar-list">${rows.map(row => `<div class="bar-row"><span>${escapeHtml(row.label)}</span><div class="bar-track"><span style="width:${Math.min(row.share, 100)}%"></span></div><strong>${row.count}</strong></div>`).join("")}</div>`;
}

function countedResponseList(rows) {
  return barList(rows.length ? [...new Map(rows.map(value => [value, 0])).keys()].map(label => {
    const count = rows.filter(value => value === label).length;
    return { label, count, share: count / rows.length * 100 };
  }).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "es")) : []);
}

function scoreText(value, signed = false) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  const number = Number(value);
  const prefix = signed && number > 0 ? "+" : "";
  return `${prefix}${number.toLocaleString("es-AR", { maximumFractionDigits: 1 })} %`;
}

function learningAnalysisHtml(learning) {
  if (!learning || learning.change.n === 0) return `<p class="muted">Todavía no hay pares completos de Entrada y Salida para calcular la mejora.</p>`;
  const forecast = learning.forecast.value === null ? "—" : `${scoreText(learning.forecast.value)} (${scoreText(learning.forecast.lower)} a ${scoreText(learning.forecast.upper)})`;
  const highlights = learning.bestQuestion && learning.weakestQuestion
    ? `<p class="report-meta"><strong>Mayor avance:</strong> ${escapeHtml(learning.bestQuestion.question)} (${scoreText(learning.bestQuestion.change, true)}).<br><strong>Resultado que requiere más refuerzo:</strong> ${escapeHtml(learning.weakestQuestion.question)} (${scoreText(learning.weakestQuestion.exit.share)} de respuestas correctas en la salida).</p>`
    : "";
  return `<div class="report-cards report-cards--learning"><div class="report-card"><strong>${scoreText(learning.entrance.mean)}</strong><span>Media de entrada</span></div><div class="report-card"><strong>${scoreText(learning.exit.mean)}</strong><span>Media de salida</span></div><div class="report-card"><strong>${scoreText(learning.change.mean, true)}</strong><span>Mejora media</span></div><div class="report-card"><strong>${scoreText(learning.forecast.value)}</strong><span>Proyección orientativa</span></div></div><p class="report-meta">Casos comparables: ${learning.change.n} · Mediana de mejora: ${scoreText(learning.change.median, true)} · Mejor resultado final: ${scoreText(learning.exit.max)} · Menor resultado final: ${scoreText(learning.exit.min)} · Mejor variación individual: ${scoreText(learning.change.max, true)} · Peor variación individual: ${scoreText(learning.change.min, true)} · Desvío: ${scoreText(learning.change.sd)}</p>${highlights}<p class="report-note"><strong>Predicción del aprendizaje:</strong> ${forecast}. Confianza ${learning.forecast.confidence}. Se proyecta medio paso adicional de la mejora observada; es una tendencia orientativa y debe confirmarse con una nueva medición.</p>`;
}

function overallLearningHtml(report) {
  const learning = report.overallLearning;
  const unitHighlights = learning.bestUnit && learning.weakestUnit
    ? `<p class="report-meta"><strong>Unidad con mayor mejora media:</strong> Unidad ${learning.bestUnit.number} · ${escapeHtml(learning.bestUnit.title)} (${scoreText(learning.bestUnit.learning.change.mean, true)}).<br><strong>Unidad con menor resultado final:</strong> Unidad ${learning.weakestUnit.number} · ${escapeHtml(learning.weakestUnit.title)} (${scoreText(learning.weakestUnit.learning.exit.mean)}).</p>`
    : "";
  return `<section class="report-overall"><h2>Mejora general del grupo</h2>${learningAnalysisHtml(learning)}${unitHighlights}</section>`;
}

function reportUnitSection(encounter, report) {
  const profile = encounter.number === 1 ? report.expectations : encounter.unitExpectationProfile;
  const profileTitle = encounter.number === 1 ? "Perfil de expectativas del curso" : "Perfil de expectativas de la unidad";
  const questions = encounter.questions.length
    ? `<table class="report-table"><thead><tr><th>Pregunta</th><th>Entrada</th><th>Salida</th><th>Cambio</th><th>Mejoró / Igual / Bajó</th></tr></thead><tbody>${encounter.questions.map(reportTableQuestion).join("")}</tbody></table>`
    : `<p class="muted">No hay preguntas técnicas activas en esta unidad.</p>`;
  const satisfaction = encounter.satisfaction.mean === null ? "—" : `${encounter.satisfaction.mean.toLocaleString("es-AR", { maximumFractionDigits: 2 })} / 5`;
  const usefulness = encounter.usefulness.mean === null ? "—" : `${encounter.usefulness.mean.toLocaleString("es-AR", { maximumFractionDigits: 2 })} / 5`;
  return `<section class="report-section report-page report-unit"><span class="section-kicker">Unidad ${encounter.number}</span><h2>Unidad ${encounter.number} · ${escapeHtml(encounter.title)}</h2><p class="report-meta">Entradas: ${encounter.entranceCount} · Salidas: ${encounter.exitCount} · Vinculadas: ${encounter.paired} · Seguimiento: ${percent(encounter.completionRate)}</p><h3>Análisis estadístico de mejora</h3>${learningAnalysisHtml(encounter.learning)}<h3>Resultado por pregunta</h3>${questions}<div class="report-two-columns"><section><h3>${profileTitle}</h3>${barList(profile)}</section><section><h3>Satisfacción y utilidad</h3><p class="report-meta">Satisfacción media: ${satisfaction}<br>Utilidad media: ${usefulness}</p>${barList(encounter.satisfactionDistribution)}</section></div></section>`;
}

function baseReportHtml(report) {
  const expectationRows = report.expectations.filter(row => row.count).map(row => `<tr><td>${escapeHtml(row.label)}</td><td>${row.count}</td><td>${row.counts.Totalmente}</td><td>${row.counts.Parcialmente}</td><td>${row.counts["No cumplió"]}</td></tr>`).join("");
  const integrativeSection = report.integrative ? `<section class="report-section report-page report-integrative"><span class="section-kicker">Evaluación global</span><h2>Pregunta integradora: inicio vs. cierre</h2><p class="report-note">Esta sección es independiente de las unidades. Compara la Entrada del Ticket 1 con la Salida del Ticket ${report.course.encounters.length}, únicamente en participantes vinculados.</p><table class="report-table"><thead><tr><th>Pregunta</th><th>Entrada 1</th><th>Salida ${report.course.encounters.length}</th><th>Cambio</th><th>Mejoró / Igual / Bajó</th></tr></thead><tbody>${reportTableQuestion(report.integrative)}</tbody></table></section>` : "";
  const encounterSections = report.encounters.map(encounter => reportUnitSection(encounter, report)).join("");
  return `<article class="report-paper"><header class="report-cover"><span class="eyebrow">ERYLA METYLA · Informe general de capacitación</span><h1>${escapeHtml(report.course.name)}</h1><div class="report-meta">Profesor/a: ${escapeHtml(report.course.instructor)} · ${escapeHtml(report.course.modality)} · ${escapeHtml(report.course.hours)} horas<br>Período: ${dateOnly(report.course.start_date)} — ${dateOnly(report.course.end_date)} · Generado: ${new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(new Date())}</div><div class="report-cards"><div class="report-card"><strong>${report.participants.length}</strong><span>Participantes</span></div><div class="report-card"><strong>${report.responses.length}</strong><span>Tickets respondidos</span></div><div class="report-card"><strong>${report.fullyCompleted}</strong><span>Recorridos completos</span></div><div class="report-card"><strong>${report.course.encounters.length}</strong><span>Unidades</span></div></div><p class="report-note">El informe presenta cada unidad por separado y reserva una sección independiente para la pregunta integradora.</p>${overallLearningHtml(report)}</header>${encounterSections}${integrativeSection}<section class="report-section report-page"><h2>Perfil institucional</h2><h3>Instituciones</h3>${barList(report.institutions)}<h3>Áreas de trabajo</h3>${barList(report.workAreas)}<h2>Perfil de expectativas y cumplimiento final</h2><p class="report-note">Clasificación automática en seis perfiles según acciones y palabras clave. Las respuestas originales se conservan en la descarga CSV.</p>${expectationRows ? `<table class="report-table"><thead><tr><th>Perfil de respuesta</th><th>Inicial</th><th>Totalmente</th><th>Parcialmente</th><th>No cumplió</th></tr></thead><tbody>${expectationRows}</tbody></table>` : `<p class="muted">Sin respuestas suficientes.</p>`}</section></article>`;
}

function reportHtml(report) {
  const additional = `<section class="report-section report-page"><h2>Mejora del capacitador y del curso</h2><h3>Aspectos que debería mantener</h3>${countedResponseList(report.trainerFeedback.strengths)}<h3>Oportunidades de mejora</h3>${countedResponseList(report.trainerFeedback.improvements)}</section>`;
  return baseReportHtml(report)
    .replace("</article>", `${additional}</article>`);
}

function scopedReportHtml(report, scope) {
  if (!scope || scope === "general") return reportHtml(report);
  const [, numberText, phase = "both"] = scope.split(":");
  const number = Number(numberText);
  const encounter = report.encounters.find(item => Number(item.number) === number);
  if (!encounter) return reportHtml(report);
  const phaseLabel = phase === "entrance" ? "Entrada" : phase === "exit" ? "Salida" : "Entrada y Salida";
  const selectedResponses = report.responses.filter(row => Number(row.encounter_number) === number && (phase === "both" || row.phase === phase));
  const participantCount = new Set(selectedResponses.map(row => row.participant_id)).size;
  const questions = phase === "both"
    ? (encounter.questions.length ? `<table class="report-table"><thead><tr><th>Pregunta</th><th>Entrada</th><th>Salida</th><th>Cambio</th><th>Mejoró / Igual / Bajó</th></tr></thead><tbody>${encounter.questions.map(reportTableQuestion).join("")}</tbody></table>` : `<p class="muted">No hay preguntas técnicas activas en este Ticket.</p>`)
    : phaseReportTable(encounter, phase);
  const entranceDetails = (phase === "entrance" || phase === "both") ? (number === 1
    ? `<h2>Perfil de expectativas del curso</h2>${barList(report.expectations)}`
    : `<h2>Perfil de expectativas de la unidad</h2>${barList(encounter.unitExpectationProfile)}`) : "";
  const exitDetails = (phase === "exit" || phase === "both") ? `<h2>Satisfacción con la unidad</h2><p class="report-meta">Promedio: ${encounter.satisfaction.mean === null ? "—" : `${encounter.satisfaction.mean.toLocaleString("es-AR", { maximumFractionDigits: 2 })} / 5`} · Respuestas: ${encounter.satisfaction.n}</p>${barList(encounter.satisfactionDistribution)}${number === report.course.encounters.length ? `<h2>Mejora del capacitador y del curso</h2><h3>Aspectos que debería mantener</h3>${countedResponseList(report.trainerFeedback.strengths)}<h3>Oportunidades de mejora</h3>${countedResponseList(report.trainerFeedback.improvements)}` : ""}` : "";
  return `<article class="report-paper"><span class="eyebrow">ERYLA METYLA · Informe por Ticket</span><h1>Ticket ${encounter.number} · ${escapeHtml(encounter.title)}</h1><div class="report-meta">${escapeHtml(report.course.name)} · ${phaseLabel}<br>Profesor/a: ${escapeHtml(report.course.instructor)} · Generado: ${new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(new Date())}</div><div class="report-cards"><div class="report-card"><strong>${participantCount}</strong><span>Participantes</span></div><div class="report-card"><strong>${selectedResponses.length}</strong><span>Respuestas</span></div><div class="report-card"><strong>${phase === "exit" ? encounter.exitCount : encounter.entranceCount}</strong><span>${phase === "exit" ? "Salidas" : "Entradas"}</span></div><div class="report-card"><strong>${encounter.paired}</strong><span>Pares Entrada/Salida</span></div></div><h2>Análisis estadístico de mejora</h2>${learningAnalysisHtml(encounter.learning)}<h2>Resultado por pregunta</h2>${questions}${entranceDetails}${exitDetails}</article>`;
}

function selectedReport(report) {
  const scope = $("#report-scope")?.value || "general";
  if (scope === "general") return { html: reportHtml(report), title: report.course.name, filename: `resumen-general-${report.course.name}` };
  const [, number, phase] = scope.split(":");
  const phaseSlug = phase === "both" ? "entrada-salida" : phase === "entrance" ? "entrada" : "salida";
  return { html: scopedReportHtml(report, scope), title: `${report.course.name} · Ticket ${number} · ${phaseSlug}`, filename: `resumen-ticket-${number}-${phaseSlug}-${report.course.name}` };
}

const REPORT_CSS = `@page{size:A4;margin:14mm}:root{font-family:Arial,sans-serif;color:#20252b}body{margin:0;background:#f5f6f7}.report-paper{max-width:900px;margin:24px auto;padding:38px;background:#fff}.eyebrow,.section-kicker{font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}.eyebrow{color:#fe5e01}.section-kicker{color:#6a35d6}h1{font-size:32px;margin:5px 0 8px}h2{font-size:21px;margin:20px 0 12px;padding-top:14px;border-top:1px solid #ded9e8}h3{font-size:15px;margin:22px 0 10px}.report-meta,.muted{color:#626973;font-size:12px;line-height:1.5}.report-cards{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin:22px 0}.report-card{padding:13px;border:1px solid #ded9e8;border-radius:9px}.report-card strong{display:block;font-size:23px}.report-card span{color:#626973;font-size:11px}.report-page{margin-top:34px}.report-two-columns{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:24px}.report-table{width:100%;border-collapse:collapse;font-size:12px}.report-table th,.report-table td{padding:8px 6px;border-bottom:1px solid #ded9e8;text-align:right}.report-table th:first-child,.report-table td:first-child{text-align:left}.report-note{padding:11px 13px;border-left:3px solid #6a35d6;background:#f0eafb;font-size:12px}.bar-list{display:grid;gap:9px}.bar-row{display:grid;grid-template-columns:180px 1fr 50px;align-items:center;gap:9px;font-size:12px}.bar-track{height:8px;overflow:hidden;border-radius:99px;background:#e9e5ef}.bar-track span{display:block;height:100%;background:#6a35d6}@media(max-width:650px){.report-paper{margin:0;padding:20px 14px}.report-cards,.report-two-columns{grid-template-columns:1fr 1fr}.report-table{font-size:10px}.bar-row{grid-template-columns:110px 1fr 35px}}@media print{body{background:#fff}.report-paper{max-width:none;margin:0;padding:0}.report-page{break-before:page;page-break-before:always;margin-top:0}.report-card,.bar-row,tr{break-inside:avoid;page-break-inside:avoid}.report-two-columns{grid-template-columns:1fr 1fr}}`;

function fullReportDocument(content, title) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Informe ${escapeHtml(title)}</title><style>${REPORT_CSS}</style></head><body>${content}</body></html>`;
}

function printReport(content, title, targetWindow = window.open("", "_blank")) {
  if (!targetWindow) throw new Error("El navegador bloqueó la ventana del PDF. Permití las ventanas emergentes e intentá nuevamente.");
  targetWindow.document.write(fullReportDocument(content, title));
  targetWindow.document.close();
  targetWindow.setTimeout(() => {
    targetWindow.focus();
    targetWindow.print();
  }, 200);
}

function confirmAction(title, text, typed = false) {
  const dialog = $("#confirm-dialog");
  $("[data-confirm-title]", dialog).textContent = title;
  $("[data-confirm-text]", dialog).textContent = text;
  const wrap = $("[data-confirm-input-wrap]", dialog);
  const input = $("[data-confirm-input]", dialog);
  wrap.hidden = !typed;
  input.value = "";
  dialog.showModal();
  return new Promise(resolve => dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm" && (!typed || input.value.trim().toUpperCase() === "BORRAR")), { once: true }));
}

async function initAdmin() {
  const loginPanel = $("#login-panel");
  const adminPanel = $("#admin-panel");
  let course = null;
  let courseData = { participants: [], responses: [] };

  async function refreshData() {
    courseData = course?.id ? await client.getCourseData(course.id) : { participants: [], responses: [] };
    const report = course ? buildReportData(course, courseData) : null;
    $("[data-count=participants]").textContent = courseData.participants.length;
    $("[data-count=responses]").textContent = courseData.responses.length;
    $("[data-count=complete]").textContent = report?.fullyCompleted || 0;
    renderGroupingStatus(course, courseData);
    return report;
  }

  async function showAdmin() {
    loginPanel.hidden = true;
    adminPanel.hidden = false;
    $("#logout-button").hidden = client.isDemo;
    $("[data-demo-banner]").hidden = !client.isDemo;
    course = await client.getActiveCourse();
    const draft = course || { ...structuredClone(DEFAULT_COURSE), id: "" };
    fillCourseForm(draft);
    renderActivation(draft);
    renderReportScopes(draft);
    renderGroupingStatus(draft, courseData);
    updateStatus(course);
    await refreshData();
  }

  if (await client.hasSession()) await showAdmin(); else loginPanel.hidden = false;

  $("#login-form").addEventListener("submit", async event => {
    event.preventDefault();
    const message = $("[data-login-message]");
    try { await client.login(new FormData(event.currentTarget).get("access_code")); await showAdmin(); }
    catch (error) { setMessage(message, error.message); }
  });

  $("#logout-button").addEventListener("click", () => { client.logout(); location.reload(); });

  $("#encounter-count").addEventListener("change", event => {
    const count = Math.max(1, Math.min(12, Number(event.target.value) || 1));
    let current;
    try { current = collectEncounters(); } catch { current = course?.encounters || DEFAULT_COURSE.encounters; }
    const integrativeCard = $("[data-integrative-editor] [data-editor-question]");
    let integrative = course?.integrative_question || DEFAULT_COURSE.integrative_question;
    try { integrative = collectQuestion(integrativeCard, "integrative"); } catch {}
    renderEditors(normalizeEncounters(current, count), integrative);
  });

  document.addEventListener("input", event => { if (event.target.matches("[data-question-options]")) syncCorrectSelect(event.target); });
  document.addEventListener("change", event => {
    if (!event.target.matches("[data-question-enabled]")) return;
    const card = event.target.closest("[data-editor-question]");
    card.classList.toggle("question-editor-card--disabled", !event.target.checked);
    $(".question-toggle span", card).textContent = event.target.checked ? "Visible" : "Oculta";
  });
  $("#active-encounter").addEventListener("change", () => renderGroupingStatus(course, courseData));
  $$('[name=active_phase]').forEach(input => input.addEventListener("change", () => renderGroupingStatus(course, courseData)));

  $("#course-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = $("[data-course-message]");
    if (!form.reportValidity()) return;
    try {
      const values = new FormData(form);
      const encounters = collectEncounters();
      const integrative = collectQuestion($("[data-integrative-editor] [data-editor-question]"), "integrative");
      course = await client.saveCourse({
        id: values.get("id") || undefined, name: values.get("name").trim(), instructor: values.get("instructor").trim(),
        hours: Number(values.get("hours")), modality: values.get("modality"), start_date: values.get("start_date"), end_date: values.get("end_date"),
        status: course?.status || "open", active_encounter: Math.min(course?.active_encounter || 1, encounters.length), active_phase: course?.active_phase || "entrance",
        encounters, integrative_question: integrative
      });
      fillCourseForm(course); renderActivation(course); renderReportScopes(course); updateStatus(course); await refreshData();
      setMessage(message, "Configuración guardada.", "success");
    } catch (error) { setMessage(message, error.message); }
  });

  $("#activate-ticket-button").addEventListener("click", async () => {
    if (!course) return;
    const active_encounter = Number($("#active-encounter").value);
    const active_phase = $("[name=active_phase]:checked")?.value;
    if (!active_phase) return;
    course = await client.updateCourse(course.id, { active_encounter, active_phase });
    updateStatus(course);
    renderGroupingStatus(course, courseData);
  });

  $("#refresh-button").addEventListener("click", refreshData);
  $("#view-report-button").addEventListener("click", async () => {
    if (!course) return;
    const report = selectedReport(await refreshData());
    $("[data-report-content]").innerHTML = report.html;
    $(".dialog-topbar strong").textContent = report.title;
    $("#report-dialog").showModal();
  });
  $$('[data-close-dialog]').forEach(button => button.addEventListener("click", () => $("#report-dialog").close()));
  $("[data-print-report]").addEventListener("click", () => {
    printReport($("[data-report-content]").innerHTML, course?.name || "Curso");
  });
  $("#download-report-button").addEventListener("click", async () => {
    if (!course) return;
    const targetWindow = window.open("", "_blank");
    try {
      const report = selectedReport(await refreshData());
      printReport(report.html, report.title, targetWindow);
    } catch (error) {
      targetWindow?.close();
      alert(error.message);
    }
  });
  $("#download-data-button").addEventListener("click", async () => {
    if (!course) return;
    await refreshData();
    downloadCsv(`respuestas-${course.name.toLowerCase().replace(/[^a-z0-9]+/gi, "-")}.csv`, buildCsvData(course, courseData));
  });
  $("#toggle-course-button").addEventListener("click", async () => {
    if (!course) return;
    const closing = course.status === "open";
    if (!await confirmAction(closing ? "Cerrar curso" : "Reabrir curso", closing ? "No se aceptarán nuevos tickets hasta reabrirlo." : "Volverá a aceptar el ticket actualmente seleccionado.")) return;
    course = await client.updateCourse(course.id, { status: closing ? "closed" : "open" });
    updateStatus(course);
  });
  $("#reset-course-button").addEventListener("click", async () => {
    if (!course) return;
    if (!await confirmAction("Borrar participantes y respuestas", `Se eliminarán ${courseData.participants.length} participantes y ${courseData.responses.length} tickets. Esta acción no se puede deshacer.`, true)) return;
    await client.resetCourse(course.id); await refreshData();
  });
}

const page = document.body.dataset.page;
if (page === "home") initHome();
if (page === "entrance") initTicket("entrance");
if (page === "exit") initTicket("exit");
if (page === "admin") initAdmin();
