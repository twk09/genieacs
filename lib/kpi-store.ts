import { Document } from "mongodb";
import { collections, ensureKpiCollections } from "./db/db.ts";
import * as cache from "./cache.ts";
import * as config from "./config.ts";
import * as logger from "./logger.ts";
import { acquireLock, releaseLock } from "./lock.ts";
import { DeviceData } from "./types.ts";
import { KpiHourly } from "./db/types.ts";
import { extractPoints, getMetrics } from "./kpi.ts";
import { toMongoQuery } from "./db/synth.ts";
import Expression from "./common/expression.ts";

const HOUR = 3600 * 1000;
const WATERMARK_KEY = "kpi-rollup-watermark";
const ROLLUP_LOCK = "kpi_rollup";
const ROLLUP_INTERVAL = 10 * 60 * 1000;
// Sessions can finish a little after the hour they belong to
const ROLLUP_DELAY = 10 * 60 * 1000;
const MAX_ROLLUP_HOURS = 48;
// Needed to compute the counter increase across the hour boundary
const PREVIOUS_SAMPLE_WINDOW = 30 * 60 * 1000;
const MAX_RATE_GAP = 30 * 60 * 1000;
const MAX_DOCS = 400000;
const RAW_MAX_SPAN = 3 * 24 * HOUR;
const HOURLY_MAX_SPAN = 60 * 24 * HOUR;

export interface KpiSeries {
  metric: string;
  instance: string;
  band: string;
  unit: string;
  kind: "gauge" | "counter";
  // Counters are returned as a rate per second
  points: [number, number][];
}

export interface KpiResult {
  resolution: "raw" | "hour" | "day";
  series: KpiSeries[];
}

export interface FleetProductCount {
  productClass: string;
  devices: number;
  online: number;
}

export interface FleetKpiOverview {
  totalDevices: number;
  onlineDevices: number;
  productClasses: FleetProductCount[];
  metrics: string[];
  metric: string;
  unit: string;
  resolution: "5m" | "15m" | "hour" | "day";
  series: { productClass: string; points: [number, number][] }[];
}

export async function saveSessionKpis(
  deviceId: string,
  deviceData: DeviceData,
  since: number,
): Promise<void> {
  const metrics = getMetrics();
  if (!metrics.length) return;
  const device = await collections.devices.findOne(
    { _id: deviceId },
    { projection: { _tags: 1 } },
  );
  if (device?._tags?.includes("kpi-disabled")) return;
  const points = extractPoints(deviceId, deviceData, metrics, since);
  if (points.length)
    await collections.kpi.insertMany(points, { ordered: false });
}

export async function rollupHourly(now = Date.now()): Promise<void> {
  const end = Math.floor((now - ROLLUP_DELAY) / HOUR) * HOUR;

  const token = await acquireLock(ROLLUP_LOCK, 10 * 60 * 1000);
  if (!token) return;

  try {
    let start = Number(await cache.get(WATERMARK_KEY));
    if (!start) {
      const first = await collections.kpi
        .find({}, { projection: { ts: 1 } })
        .sort({ ts: 1 })
        .limit(1)
        .next();
      if (!first) return;
      start = Math.floor(first.ts.getTime() / HOUR) * HOUR;
    }

    while (start < end) {
      const to = Math.min(end, start + MAX_ROLLUP_HOURS * HOUR);
      await collections.kpi
        .aggregate(hourlyPipeline(start, to), { allowDiskUse: true })
        .toArray();
      start = to;
      await cache.set(WATERMARK_KEY, String(start), 10 * 365 * 24 * 3600);
    }
  } finally {
    await releaseLock(ROLLUP_LOCK, token).catch(() => null);
  }
}

// Writing with $merge on _id makes reruns of the same hour idempotent
export function hourlyPipeline(from: number, to: number): Document[] {
  return [
    {
      $match: {
        ts: {
          $gte: new Date(from - PREVIOUS_SAMPLE_WINDOW),
          $lt: new Date(to),
        },
      },
    },
    {
      $setWindowFields: {
        partitionBy: "$meta",
        sortBy: { ts: 1 },
        output: { prev: { $shift: { output: "$value", by: -1 } } },
      },
    },
    { $match: { ts: { $gte: new Date(from) } } },
    {
      $addFields: {
        // Counter resets (negative deltas) do not add to the increase
        delta: {
          $cond: [
            {
              $and: [
                { $eq: ["$meta.kind", "counter"] },
                { $ne: ["$prev", null] },
                { $gte: ["$value", "$prev"] },
              ],
            },
            { $subtract: ["$value", "$prev"] },
            0,
          ],
        },
      },
    },
    {
      $group: {
        _id: {
          device: "$meta.device",
          metric: "$meta.metric",
          instance: "$meta.instance",
          hour: { $dateTrunc: { date: "$ts", unit: "hour" } },
        },
        band: { $last: "$meta.band" },
        kind: { $last: "$meta.kind" },
        count: { $sum: 1 },
        min: { $min: "$value" },
        max: { $max: "$value" },
        sum: { $sum: "$value" },
        first: { $top: { sortBy: { ts: 1 }, output: "$value" } },
        last: { $bottom: { sortBy: { ts: 1 }, output: "$value" } },
        increase: { $sum: "$delta" },
      },
    },
    {
      $project: {
        device: "$_id.device",
        metric: "$_id.metric",
        instance: "$_id.instance",
        hour: "$_id.hour",
        band: 1,
        kind: 1,
        count: 1,
        min: 1,
        max: 1,
        avg: { $divide: ["$sum", "$count"] },
        first: 1,
        last: 1,
        increase: {
          $cond: [{ $eq: ["$kind", "counter"] }, "$increase", "$$REMOVE"],
        },
      },
    },
    {
      $merge: {
        into: "kpiHourly",
        whenMatched: "replace",
        whenNotMatched: "insert",
      },
    },
  ];
}

