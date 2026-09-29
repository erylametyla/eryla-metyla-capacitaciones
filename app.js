import { DataClient, DEFAULT_COURSE } from "./data.js?v=20260929-3";
import { buildReportData } from "./stats.js?v=20260929-3";
import { buildCsvData, downloadCsv, downloadHtml } from "./exports.js?v=20260929-3";

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
    const finalExit = phase === "exit" && Number(course.active_encounter) === Number(course.encounter_count);
    const questions = [...encounter.questions];
    if (firstEntrance || finalExit) questions.push(course.integrative_question);

    $("[data-ticket-kicker]").textContent = `${encounter.title} · ${phase === "entrance" ? "Antes de comenzar" : "Al finalizar"}`;
    $("[data-ticket-title]").textContent = `Ticket ${course.active_encounter} · ${phase === "entrance" ? "Entrada" : "Salida"}`;
    $("[data-questions]").innerHTML = questions.map((question, index) => questionHtml(question, index, question.id === course.integrative_question.id)).join("");
    const profile = $("[data-profile-fields]");
    if (profile) {
      profile.hidden = !firstEntrance;
      $("[data-email-only]").hidden = firstEntrance;
      $$('input', profile).forEach(input => { input.required = firstEntrance; });
      $("[name=email_repeat]").required = !firstEntrance;
      $("[data-expectation]").hidden = !firstEntrance;
      $("[name=expectation_text]").required = firstEntrance;
    }
    const finalFields = $("[data-final-fields]");
    if (finalFields) {
      finalFields.hidden = !finalExit;
      $$('input', finalFields).forEach(input => { input.required = finalExit; });
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
        await client.submitTicket({
          course_id: course.id,
          email: firstEntrance ? values.get("email") : values.get("email_repeat") || values.get("email"),
          full_name: values.get("full_name"), dni: values.get("dni"),
          institution: values.get("institution"), work_area: values.get("work_area"),
          expectation_text: values.get("expectation_text"),
          expectation_fulfillment: values.get("expectation_fulfillment"),
          course_usefulness: values.get("course_usefulness"), answers
        });
        form.reset();
        setMessage(message, "Respuesta guardada correctamente. Gracias por participar.", "success");
        button.hidden = true;
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
  return `<div class="question-editor-card" data-editor-question data-question-id="${escapeHtml(id)}"><div class="question-editor-card__header"><strong>${escapeHtml(label)}</strong></div><div class="field"><label>Enunciado</label><input data-question-text maxlength="240" required value="${escapeHtml(question.question)}"></div><div class="field"><label>Opciones de respuesta</label><textarea data-question-options rows="4" required>${escapeHtml(options)}</textarea><small>Una opción por línea.</small></div><div class="field"><label>Respuesta correcta</label><select data-correct-answer required>${optionTags}</select></div></div>`;
}

function blankQuestion(id, label) {
  return { id, question: label, options: ["Opción A", "Opción B", "Opción C"], correct_answer: "Opción A" };
}

function normalizeEncounters(encounters, count) {
  return Array.from({ length: count }, (_, offset) => {
    const number = offset + 1;
    const previous = encounters.find(item => Number(item.number) === number);
    return {
      number,
      title: previous?.title || `Encuentro ${number}`,
      questions: Array.from({ length: 3 }, (__, questionOffset) => previous?.questions?.[questionOffset] || blankQuestion(`e${number}q${questionOffset + 1}`, `Pregunta ${questionOffset + 1} de la unidad ${number}`))
    };
  });
}

function renderEditors(encounters, integrative) {
  $("[data-encounter-editor]").innerHTML = encounters.map(encounter => `<details class="encounter-card" data-encounter-card data-number="${encounter.number}"${encounter.number === 1 ? " open" : ""}><summary><strong>Ticket ${encounter.number}</strong><span>${escapeHtml(encounter.title)}</span></summary><div class="encounter-card__body"><div class="field"><label>Nombre del encuentro</label><input data-encounter-title required maxlength="120" value="${escapeHtml(encounter.title)}"></div>${encounter.questions.map((question, index) => editorQuestion(question, `e${encounter.number}q${index + 1}`, `Pregunta ${index + 1}`)).join("")}</div></details>`).join("");
  $("[data-integrative-editor]").innerHTML = editorQuestion(integrative, "integrative", "Pregunta integradora");
}

