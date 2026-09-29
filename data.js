import { CONFIG } from "./config.js?v=20260929-3";

function question(id, label) {
  return {
    id,
    question: label,
    options: ["Opción A", "Opción B", "Opción C"],
    correct_answer: "Opción A"
  };
}

const today = new Date().toISOString().slice(0, 10);

export const DEFAULT_COURSE = {
  id: "demo-course-1",
  name: "Curso de pedagogía",
  instructor: "Equipo ERYLA METYLA",
  hours: 9,
  modality: "Presencial",
  start_date: today,
  end_date: today,
  status: "open",
  is_active: true,
  active_encounter: 1,
  active_phase: "entrance",
  encounters: [1, 2, 3].map(number => ({
    number,
    title: `Encuentro ${number}`,
    questions: [1, 2, 3].map(index => question(`e${number}q${index}`, `Pregunta ${index} de la unidad ${number}`))
  })),
  integrative_question: question("integrative", "Pregunta integradora del curso")
};

function configured() {
  return Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
}

function storageKey(name) {
  return `${CONFIG.storagePrefix}:${name}`;
}

function readLocal(name, fallback) {
  try {
    const raw = localStorage.getItem(storageKey(name));
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(name, value) {
  localStorage.setItem(storageKey(name), JSON.stringify(value));
  return value;
}

function localId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function publicCourse(course) {
  const sanitize = item => {
    const { correct_answer, ...safe } = item;
    return safe;
  };
  return {
    ...course,
    encounter_count: course.encounters.length,
    encounters: course.encounters.map(encounter => ({ ...encounter, questions: encounter.questions.map(sanitize) })),
    integrative_question: sanitize(course.integrative_question)
  };
}

function apiError(payload, status) {
  const message = payload?.message || payload?.msg || payload?.error_description || payload?.error || `Error ${status}`;
  const error = new Error(message);
  error.status = status;
  error.code = payload?.code;
  return error;
}

export class DataClient {
  constructor() {
    this.remote = configured();
    this.token = sessionStorage.getItem(storageKey("admin-token")) || "";
  }

  get isDemo() { return !this.remote; }

  headers(admin = false, prefer = "") {
    const headers = {
      apikey: CONFIG.supabaseAnonKey,
      Authorization: `Bearer ${admin && this.token ? this.token : CONFIG.supabaseAnonKey}`,
      "Content-Type": "application/json"
    };
    if (prefer) headers.Prefer = prefer;
    return headers;
  }

  async request(path, options = {}, admin = false) {
    const response = await fetch(`${CONFIG.supabaseUrl}${path}`, {
      ...options,
      headers: { ...this.headers(admin, options.prefer), ...(options.headers || {}) }
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (!response.ok) throw apiError(payload, response.status);
    return payload;
  }

  async getActiveTicket() {
    if (!this.remote) return publicCourse(readLocal("course", DEFAULT_COURSE));
    const payload = await this.request("/rest/v1/rpc/get_active_ticket", { method: "POST", body: "{}" });
    return Array.isArray(payload) ? payload[0] || null : payload;
  }

  async getActiveCourse() {
    if (!this.remote) return readLocal("course", DEFAULT_COURSE);
    const rows = await this.request("/rest/v1/courses?is_active=eq.true&select=*&order=created_at.desc&limit=1", {}, true);
    return rows[0] || null;
  }

  async submitTicket(values) {
    if (!this.remote) {
      const course = readLocal("course", DEFAULT_COURSE);
      if (course.status !== "open") throw new Error("El curso está cerrado.");
      const email = normalizeEmail(values.email);
      const participants = readLocal("participants", []);
      let participant = participants.find(item => item.course_id === course.id && normalizeEmail(item.email) === email);
      if (course.active_encounter === 1 && course.active_phase === "entrance") {
        if (participant || participants.some(item => item.course_id === course.id && item.dni === values.dni)) {
          throw new Error("Este ticket ya fue completado con ese correo o DNI.");
        }
        participant = {
          id: localId(), course_id: course.id, full_name: values.full_name,
          email, dni: String(values.dni).replace(/\D/g, ""),
          institution: values.institution, work_area: values.work_area,
          registered_at: new Date().toISOString()
        };
        participants.push(participant);
        writeLocal("participants", participants);
      } else if (!participant) {
        throw new Error("No encontramos tu registro del Ticket 1 con ese correo.");
      }
      const responses = readLocal("responses", []);
      if (responses.some(item => item.participant_id === participant.id && item.encounter_number === course.active_encounter && item.phase === course.active_phase)) {
        throw new Error("Este ticket ya fue completado con ese correo.");
      }
      responses.push({
        id: localId(), course_id: course.id, participant_id: participant.id,
        encounter_number: course.active_encounter, phase: course.active_phase,
        answers: values.answers, expectation_text: values.expectation_text || null,
        expectation_fulfillment: values.expectation_fulfillment || null,
        course_usefulness: values.course_usefulness || null,
        responded_at: new Date().toISOString()
      });
      writeLocal("responses", responses);
      return;
    }
    const body = {
      p_course_id: values.course_id,
      p_email: normalizeEmail(values.email),
      p_answers: values.answers,
      p_full_name: values.full_name || null,
      p_dni: values.dni || null,
      p_institution: values.institution || null,
      p_work_area: values.work_area || null,
      p_expectation_text: values.expectation_text || null,
      p_expectation_fulfillment: values.expectation_fulfillment || null,
      p_course_usefulness: values.course_usefulness ? Number(values.course_usefulness) : null
    };
    await this.request("/rest/v1/rpc/submit_active_ticket", { method: "POST", body: JSON.stringify(body) });
  }

  async login(accessCode) {
    if (!this.remote) return { user: { email: "demo@local" } };
    if (!CONFIG.adminEmail) throw new Error("El acceso administrador todavía no está configurado.");
    const response = await fetch(`${CONFIG.supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: CONFIG.supabaseAnonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email: CONFIG.adminEmail, password: accessCode })
    });
    const payload = await response.json();
    if (!response.ok) throw apiError(payload, response.status);
    this.token = payload.access_token;
    sessionStorage.setItem(storageKey("admin-token"), this.token);
    const profiles = await this.request("/rest/v1/admin_profiles?select=user_id&limit=1", {}, true);
    if (!profiles.length) {
      this.logout();
      throw new Error("La cuenta no tiene permisos de administración.");
    }
    return payload;
  }

  async hasSession() {
    if (!this.remote) return true;
    if (!this.token) return false;
    try {
      await this.request("/auth/v1/user", {}, true);
      const profiles = await this.request("/rest/v1/admin_profiles?select=user_id&limit=1", {}, true);
      return Boolean(profiles.length);
    } catch {
      this.logout();
      return false;
    }
  }

  logout() {
    this.token = "";
    sessionStorage.removeItem(storageKey("admin-token"));
  }

  async saveCourse(values) {
    const row = { ...values, is_active: true, updated_at: new Date().toISOString() };
    if (!this.remote) {
      const current = readLocal("course", DEFAULT_COURSE);
      return writeLocal("course", { ...current, ...row, id: current.id || localId() });
    }
    if (row.id) {
      const id = row.id;
      delete row.id;
      const rows = await this.request(`/rest/v1/courses?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH", body: JSON.stringify(row), prefer: "return=representation"
      }, true);
      return rows[0];
    }
    const rows = await this.request("/rest/v1/courses", {
      method: "POST", body: JSON.stringify(row), prefer: "return=representation"
    }, true);
    return rows[0];
  }

  async updateCourse(id, changes) {
    if (!this.remote) {
      const course = readLocal("course", DEFAULT_COURSE);
      return writeLocal("course", { ...course, ...changes, updated_at: new Date().toISOString() });
    }
    const rows = await this.request(`/rest/v1/courses?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH", body: JSON.stringify({ ...changes, updated_at: new Date().toISOString() }), prefer: "return=representation"
    }, true);
    return rows[0];
  }

  async getCourseData(courseId) {
    if (!this.remote) {
      return {
        participants: readLocal("participants", []).filter(row => row.course_id === courseId),
        responses: readLocal("responses", []).filter(row => row.course_id === courseId)
      };
    }
    const [participants, responses] = await Promise.all([
      this.request(`/rest/v1/participants?course_id=eq.${encodeURIComponent(courseId)}&select=*&order=registered_at.asc`, {}, true),
      this.request(`/rest/v1/ticket_responses?course_id=eq.${encodeURIComponent(courseId)}&select=*&order=responded_at.asc`, {}, true)
    ]);
    return { participants, responses };
  }

  async resetCourse(courseId) {
    if (!this.remote) {
      writeLocal("responses", readLocal("responses", []).filter(row => row.course_id !== courseId));
      writeLocal("participants", readLocal("participants", []).filter(row => row.course_id !== courseId));
      return;
    }
    await this.request(`/rest/v1/participants?course_id=eq.${encodeURIComponent(courseId)}`, { method: "DELETE" }, true);
  }
}