export async function startKpi(): Promise<void> {
  if (!getMetrics().length) return;

  await ensureKpiCollections(
    Number(config.get("KPI_RAW_TTL")),
    Number(config.get("KPI_HOURLY_TTL")),
  );

  const run = (): void => {
    rollupHourly().catch((err) => {
      logger.error({ message: "KPI rollup failed", exception: err });
    });
  };
  setTimeout(run, 30000).unref();
  setInterval(run, ROLLUP_INTERVAL).unref();
}

function seriesKey(metric: string, instance: string): string {
  return `${metric}\u0000${instance}`;
}

export async function queryKpi(
  deviceId: string,
  from: number,
  to: number,
): Promise<KpiResult> {
  const span = to - from;
  const units = new Map(getMetrics().map((m) => [m.name, m.unit]));
  const series = new Map<string, KpiSeries>();

  function getSeries(
    metric: string,
    instance: string,
    band: string,
    kind: "gauge" | "counter",
  ): KpiSeries {
    const key = seriesKey(metric, instance);
    let s = series.get(key);
    if (!s) {
      s = {
        metric,
        instance,
        band,
        unit: units.get(metric) ?? "",
        kind,
        points: [],
      };
      series.set(key, s);
    }
    return s;
  }

  if (span <= RAW_MAX_SPAN) {
    const docs = await collections.kpi
      .find({
        "meta.device": deviceId,
        ts: {
          $gte: new Date(from - PREVIOUS_SAMPLE_WINDOW),
          $lte: new Date(to),
        },
      })
      .sort({ ts: 1 })
      .limit(MAX_DOCS)
      .toArray();

    const previous = new Map<string, [number, number]>();
    for (const doc of docs) {
      const t = doc.ts.getTime();
      const { metric, instance, band, kind } = doc.meta;
      const key = seriesKey(metric, instance);
      const prev = previous.get(key);
      previous.set(key, [t, doc.value]);

      if (t < from) continue;
      const s = getSeries(metric, instance, band, kind);
      if (kind === "gauge") {
        s.points.push([t, doc.value]);
      } else if (prev && doc.value >= prev[1] && t - prev[0] <= MAX_RATE_GAP) {
        s.points.push([t, (doc.value - prev[1]) / ((t - prev[0]) / 1000)]);
      }
    }
    return { resolution: "raw", series: sortSeries(series) };
  }

  if (span <= HOURLY_MAX_SPAN) {
    const docs = await collections.kpiHourly
      .find({
        device: deviceId,
        hour: { $gte: new Date(from), $lte: new Date(to) },
      })
      .sort({ hour: 1 })
      .limit(MAX_DOCS)
      .toArray();

    for (const doc of docs) {
      const s = getSeries(doc.metric, doc.instance, doc.band, doc.kind);
      const t = doc.hour.getTime();
      if (doc.kind === "gauge") s.points.push([t, doc.avg]);
      else if (doc.count >= 2) s.points.push([t, (doc.increase ?? 0) / 3600]);
    }
    return { resolution: "hour", series: sortSeries(series) };
  }

  const days = await collections.kpiHourly
    .aggregate<{
      _id: KpiHourly["_id"] & { day: Date };
      band: string;
      kind: "gauge" | "counter";
      avg: number;
      increase: number;
      hours: number;
    }>([
      {
        $match: {
          device: deviceId,
          hour: { $gte: new Date(from), $lte: new Date(to) },
        },
      },
      {
        $group: {
          _id: {
            metric: "$metric",
            instance: "$instance",
            day: { $dateTrunc: { date: "$hour", unit: "day" } },
          },
          band: { $last: "$band" },
          kind: { $last: "$kind" },
          avg: { $avg: "$avg" },
          increase: { $sum: "$increase" },
          hours: { $sum: 1 },
        },
      },
      { $sort: { "_id.day": 1 } },
    ])
    .toArray();

  for (const d of days) {
    const s = getSeries(d._id.metric, d._id.instance, d.band, d.kind);
    const t = d._id.day.getTime();
    if (d.kind === "gauge") s.points.push([t, d.avg]);
    else s.points.push([t, d.increase / (d.hours * 3600)]);
  }
  return { resolution: "day", series: sortSeries(series) };
}

