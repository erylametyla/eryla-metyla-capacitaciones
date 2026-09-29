import { classifyExpectation } from "./stats.js?v=20260929-4";

function dateTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

export function buildCsvData(course, data) {
  const responseIndex = new Map((data.responses || []).map(row => [
    `${row.participant_id}:${row.encounter_number}:${row.phase}`, row
  ]));
  const dynamicHeaders = [];
  (course.encounters || []).forEach(encounter => {
    ["entrada", "salida"].forEach(phase => {
      dynamicHeaders.push(`encuentro_${encounter.number}_${phase}_fecha`);
      dynamicHeaders.push(`encuentro_${encounter.number}_${phase}_grupo`);
      encounter.questions.forEach((_, index) => dynamicHeaders.push(`encuentro_${encounter.number}_${phase}_pregunta_${index + 1}`));
    });
  });
  dynamicHeaders.push("pregunta_integradora_entrada_1", `pregunta_integradora_salida_${course.encounters.length}`);
  const headers = [
    "nombre_y_apellido", "email", "dni", "institucion", "area_de_trabajo", "fecha_registro",
    "expectativa_inicial", "categoria_expectativa", "cumplimiento_expectativa", ...dynamicHeaders
  ];
  const rows = (data.participants || []).map(participant => {
    const cells = [];
    let firstEntrance;
    let finalExit;
    (course.encounters || []).forEach(encounter => {
      ["entrance", "exit"].forEach(phase => {
        const response = responseIndex.get(`${participant.id}:${encounter.number}:${phase}`);
        if (encounter.number === 1 && phase === "entrance") firstEntrance = response;
        if (encounter.number === course.encounters.length && phase === "exit") finalExit = response;
        cells.push(dateTime(response?.responded_at));
        cells.push(response?.group_number || "");
        encounter.questions.forEach(question => cells.push(response?.answers?.[question.id] || ""));
      });
    });
    cells.push(firstEntrance?.answers?.[course.integrative_question.id] || "");
    cells.push(finalExit?.answers?.[course.integrative_question.id] || "");
    return [
      participant.full_name, participant.email, participant.dni, participant.institution,
      participant.work_area, dateTime(participant.registered_at),
      firstEntrance?.expectation_text || "",
      firstEntrance?.expectation_text ? classifyExpectation(firstEntrance.expectation_text).label : "",
      finalExit?.expectation_fulfillment || "", ...cells
    ];
  });
  return { headers, rows };
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export function downloadCsv(filename, csvData) {
  const content = [csvData.headers, ...csvData.rows].map(row => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob(["\ufeff", content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function downloadHtml(filename, html) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
