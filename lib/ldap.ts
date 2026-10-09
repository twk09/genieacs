import { Client, InvalidCredentialsError } from "ldapts";
import type { Entry } from "ldapts";
import * as config from "./config.ts";
import * as logger from "./logger.ts";

// RFC 4515 escaping of characters that are special in search filters
function escapeFilterValue(value: string): string {
  return value.replace(
    /[\\*()\0]/g,
    (c) => `\\${c.charCodeAt(0).toString(16).padStart(2, "0")}`,
  );
}

function normalizeDn(dn: string): string {
  return dn
    .toLowerCase()
    .replace(/\s*,\s*/g, ",")
    .replace(/\s*=\s*/g, "=")
    .trim();
}

function splitList(value: string, separator: string): string[] {
  return value
    .split(separator)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Format: "<group DN>=><role>[,<role>...];<group DN>=><role>..."
function getRoleMap(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const entry of splitList(String(config.get("LDAP_ROLE_MAP")), ";")) {
    const i = entry.lastIndexOf("=>");
    if (i < 0) continue;
    map.set(normalizeDn(entry.slice(0, i)), splitList(entry.slice(i + 2), ","));
  }
  return map;
}

function getRoles(entry: Entry): string[] {
  const roles = new Set(
    splitList(String(config.get("LDAP_DEFAULT_ROLES")), ","),
  );
  const roleMap = getRoleMap();
  const raw = entry[String(config.get("LDAP_GROUP_ATTRIBUTE"))];
  const groups = (Array.isArray(raw) ? raw : raw == null ? [] : [raw]).map(
    (g) => String(g),
  );
  for (const group of groups)
    for (const role of roleMap.get(normalizeDn(group)) || []) roles.add(role);
  return Array.from(roles);
}

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const timeout = config.get("LDAP_TIMEOUT") as number;
  const rejectUnauthorized = config.get(
    "LDAP_TLS_REJECT_UNAUTHORIZED",
  ) as boolean;
  const client = new Client({
    url: String(config.get("LDAP_URL")),
    timeout,
    connectTimeout: timeout,
    tlsOptions: { rejectUnauthorized },
  });

  try {
    if (config.get("LDAP_START_TLS"))
      await client.startTLS({ rejectUnauthorized });
    return await fn(client);
  } finally {
    await client.unbind().catch(() => null);
  }
}

// Returns the roles granted to the user or null if authentication failed
export async function authLdap(
  username: unknown,
  password: unknown,
): Promise<string[] | null> {
  if (!config.get("LDAP_ENABLED")) return null;

  // An empty password results in an unauthenticated bind that succeeds
  if (typeof username !== "string" || typeof password !== "string") return null;
  if (!username || !password) return null;

  const baseDn = String(config.get("LDAP_USER_BASE_DN"));
  if (!config.get("LDAP_URL") || !baseDn) {
    logger.error({
      message: "LDAP_URL and LDAP_USER_BASE_DN must be set to use LDAP",
    });
    return null;
  }

  try {
    const filter = String(config.get("LDAP_USER_FILTER"))
      .split("{username}")
      .join(escapeFilterValue(username));

    const entry = await withClient(async (client) => {
      const bindDn = String(config.get("LDAP_BIND_DN"));
      if (bindDn)
        await client.bind(bindDn, String(config.get("LDAP_BIND_PASSWORD")));

      const { searchEntries } = await client.search(baseDn, {
        scope: "sub",
        filter,
        attributes: [String(config.get("LDAP_GROUP_ATTRIBUTE"))],
        sizeLimit: 2,
      });

      // Ambiguous match must not authenticate as an arbitrary user
      return searchEntries.length === 1 ? searchEntries[0] : null;
    });
    if (!entry) return null;

    await withClient((client) => client.bind(entry.dn, password));

    const roles = getRoles(entry);
    if (!roles.length) {
      logger.warn({
        message: "LDAP user has no mapped roles",
        username,
        dn: entry.dn,
      });
      return null;
    }
    return roles;
  } catch (err) {
    if (err instanceof InvalidCredentialsError) return null;
    logger.error({ message: "LDAP authentication error", exception: err });
    return null;
  }
}
