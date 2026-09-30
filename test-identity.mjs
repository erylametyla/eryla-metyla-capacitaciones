import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [app, data, entrance, exit, migration] = await Promise.all([
  readFile(new URL("./app.js", import.meta.url), "utf8"),
  readFile(new URL("./data.js", import.meta.url), "utf8"),
  readFile(new URL("./entrada.html", import.meta.url), "utf8"),
  readFile(new URL("./salida.html", import.meta.url), "utf8"),
  readFile(new URL("./supabase-dni-identity-migration.sql", import.meta.url), "utf8")
]);

assert.match(entrance, /name="dni_repeat"/);
assert.match(exit, /name="dni_repeat"/);
assert.doesNotMatch(entrance, /name="email_repeat"/);
assert.doesNotMatch(exit, /name="email"/);
assert.match(app, /values\.get\("dni_repeat"\)/);
assert.match(data, /and dni = regexp_replace\(p_dni|p_dni: values\.dni/);
assert.match(migration, /drop constraint if exists participants_course_id_email_key/);
assert.doesNotMatch(migration, /^\s*(delete|truncate|update)\b/im);

console.log("Pruebas de identidad por DNI correctas");
