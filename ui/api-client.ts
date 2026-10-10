import Expression from "../lib/common/expression.ts";
import Path from "../lib/common/path.ts";
import { Task } from "../lib/types.ts";
import { PingResult } from "../lib/ping.ts";
import type { Trace } from "../lib/db/types.ts";
import * as notifications from "./notifications.ts";
import { configSnapshot, genieacsVersion } from "./config.ts";
import { getClockSkew } from "./skewed-date.ts";
import { QueueTask } from "./task-queue.ts";
import { reload } from "./router.ts";

export interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  params?: Record<string, string>;
  timeout?: number;
  signal?: AbortSignal;
}

export class HttpError extends Error {
  code: number;
  response: string;

  constructor(message: string, code: number, response: string) {
    super(message);
    this.name = "HttpError";
    this.code = code;
    this.response = response;
  }
}

export async function request(
  url: string,
  options: RequestOptions = {},
): Promise<Response> {
  const {
    method = "GET",
    body,
    headers = {},
    params,
    timeout = 30000,
    signal,
  } = options;

  const target = new URL(url, location.origin);
  if (params) target.search = new URLSearchParams(params).toString();

  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeout);
  const abortRequest = (): void => controller.abort();
  if (signal?.aborted) abortRequest();
  else signal?.addEventListener("abort", abortRequest, { once: true });

  const init: RequestInit = {
    method,
    headers: { ...headers },
    signal: controller.signal,
    credentials: "same-origin",
  };

  if (body !== undefined) {
    if (body instanceof Blob || body instanceof ArrayBuffer) {
      init.body = body as BodyInit;
    } else {
      init.body = JSON.stringify(body);
      (init.headers as Record<string, string>)["Content-Type"] ??=
        "application/json";
    }
  }

  try {
    const res = await fetch(target, init);

    if (res.status !== 304 && !res.ok) {
      if (res.status === 403) throw new HttpError("Not authorized", 403, "");
      const text = await res.text();
      throw new HttpError(
        text || `Unexpected response status code ${res.status}`,
        res.status,
        text,
      );
    }

    return res;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (timedOut) throw new HttpError("Request timeout", 0, "");
    if (signal?.aborted) throw new HttpError("Request aborted", 0, "");
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new HttpError("Request aborted", 0, "");
    }
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new HttpError("Request timeout", 0, "");
    }
    throw new HttpError("Server is unreachable", 0, "");
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abortRequest);
  }
}

export function uploadFile(
  url: string,
  file: Blob,
  options: {
    headers?: Record<string, string>;
    onProgress?: (fraction: number) => void;
    signal?: AbortSignal;
  } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.withCredentials = true;

    for (const [k, v] of Object.entries(options.headers ?? {}))
      xhr.setRequestHeader(k, v);

    const onProgress = options.onProgress;
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      };
    }

    xhr.onload = () => {
      if (xhr.status === 403)
        return reject(new HttpError("Not authorized", 403, ""));
      if (xhr.status < 200 || xhr.status >= 300) {
        return reject(
          new HttpError(
            xhr.responseText || `Unexpected response status code ${xhr.status}`,
            xhr.status,
            xhr.responseText,
          ),
        );
      }
      resolve();
    };

    xhr.onerror = () => reject(new HttpError("Server is unreachable", 0, ""));
    xhr.onabort = () => reject(new HttpError("Upload aborted", 0, ""));

    if (options.signal) {
      options.signal.addEventListener("abort", () => xhr.abort());
      if (options.signal.aborted) {
        xhr.abort();
        return;
      }
    }

    xhr.send(file);
  });
}

let connectionNotification: ReturnType<typeof notifications.push> | null,
  configNotification: ReturnType<typeof notifications.push> | null,
  versionNotification: ReturnType<typeof notifications.push> | null,
  skewNotification: ReturnType<typeof notifications.push> | null;

function checkConnection(): void {
  fetch("/health", { credentials: "same-origin" })
    .then(async (res) => {
      if (res.status !== 200) {
        if (!connectionNotification) {
          connectionNotification = notifications.push(
            "warning",
            "Server is unreachable",
            {},
          );
        }
        return;
      }

      if (connectionNotification) {
        notifications.dismiss(connectionNotification);
        connectionNotification = null;
      }

      const body = await res.json();

      const skew = body.timestamp - Date.now();
      const skewDrifted = Math.abs(skew - getClockSkew()) > 5000;
      if (!skewNotification !== !skewDrifted) {
        if (skewNotification) {
          notifications.dismiss(skewNotification);
          skewNotification = null;
        } else {
          skewNotification = notifications.push(
            "warning",
            "Clock drift detected, please reload the page",
            {
              Reload: () => {
                reload().catch(console.error);
              },
            },
          );
        }
      }

      const configChanged = body.configSnapshot !== configSnapshot;
      const versionChanged = body.version !== genieacsVersion;

      if (!configNotification !== !configChanged) {
        if (configNotification) {
          notifications.dismiss(configNotification);
          configNotification = null;
        } else {
          configNotification = notifications.push(
            "warning",
            "Configuration has been modified, please reload the page",
            {
              Reload: () => {
                reload().catch(console.error);
              },
            },
          );
        }
      }

      if (!versionNotification !== !versionChanged) {
        if (versionNotification) {
          notifications.dismiss(versionNotification);
          versionNotification = null;
        } else {
          versionNotification = notifications.push(
            "warning",
            "Server has been updated, please reload the page",
            {
              Reload: () => {
                reload().catch(console.error);
              },
            },
          );
        }
      }
    })
    .catch(() => {
      if (!connectionNotification) {
        connectionNotification = notifications.push(
          "warning",
          "Server is unreachable",
          {},
        );
      }
    });
}

