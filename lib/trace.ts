import { Trace } from "./db/types.ts";

// Basic credentials are just base64 so they must not end up in stored traces
function redactHeader(name: string, value: string): string {
  const n = name.toLowerCase();
  if (
    (n === "authorization" || n === "proxy-authorization") &&
    /^basic\s/i.test(value)
  )
    return "Basic [redacted]";
  return value;
}

export function buildTrace(
  msg: Record<string, unknown>,
  ttl: number,
  maxBody: number,
): Trace | null {
  if (typeof msg["deviceId"] !== "string") return null;

  const timestamp =
    msg["timestamp"] instanceof Date ? msg["timestamp"] : new Date();
  const trace: Trace = {
    device: msg["deviceId"],
    timestamp,
    expire: new Date(timestamp.getTime() + ttl),
    event: String(msg["event"]),
  };

  if (typeof msg["remoteAddress"] === "string")
    trace.remoteAddress = msg["remoteAddress"];
  if (typeof msg["method"] === "string") trace.method = msg["method"];
  if (typeof msg["url"] === "string") trace.url = msg["url"];
  if (typeof msg["statusCode"] === "number")
    trace.statusCode = msg["statusCode"];
  if (typeof msg["error"] === "string") trace.error = msg["error"];

  const headers = msg["headers"];
  if (headers && typeof headers === "object") {
    trace.headers = [];
    for (const [k, v] of Object.entries(headers)) {
      if (v == null) continue;
      const value = Array.isArray(v) ? v.join(", ") : String(v);
      trace.headers.push([k, redactHeader(k, value)]);
    }
  }

  const body = msg["body"];
  if (typeof body === "string") {
    if (body.length > maxBody) {
      trace.body = body.slice(0, maxBody);
      trace.truncated = true;
    } else {
      trace.body = body;
    }
  }

  return trace;
}
