import assert from "node:assert/strict";

const values = new Map([
  ["eryla-metyla-capacitaciones-v1:admin-token", "expired-token"],
  ["eryla-metyla-capacitaciones-v1:admin-refresh-token", "valid-refresh-token"]
]);

globalThis.sessionStorage = {
  getItem: key => values.get(key) || null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: key => values.delete(key)
};

const calls = [];
globalThis.fetch = async (url, options = {}) => {
  calls.push({ url, authorization: options.headers?.Authorization });
  if (url.includes("grant_type=refresh_token")) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ access_token: "renewed-token", refresh_token: "rotated-refresh-token" })
    };
  }
  if (options.headers?.Authorization === "Bearer renewed-token") {
    return { ok: true, status: 200, text: async () => JSON.stringify([{ id: "course-1" }]) };
  }
  return { ok: false, status: 401, text: async () => JSON.stringify({ message: "JWT expired" }) };
};

const { DataClient } = await import("./data.js");
const client = new DataClient();
const course = await client.getActiveCourse();

assert.equal(course.id, "course-1");
assert.equal(client.token, "renewed-token");
assert.equal(client.refreshToken, "rotated-refresh-token");
assert.equal(values.get("eryla-metyla-capacitaciones-v1:admin-token"), "renewed-token");
assert.equal(calls.length, 3);
assert.ok(calls[1].url.includes("grant_type=refresh_token"));
assert.equal(calls[2].authorization, "Bearer renewed-token");

values.delete("eryla-metyla-capacitaciones-v1:admin-refresh-token");
values.set("eryla-metyla-capacitaciones-v1:admin-token", "another-expired-token");
globalThis.fetch = async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ message: "JWT expired" }) });

const clientWithoutRefresh = new DataClient();
await assert.rejects(() => clientWithoutRefresh.getActiveCourse(), /Tu sesión venció/);
assert.equal(values.has("eryla-metyla-capacitaciones-v1:admin-token"), false);

console.log("Pruebas de sesión correctas");