export async function queryFleetKpis(
  deviceFilter: Expression,
  metric: string,
  from: number,
  to: number,
): Promise<FleetKpiOverview> {
  const filter = toMongoQuery(deviceFilter, "devices");
  const now = Date.now();
  const productExpression = {
    $let: {
      vars: {
        productClass: "$_deviceId._ProductClass",
        modelName: "$Device.DeviceInfo.ModelName._value",
      },
      in: {
        $cond: [
          { $in: ["$$productClass", [null, ""]] },
          {
            $ifNull: [
              { $ifNull: ["$$modelName", "Unclassified"] },
              "Unclassified",
            ],
          },
          "$$productClass",
        ],
      },
    },
  };

  const productClasses: FleetProductCount[] = filter
    ? await collections.devices
        .aggregate<FleetProductCount>([
          { $match: filter },
          { $addFields: { productClass: productExpression } },
          {
            $group: {
              _id: "$productClass",
              devices: { $sum: 1 },
              online: {
                $sum: {
                  $cond: [
                    { $gte: ["$_lastInform", new Date(now - 15 * 60 * 1000)] },
                    1,
                    0,
                  ],
                },
              },
            },
          },
          { $project: { _id: 0, productClass: "$_id", devices: 1, online: 1 } },
          { $sort: { devices: -1, productClass: 1 } },
        ])
        .toArray()
    : [];

  const metricDefinitions = getMetrics().filter((m) => m.kind === "gauge");
  const metrics = Array.from(
    new Set(metricDefinitions.map((m) => m.name)),
  ).sort();
  if (!metrics.includes(metric)) metric = metrics[0] || "";
  const metricUnit =
    metricDefinitions.find((m) => m.name === metric)?.unit || "";

  const span = to - from;
  const raw = span <= RAW_MAX_SPAN;
  const unit: "minute" | "hour" | "day" = raw
    ? "minute"
    : span <= HOURLY_MAX_SPAN
      ? "hour"
      : "day";
  const binSize = raw ? (span <= 6 * HOUR ? 5 : 15) : 1;
  const source = raw ? collections.kpi : collections.kpiHourly;
  const timeField = raw ? "ts" : "hour";
  const deviceField = raw ? "$meta.device" : "$device";
  const valueField = raw ? "$value" : "$avg";

  const grouped =
    metric && filter
      ? await source
          .aggregate<{
            _id: { productClass: string; bucket: Date };
            value: number;
          }>([
            {
              $match: {
                [timeField]: { $gte: new Date(from), $lte: new Date(to) },
                [raw ? "meta.metric" : "metric"]: metric,
              },
            },
            {
              $lookup: {
                from: "devices",
                let: { deviceId: deviceField },
                pipeline: [
                  { $match: { $expr: { $eq: ["$_id", "$$deviceId"] } } },
                  { $match: filter },
                  { $project: { productClass: productExpression, _id: 0 } },
                ],
                as: "deviceInfo",
              },
            },
            { $unwind: "$deviceInfo" },
            {
              $group: {
                _id: {
                  productClass: "$deviceInfo.productClass",
                  device: deviceField,
                  bucket: {
                    $dateTrunc: {
                      date: `$${timeField}`,
                      unit,
                      binSize,
                    },
                  },
                },
                deviceValue: { $avg: valueField },
              },
            },
            {
              $group: {
                _id: {
                  productClass: "$_id.productClass",
                  bucket: "$_id.bucket",
                },
                value: { $avg: "$deviceValue" },
              },
            },
            { $sort: { "_id.bucket": 1, "_id.productClass": 1 } },
          ])
          .toArray()
      : [];

  const groupedSeries = new Map<string, [number, number][]>();
  for (const point of grouped) {
    const productClass = point._id.productClass || "Unclassified";
    let points = groupedSeries.get(productClass);
    if (!points) groupedSeries.set(productClass, (points = []));
    points.push([point._id.bucket.getTime(), point.value]);
  }

  return {
    totalDevices: productClasses.reduce((sum, p) => sum + p.devices, 0),
    onlineDevices: productClasses.reduce((sum, p) => sum + p.online, 0),
    productClasses,
    metrics,
    metric,
    unit: metricUnit,
    resolution: unit === "minute" ? (binSize === 5 ? "5m" : "15m") : unit,
    series: Array.from(groupedSeries, ([productClass, points]) => ({
      productClass,
      points,
    })),
  };
}

function sortSeries(series: Map<string, KpiSeries>): KpiSeries[] {
  return [...series.values()].sort((a, b) =>
    a.metric === b.metric
      ? a.instance.localeCompare(b.instance, undefined, { numeric: true })
      : a.metric.localeCompare(b.metric),
  );
}