function collectQuestion(card, forcedId) {
  const options = $("[data-question-options]", card).value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  const correct = $("[data-correct-answer]", card).value;
  if (options.length < 2) throw new Error("Cada pregunta necesita al menos dos opciones.");
  if (!options.includes(correct)) throw new Error("Seleccioná una respuesta correcta válida.");
  return { id: forcedId, question: $("[data-question-text]", card).value.trim(), options, correct_answer: correct };
}

function collectEncounters() {
  return $$('[data-encounter-card]').map(card => {
    const number = Number(card.dataset.number);
    return { number, title: $("[data-encounter-title]", card).value.trim(), questions: $$('[data-editor-question]', card).map((questionCard, index) => collectQuestion(questionCard, `e${number}q${index + 1}`)) };
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

function updateStatus(course) {
  const badge = $("[data-course-status]");
  const open = course?.status === "open";
  badge.textContent = course ? (open ? `Abierto · Ticket ${course.active_encounter} ${course.active_phase === "entrance" ? "Entrada" : "Salida"}` : "Curso cerrado") : "Sin configurar";
  badge.className = `status-badge${open ? "" : " status-badge--closed"}`;
  $("#toggle-course-button").textContent = open ? "Cerrar curso" : "Reabrir curso";
}

function reportTableQuestion(question) {
  return `<tr><td>${escapeHtml(question.question)}</td><td>${question.entrance.correct}/${question.entrance.n}<br><span class="muted">${percent(question.entrance.share)}</span></td><td>${question.exit.correct}/${question.exit.n}<br><span class="muted">${percent(question.exit.share)}</span></td><td>${question.change >= 0 ? "+" : ""}${percent(question.change)}</td><td>${question.improved} / ${question.unchanged} / ${question.worsened}</td></tr>`;
}

function barList(rows) {
  if (!rows.length) return `<p class="muted">Sin datos todavía.</p>`;
  return `<div class="bar-list">${rows.map(row => `<div class="bar-row"><span>${escapeHtml(row.label)}</span><div class="bar-track"><span style="width:${Math.min(row.share, 100)}%"></span></div><strong>${row.count}</strong></div>`).join("")}</div>`;
}

function reportHtml(report) {
  const expectationRows = report.expectations.filter(row => row.count).map(row => `<tr><td>${escapeHtml(row.label)}</td><td>${row.count}</td><td>${row.counts.Totalmente}</td><td>${row.counts.Parcialmente}</td><td>${row.counts["No cumplió"]}</td></tr>`).join("");
  return `<article class="report-paper"><span class="eyebrow">ERYLA METYLA · Informe de capacitación</span><h1>${escapeHtml(report.course.name)}</h1><div class="report-meta">Profesor/a: ${escapeHtml(report.course.instructor)} · ${escapeHtml(report.course.modality)} · ${escapeHtml(report.course.hours)} horas<br>Período: ${dateOnly(report.course.start_date)} — ${dateOnly(report.course.end_date)} · Generado: ${new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(new Date())}</div><div class="report-cards"><div class="report-card"><strong>${report.participants.length}</strong><span>Participantes</span></div><div class="report-card"><strong>${report.responses.length}</strong><span>Tickets respondidos</span></div><div class="report-card"><strong>${report.fullyCompleted}</strong><span>Recorridos completos</span></div><div class="report-card"><strong>${report.course.encounters.length}</strong><span>Encuentros</span></div></div><h2>Evolución por encuentro</h2>${report.encounters.map(encounter => `<section class="report-section"><h3>Ticket ${encounter.number} · ${escapeHtml(encounter.title)}</h3><p class="report-meta">Entradas: ${encounter.entranceCount} · Salidas: ${encounter.exitCount} · Vinculadas: ${encounter.paired} · Seguimiento: ${percent(encounter.completionRate)}</p><table class="report-table"><thead><tr><th>Pregunta</th><th>Entrada</th><th>Salida</th><th>Cambio</th><th>Mejoró / Igual / Bajó</th></tr></thead><tbody>${encounter.questions.map(reportTableQuestion).join("")}</tbody></table></section>`).join("")}<h2>Pregunta integradora: inicio vs. cierre</h2><p class="report-note">Compara la Entrada del Ticket 1 con la Salida del Ticket ${report.course.encounters.length}, únicamente en participantes vinculados.</p><table class="report-table"><thead><tr><th>Pregunta</th><th>Entrada 1</th><th>Salida ${report.course.encounters.length}</th><th>Cambio</th><th>Mejoró / Igual / Bajó</th></tr></thead><tbody>${reportTableQuestion(report.integrative)}</tbody></table><h2>Perfil institucional</h2><h3>Instituciones</h3>${barList(report.institutions)}<h3>Áreas de trabajo</h3>${barList(report.workAreas)}<h2>Expectativas iniciales y cumplimiento final</h2>${expectationRows ? `<table class="report-table"><thead><tr><th>Expectativa</th><th>Inicial</th><th>Totalmente</th><th>Parcialmente</th><th>No cumplió</th></tr></thead><tbody>${expectationRows}</tbody></table>` : `<p class="muted">Sin respuestas suficientes.</p>`}</article>`;
}

const REPORT_CSS = `:root{font-family:Arial,sans-serif;color:#20252b}body{margin:0;background:#f5f6f7}.report-paper{max-width:900px;margin:24px auto;padding:38px;background:#fff}.eyebrow{color:#fe5e01;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}h1{font-size:32px;margin:5px 0 8px}h2{font-size:19px;margin:30px 0 12px;padding-top:18px;border-top:1px solid #ded9e8}h3{font-size:15px}.report-meta,.muted{color:#626973;font-size:12px;line-height:1.5}.report-cards{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin:22px 0}.report-card{padding:13px;border:1px solid #ded9e8;border-radius:9px}.report-card strong{display:block;font-size:23px}.report-card span{color:#626973;font-size:11px}.report-table{width:100%;border-collapse:collapse;font-size:12px}.report-table th,.report-table td{padding:8px 6px;border-bottom:1px solid #ded9e8;text-align:right}.report-table th:first-child,.report-table td:first-child{text-align:left}.report-note{padding:11px 13px;border-left:3px solid #6a35d6;background:#f0eafb;font-size:12px}.bar-list{display:grid;gap:9px}.bar-row{display:grid;grid-template-columns:180px 1fr 50px;align-items:center;gap:9px;font-size:12px}.bar-track{height:8px;overflow:hidden;border-radius:99px;background:#e9e5ef}.bar-track span{display:block;height:100%;background:#6a35d6}@media(max-width:650px){.report-paper{margin:0;padding:20px 14px}.report-cards{grid-template-columns:repeat(2,1fr)}.report-table{font-size:10px}.bar-row{grid-template-columns:110px 1fr 35px}}@media print{body{background:#fff}.report-paper{margin:0;padding:0}}`;

function fullReportDocument(content, title) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Informe ${escapeHtml(title)}</title><style>${REPORT_CSS}</style></head><body>${content}</body></html>`;
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
      fillCourseForm(course); renderActivation(course); updateStatus(course); await refreshData();
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
  });

  $("#refresh-button").addEventListener("click", refreshData);
  $("#view-report-button").addEventListener("click", async () => {
    if (!course) return;
    const content = reportHtml(await refreshData());
    $("[data-report-content]").innerHTML = content;
    $("#report-dialog").showModal();
  });
  $$('[data-close-dialog]').forEach(button => button.addEventListener("click", () => $("#report-dialog").close()));
  $("[data-print-report]").addEventListener("click", () => {
    const html = fullReportDocument($("[data-report-content]").innerHTML, course?.name || "Curso");
    const win = window.open("", "_blank");
    win.document.write(html); win.document.close(); win.focus(); win.print();
  });
  $("#download-report-button").addEventListener("click", async () => {
    if (!course) return;
    const html = fullReportDocument(reportHtml(await refreshData()), course.name);
    downloadHtml(`informe-${course.name.toLowerCase().replace(/[^a-z0-9]+/gi, "-")}.html`, html);
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
