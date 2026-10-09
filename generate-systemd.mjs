import { access, mkdir, realpath, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { userInfo } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const options = {
  root: dirname(fileURLToPath(import.meta.url)),
  user: userInfo().username,
  node: process.execPath,
  output: "",
  "config-dir": "",
};

function quote(value, exec = false) {
  if (/[\r\n\0]/.test(value))
    throw new Error("Invalid control character in path");
  let escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/%/g, "%%");
  if (exec) escaped = escaped.replace(/\$/g, "$$$$");
  return `"${escaped}"`;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(
      "Usage: node generate-systemd.mjs [--root PATH] [--user USER] [--node PATH] [--config-dir PATH] [--output PATH]",
    );
    return;
  }
  while (args.length) {
    const arg = args.shift();
    const key = arg?.slice(2);
    if (!arg?.startsWith("--") || !Object.hasOwn(options, key) || !args.length)
      throw new Error(`Invalid option: ${arg}. Use --help for usage.`);
    options[key] = args.shift();
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_.-]*\$?$/.test(options.user))
    throw new Error("Invalid service user");
  if (options.user === "root")
    throw new Error("Choose a non-root service account with --user");

  const root = await realpath(resolve(options.root));
  const node = await realpath(resolve(options.node));
  const configDir = await realpath(
    resolve(options["config-dir"] || resolve(root, "config")),
  );
  const output = resolve(options.output || resolve(root, ".dev/systemd"));
  const services = ["cwmp", "nbi", "fs", "ui"];

  await access(node, constants.X_OK);
  await access(resolve(configDir, "config.json"), constants.R_OK);
  for (const service of services)
    await access(resolve(root, `dist/bin/genieacs-${service}`), constants.R_OK);

  await mkdir(output, { recursive: true });
  for (const service of services) {
    const executable = resolve(root, `dist/bin/genieacs-${service}`);
    const unit = `[Unit]
Description=GenieACS ${service.toUpperCase()}
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=${options.user}
WorkingDirectory=${quote(root).slice(1, -1).replace(/ /g, "\\x20")}
Environment=${quote(`GENIEACS_CONFIG_DIR=${configDir}`)}
Environment=NODE_ENV=production
ExecStart=${quote(node, true)} ${quote(executable, true)}
Restart=on-failure
RestartSec=5s
TimeoutStopSec=60s
KillMode=control-group
UMask=0077
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`;
    const target = resolve(output, `genieacs-${service}.service`);
    await writeFile(target, unit, { mode: 0o644 });
    console.log(target);
  }
  console.log(
    "Units generated only; no services were installed or restarted. Ensure the service user can access Node, dist, and config.",
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
