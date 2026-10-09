import { readFileSync, existsSync } from "node:fs";
import Path from "./common/path.ts";
import * as config from "./config.ts";
import * as logger from "./logger.ts";
import { DeviceData } from "./types.ts";
import { KpiPoint } from "./db/types.ts";

export interface KpiMetric {
  name: string;
  path: string;
  unit: string;
  scale: number;
  offset: number;
  kind: "gauge" | "counter";
  band: string;
  bandPath: string;
  model: RegExp | null;
}

function optionalString(value: unknown, field: string): string {
  if (value == null) return "";
  if (typeof value !== "string") throw new Error(`"${field}" must be a string`);
  return value;
}

function optionalNumber(value: unknown, field: string, dflt: number): number {
  if (value == null) return dflt;
  if (typeof value !== "number" || !isFinite(value))
    throw new Error(`"${field}" must be a number`);
  return value;
}

export function parseMetrics(json: unknown): KpiMetric[] {
  const list = (json as { metrics?: unknown } | null)?.metrics;
  if (!Array.isArray(list)) throw new Error(`"metrics" must be an array`);

  const names = new Set<string>();
  return list.map((m: Record<string, unknown>, i) => {
    const name = optionalString(m["name"], "name");
    const path = optionalString(m["path"], "path");
    if (!name || !path)
      throw new Error(`metrics[${i}]: name and path required`);

    const kind = m["kind"] ?? "gauge";
    if (kind !== "gauge" && kind !== "counter")
      throw new Error(`metrics[${i}]: kind must be "gauge" or "counter"`);

    // A name may repeat for different models but not for the same one
    const model = optionalString(m["model"], "model");
    const key = `${name}|${path}|${model}`;
    if (names.has(key)) throw new Error(`metrics[${i}]: duplicate ${name}`);
    names.add(key);

    return {
      name,
      path,
      unit: optionalString(m["unit"], "unit"),
      scale: optionalNumber(m["scale"], "scale", 1),
      offset: optionalNumber(m["offset"], "offset", 0),
      kind,
      band: optionalString(m["band"], "band"),
      bandPath: optionalString(m["bandPath"], "bandPath"),
      // Case-insensitive full match, like the model rules of the Grafana collector
      model: model ? new RegExp(`^(?:${model})$`, "i") : null,
    };
  });
}

let cachedMetrics: KpiMetric[] | undefined;

// Loaded once per process; restart the service to apply changes
export function getMetrics(): KpiMetric[] {
  if (cachedMetrics) return cachedMetrics;

  cachedMetrics = [];
  const file = "" + config.get("KPI_CONFIG_FILE");
  if (!file || !existsSync(file)) return cachedMetrics;

  try {
    cachedMetrics = parseMetrics(JSON.parse(readFileSync(file, "utf8")));
  } catch (err) {
    logger.error({
      message: "Invalid KPI configuration, KPI collection disabled",
      file,
      exception: err,
    });
  }
  return cachedMetrics;
}

type ValueAttr = [number, [string | number | boolean, string]];

function getValueAttr(deviceData: DeviceData, path: string): ValueAttr | null {
  const p = deviceData.paths.get(path);
  if (!p) return null;
  return deviceData.attributes.get(p)?.value ?? null;
}

function getModel(deviceData: DeviceData): string {
  for (const path of [
    "Device.DeviceInfo.ModelName",
    "InternetGatewayDevice.DeviceInfo.ModelName",
    "DeviceID.ProductClass",
  ]) {
    const v = getValueAttr(deviceData, path)?.[1]?.[0];
    if (v != null && v !== "") return String(v);
  }
  return "";
}

function toNumber(value: string | number | boolean): number | null {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" && !value.trim()) return null;
  const n = Number(value);
  return isFinite(n) ? n : null;
}

// Only values refreshed since the given timestamp are returned so that cached
// values are not stored again by every session
export function extractPoints(
  deviceId: string,
  deviceData: DeviceData,
  metrics: KpiMetric[],
  since: number,
): KpiPoint[] {
  const model = getModel(deviceData);
  const points: KpiPoint[] = [];

  for (const metric of metrics) {
    if (metric.model && !metric.model.test(model)) continue;

    const pattern = Path.parse(metric.path);
    const paths = pattern.wildcard
      ? deviceData.paths
          .find(pattern, (1 << pattern.length) | pattern.wildcard, 1)
          .filter((p) => !p.wildcard)
      : [deviceData.paths.get(metric.path)];

    for (const p of paths) {
      if (!p) continue;
      const attr = getValueAttr(deviceData, p.toString());
      if (!attr || attr[0] < since) continue;
      const raw = toNumber(attr[1][0]);
      if (raw == null) continue;

      const instance = p.segments
        .filter((_, i) => pattern.wildcard & (1 << i))
        .join(".");

      let band = metric.band;
      if (metric.bandPath) {
        const bandPath = metric.bandPath.split("{instance}").join(instance);
        const b = getValueAttr(deviceData, bandPath)?.[1]?.[0];
        if (b != null) band = String(b);
      }

      points.push({
        ts: new Date(attr[0]),
        meta: {
          device: deviceId,
          metric: metric.name,
          instance,
          band,
          kind: metric.kind,
        },
        value: raw * metric.scale + metric.offset,
      });
    }
  }

  return points;
}
