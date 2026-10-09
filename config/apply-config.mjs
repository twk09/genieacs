// Applies config/ui/*.yaml and config/provisions/*.js to a running genieacs-ui.
// Usage: node config/apply-config.mjs [--dry-run]
// Env: UI_URL (default http://127.0.0.1:3000), UI_USER, UI_PASSWORD (default admin/admin)
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const BASE_URL = process.env.UI_URL || "http://127.0.0.1:3000";
const DRY_RUN = process.argv.includes("--dry-run");
const dir = (p) => fileURLToPath(new URL(p, import.meta.url));

const UI_SECTIONS = ["device", "index", "overview"];
const PROVISIONS = ["bootstrap", "inform", "default"];
const serverConfig = JSON.parse(readFileSync(dir("config.json"), "utf8"));
const queryInterval = serverConfig.KPI_QUERY_INTERVAL_SECONDS ?? 300;

if (!Number.isSafeInteger(queryInterval) || queryInterval < 1)
  throw new Error("KPI_QUERY_INTERVAL_SECONDS must be a positive integer");

let cookie = "";

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "content-type": "application/json", cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok)
    throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res;
}

async function login() {
  const res = await fetch(`${BASE_URL}/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: process.env.UI_USER || "admin",
      password: process.env.UI_PASSWORD || "admin",
    }),
  });
  // Without a session the API only works when UI_AUTH_ENABLED is false
  if (!res.ok)
    return console.warn(
      `Login failed (${res.status}), continuing without a session`,
    );
  cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

function flatten(obj, root, out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = `${root}.${k}`;
    if (v === null || typeof v !== "object") out[key] = v;
    else flatten(v, key, out);
  }
  return out;
}

async function applyUiSection(name) {
  const prefix = `ui.${name}`;
  const parsed = YAML.parse(readFileSync(dir(`ui/${name}.yaml`), "utf8"), {
    schema: "failsafe",
  });
  if (name === "device" && serverConfig.GRAFANA_DASHBOARD_URL) {
    const debugIndex = parsed.findIndex(
      (item) => item.type === "'debug-trace'",
    );
    const link = {
      href: JSON.stringify(serverConfig.GRAFANA_DASHBOARD_URL),
      innerHTML: "'Grafana - TR69 Data'",
      target: "'_blank'",
      type: "'a'",
    };
    parsed.splice(debugIndex < 0 ? parsed.length : debugIndex + 1, 0, link);
  }
  const target = flatten(parsed, prefix);

  // "ui.<name>" itself is also removed because a view name there conflicts with nested keys
  const filter = `_id LIKE "${prefix}.%" OR _id = "${prefix}"`;
  const res = await api(`/api/config/?filter=${encodeURIComponent(filter)}`);
  const current = Object.fromEntries(
    (await res.json()).map((c) => [c._id, c.value]),
  );

  const remove = Object.keys(current).filter((id) => !(id in target));
  const add = Object.entries(target).filter(
    ([id, value]) => current[id] !== value,
  );
  console.log(
    `${prefix}: ${Object.keys(target).length} keys, ${add.length} to write, ${remove.length} to remove`,
  );
  if (DRY_RUN) return;

  for (const id of remove)
    await api(`/api/config/${encodeURIComponent(id)}`, { method: "DELETE" });
  for (const [id, value] of add)
    await api(`/api/config/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: { _id: id, value },
    });
}

async function applyProvision(name) {
  const localInform = name === "inform" ? dir("provisions/inform.js") : "";
  let script = readFileSync(
    name === "inform" && !existsSync(localInform)
      ? dir("provisions/inform.example.js")
      : dir(`provisions/${name}.js`),
    "utf8",
  );
  if (name === "inform") {
    if (!existsSync(localInform)) {
      const username = serverConfig.INFORM_USERNAME;
      const password = serverConfig.INFORM_PASSWORD;
      if (
        typeof username !== "string" ||
        !username ||
        typeof password !== "string" ||
        !password
      )
        throw new Error(
          "Set INFORM_USERNAME and INFORM_PASSWORD in config/config.json or provide a local config/provisions/inform.js",
        );
      script = script
        .replace(
          "const username = __INFORM_USERNAME__;",
          `const username = ${JSON.stringify(username)};`,
        )
        .replace(
          "const password = __INFORM_PASSWORD__;",
          `const password = ${JSON.stringify(password)};`,
        );
    }
    if (!/const informInterval = \d+;/.test(script))
      throw new Error("Could not find informInterval in inform provision");
    script = script.replace(
      /const informInterval = \d+;/,
      `const informInterval = ${queryInterval};`,
    );
  }
  const filter = `_id = "${name}"`;
  const res = await api(
    `/api/provisions/?filter=${encodeURIComponent(filter)}`,
  );
  const [current] = await res.json();
  if (current?.script === script)
    return console.log(`provision ${name}: unchanged`);
  console.log(`provision ${name}: ${current ? "update" : "create"}`);
  if (DRY_RUN) return;
  await api(`/api/provisions/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: { _id: name, script },
  });
}

await login();
for (const name of UI_SECTIONS) await applyUiSection(name);
for (const name of PROVISIONS) await applyProvision(name);
console.log(DRY_RUN ? "Dry run, nothing was changed." : "Done.");