setInterval(checkConnection, 3000);

export async function postTasks(
  deviceId: string,
  tasks: QueueTask[],
): Promise<string> {
  const tasks2: Task[] = [];
  for (const t of tasks) {
    t.status = "pending";
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { device, status, ...t2 } = t;
    tasks2.push(t2);
  }

  const res = await request(
    `/api/devices/${encodeURIComponent(deviceId)}/tasks`,
    { method: "POST", body: tasks2, timeout: 720000 },
  );
  const connectionRequestStatus = res.headers.get("Connection-Request");
  const st = await res.json();
  for (const [i, t] of st.entries()) {
    tasks[i]._id = t._id;
    tasks[i].status = t.status;
  }
  return connectionRequestStatus ?? "";
}

export async function updateTags(
  deviceId: string,
  tags: Record<string, boolean>,
  signal?: AbortSignal,
): Promise<void> {
  await request(`/api/devices/${encodeURIComponent(deviceId)}/tags`, {
    method: "POST",
    body: tags,
    signal,
  });
}

export async function deleteResource(
  resourceType: string,
  id: string,
  signal?: AbortSignal,
): Promise<void> {
  await request(`/api/${resourceType}/${encodeURIComponent(id)}`, {
    method: "DELETE",
    signal,
  });
}

export async function putResource(
  resourceType: string,
  id: string,
  object: Record<string, unknown>,
): Promise<void> {
  for (const k in object) if (object[k] === undefined) object[k] = null;

  await request(`/api/${resourceType}/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: object,
  });
}

export async function queryConfig(pattern = "%"): Promise<any[]> {
  const filter = new Expression.Binary(
    "LIKE",
    new Expression.Parameter(Path.parse("_id")),
    new Expression.Literal(pattern),
  );
  const res = await request("/api/config/", {
    params: { filter: filter.toString() },
  });
  return res.json();
}

export async function resourceExists(
  resource: string,
  id: string,
): Promise<number> {
  const param = resource === "devices" ? "DeviceID.ID" : "_id";
  const filter = new Expression.Binary(
    "=",
    new Expression.Parameter(Path.parse(param)),
    new Expression.Literal(id),
  );

  const res = await request(`/api/${resource}/`, {
    method: "HEAD",
    params: { filter: filter.toString() },
  });
  return +(res.headers.get("x-total-count") ?? 0);
}

export async function changePassword(
  username: string,
  newPassword: string,
  authPassword?: string,
): Promise<void> {
  const body: Record<string, string> = { newPassword };
  if (authPassword) body["authPassword"] = authPassword;
  await request(`/api/users/${username}/password`, {
    method: "PUT",
    body,
  });
}

export async function logIn(
  username: string,
  password: string,
  remember = false,
): Promise<void> {
  await request("/login", {
    method: "POST",
    body: { username, password, remember },
  });
}

export async function logOut(): Promise<void> {
  await request("/logout", { method: "POST" });
}

export async function ping(
  host: string,
  signal?: AbortSignal,
): Promise<PingResult> {
  const res = await request(`/api/ping/${encodeURIComponent(host)}`, {
    signal,
  });
  return res.json();
}

export interface TraceEntry extends Omit<
  Trace,
  "_id" | "timestamp" | "expire"
> {
  _id: string;
  timestamp: string;
}

export async function getTraces(
  deviceId: string,
  since: number,
  signal?: AbortSignal,
): Promise<TraceEntry[]> {
  // live=1 keeps the server capturing this device's traffic for a few more seconds
  const res = await request(`/api/traces/${encodeURIComponent(deviceId)}`, {
    params: { since: String(since), live: "1" },
    signal,
  });
  return res.json();
}

export async function stopTraces(deviceId: string): Promise<void> {
  await request(`/api/traces/${encodeURIComponent(deviceId)}`, {
    method: "DELETE",
  });
}

export interface KpiSeries {
  metric: string;
  instance: string;
  band: string;
  unit: string;
  kind: "gauge" | "counter";
  points: [number, number][];
}

export interface KpiResult {
  resolution: "raw" | "hour" | "day";
  series: KpiSeries[];
}

export async function getKpis(
  deviceId: string,
  from: number,
  to: number,
  signal?: AbortSignal,
): Promise<KpiResult> {
  const res = await request(`/api/kpi/${encodeURIComponent(deviceId)}`, {
    params: { from: String(from), to: String(to) },
    signal,
  });
  return res.json();
}

export interface FleetKpiOverview {
  totalDevices: number;
  onlineDevices: number;
  productClasses: { productClass: string; devices: number; online: number }[];
  metrics: string[];
  metric: string;
  unit: string;
  resolution: "5m" | "15m" | "hour" | "day";
  series: { productClass: string; points: [number, number][] }[];
}

export async function getFleetKpis(
  metric: string,
  from: number,
  to: number,
  signal?: AbortSignal,
): Promise<FleetKpiOverview> {
  const res = await request("/api/kpi-overview", {
    params: { metric, from: String(from), to: String(to) },
    signal,
  });
  return res.json();
}
