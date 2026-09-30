import { CONFIG } from "./config.js?v=20260930-3";

function question(id, label) {
  return {
    id,
    enabled: true,
    question: label,
    options: ["Opción A", "Opción B", "Opción C"],
    correct_answer: "Opción A"
  };
}

const today = new Date().toISOString().slice(0, 10);

function defaultGrouping() {
  return {
    entrance: { enabled: false, expected_participants: 30, group_count: 5 },
    exit: { enabled: false, expected_participants: 30, group_count: 5 }
  };
}

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
    grouping: defaultGrouping(),
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

function activeGrouping(course) {
  const encounter = course.encounters?.find(item => Number(item.number) === Number(course.active_encounter));
  return encounter?.grouping?.[course.active_phase] || { enabled: false };
}

function balancedGroup(responses, course, groupCount) {
  const counts = Array.from({ length: groupCount }, (_, index) => ({ number: index + 1, total: 0 }));
  responses
    .filter(row => row.course_id === course.id && Number(row.encounter_number) === Number(course.active_encounter) && row.phase === course.active_phase && row.group_number)
    .forEach(row => {
      const group = counts[Number(row.group_number) - 1];
      if (group) group.total += 1;
    });
  const minimum = Math.min(...counts.map(item => item.total));
  const candidates = counts.filter(item => item.total === minimum);
  return candidates[Math.floor(Math.random() * candidates.length)].number;
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
    this.refreshToken = sessionStorage.getItem(storageKey("admin-refresh-token")) || "";
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

  saveSession(payload) {
    this.token = payload?.access_token || "";
    this.refreshToken = payload?.refresh_token || this.refreshToken || "";
    if (this.token) sessionStorage.setItem(storageKey("admin-token"), this.token);
    if (this.refreshToken) sessionStorage.setItem(storageKey("admin-refresh-token"), this.refreshToken);
  }

  async refreshSession() {
    if (!this.remote || !this.refreshToken) return false;
    try {
      const response = await fetch(`${CONFIG.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: { apikey: CONFIG.supabaseAnonKey, "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: this.refreshToken })
      });
      const payload = await response.json();
      if (!response.ok || !payload?.access_token) {
        this.logout();
        return false;
      }
      this.saveSession(payload);
      return true;
    } catch {
      this.logout();
      return false;
    }
  }

  async request(path, options = {}, admin = false, allowRefresh = true) {
    const response = await fetch(`${CONFIG.supabaseUrl}${path}`, {
      ...options,
      headers: { ...this.headers(admin, options.prefer), ...(options.headers || {}) }
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (response.status === 401 && admin && allowRefresh && await this.refreshSession()) {
      return this.request(path, options, admin, false);
    }
    if (response.status === 401 && admin) {
      this.logout();
      throw new Error("Tu sesión venció. Volvé a ingresar con la clave para continuar.");
    }
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
      const dni = String(values.dni || "").replace(/\D/g, "");
      const participants = readLocal("participants", []);
      let participant = participants.find(item => item.course_id === course.id && String(item.dni || "").replace(/\D/g, "") === dni);
      if (course.active_encounter === 1 && course.active_phase === "entrance") {
        if (participant) {
          throw new Error("Este Ticket 1 ya fue completado con ese DNI.");
        }
        participant = {
          id: localId(), course_id: course.id, full_name: values.full_name,
          email, dni,
          institution: values.institution, work_area: values.work_area,
          registered_at: new Date().toISOString()
        };
        participants.push(participant);
        writeLocal("participants", participants);
      } else if (!participant) {
        throw new Error("No encontramos tu registro del Ticket 1 con ese DNI.");
      }
      const responses = readLocal("responses", []);
      if (responses.some(item => item.participant_id === participant.id && item.encounter_number === course.active_encounter && item.phase === course.active_phase)) {
        throw new Error("Este ticket ya fue completado con ese DNI.");
      }
      const grouping = activeGrouping(course);
      const groupCount = grouping.enabled ? Math.max(2, Math.min(100, Number(grouping.group_count) || 2)) : null;
      const groupNumber = groupCount ? balancedGroup(responses, course, groupCount) : null;
      responses.push({
        id: localId(), course_id: course.id, participant_id: participant.id,
        encounter_number: course.active_encounter, phase: course.active_phase,
        answers: values.answers, expectation_text: values.expectation_text || null,
        expectation_fulfillment: values.expectation_fulfillment || null,
        unit_expectation_text: values.unit_expectation_text || null,
        unit_satisfaction: values.unit_satisfaction ? Number(values.unit_satisfaction) : null,
        instructor_strength: values.instructor_strength || null,
        improvement_suggestion: values.improvement_suggestion || null,
        course_usefulness: values.course_usefulness || null,
        group_number: groupNumber,
        responded_at: new Date().toISOString()
      });
      writeLocal("responses", responses);
      return {
        group_number: groupNumber,
        group_count: groupCount,
        expected_participants: groupNumber ? Number(grouping.expected_participants) || null : null
      };
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
      p_course_usefulness: values.course_usefulness ? Number(values.course_usefulness) : null,
      p_unit_expectation_text: values.unit_expectation_text || null,
      p_unit_satisfaction: values.unit_satisfaction ? Number(values.unit_satisfaction) : null,
      p_instructor_strength: values.instructor_strength || null,
      p_improvement_suggestion: values.improvement_suggestion || null
    };
    return this.request("/rest/v1/rpc/submit_active_ticket", { method: "POST", body: JSON.stringify(body) });
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
    this.saveSession(payload);
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
    this.refreshToken = "";
    sessionStorage.removeItem(storageKey("admin-token"));
    sessionStorage.removeItem(storageKey("admin-refresh-token"));
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
