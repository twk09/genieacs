import test from "node:test";
import assert from "node:assert";
import Path from "../lib/common/path.ts";
import PathSet from "../lib/common/path-set.ts";
import VersionedMap from "../lib/versioned-map.ts";
import * as device from "../lib/device.ts";
import { Attributes, DeviceData } from "../lib/types.ts";
import { extractPoints, parseMetrics } from "../lib/kpi.ts";

const NOW = 1_000_000;

function createDeviceData(
  values: Record<string, [string | number | boolean, string, number?]>,
): DeviceData {
  const deviceData: DeviceData = {
    paths: new PathSet(),
    timestamps: new VersionedMap<Path, number>(),
    attributes: new VersionedMap<Path, Attributes>(),
    trackers: new Map<Path, { [name: string]: number }>(),
    changes: new Set<string>(),
  };

  for (const [path, [value, type, ts]] of Object.entries(values)) {
    device.set(deviceData, path, ts ?? NOW, {
      value: [ts ?? NOW, [value, type]],
    });
  }
  return deviceData;
}

function parse(
  metrics: Record<string, unknown>[],
): ReturnType<typeof parseMetrics> {
  return parseMetrics({ metrics });
}

void test("applies scale and offset to a single parameter", () => {
  const data = createDeviceData({
    "Device.DeviceInfo.MemoryStatus.Free": [2048, "xsd:unsignedInt"],
  });
  const metrics = parse([
    {
      name: "system.memory_free_mib",
      path: "Device.DeviceInfo.MemoryStatus.Free",
      unit: "MiB",
      scale: 0.0009765625,
    },
  ]);

  const points = extractPoints("dev", data, metrics, NOW);
  assert.strictEqual(points.length, 1);
  assert.strictEqual(points[0].value, 2);
  assert.deepStrictEqual(points[0].meta, {
    device: "dev",
    metric: "system.memory_free_mib",
    instance: "",
    band: "",
    kind: "gauge",
  });
  assert.strictEqual(points[0].ts.getTime(), NOW);
});

void test("expands wildcards into one point per instance", () => {
  const data = createDeviceData({
    "Device.WiFi.AccessPoint.1.AssociatedDevice.1.TxBytes": [
      10,
      "xsd:unsignedInt",
    ],
    "Device.WiFi.AccessPoint.3.AssociatedDevice.1.TxBytes": [
      30,
      "xsd:unsignedInt",
    ],
    "Device.WiFi.AccessPoint.3.AssociatedDevice.2.TxBytes": [
      32,
      "xsd:unsignedInt",
    ],
    "Device.WiFi.AccessPoint.3.AssociatedDevice.2.RxBytes": [
      99,
      "xsd:unsignedInt",
    ],
  });
  const metrics = parse([
    {
      name: "wifi.tx_bytes",
      path: "Device.WiFi.AccessPoint.*.AssociatedDevice.*.TxBytes",
      kind: "counter",
      band: "unknown",
    },
  ]);

  const points = extractPoints("dev", data, metrics, NOW);
  const byInstance = Object.fromEntries(
    points.map((p) => [p.meta.instance, p.value]),
  );
  assert.deepStrictEqual(byInstance, { "1.1": 10, "3.1": 30, "3.2": 32 });
  assert.ok(points.every((p) => p.meta.kind === "counter"));
  assert.ok(points.every((p) => p.meta.band === "unknown"));
});

void test("reads the band from another parameter of the same instance", () => {
  const data = createDeviceData({
    "Device.WiFi.Radio.1.Channel": [6, "xsd:unsignedInt"],
    "Device.WiFi.Radio.1.OperatingFrequencyBand": ["2.4GHz", "xsd:string"],
    "Device.WiFi.Radio.2.Channel": [36, "xsd:unsignedInt"],
    "Device.WiFi.Radio.2.OperatingFrequencyBand": ["5GHz", "xsd:string"],
  });
  const metrics = parse([
    {
      name: "wifi.channel",
      path: "Device.WiFi.Radio.*.Channel",
      bandPath: "Device.WiFi.Radio.{instance}.OperatingFrequencyBand",
    },
  ]);

  const points = extractPoints("dev", data, metrics, NOW);
  const bands = Object.fromEntries(
    points.map((p) => [p.meta.instance, p.meta.band]),
  );
  assert.deepStrictEqual(bands, { "1": "2.4GHz", "2": "5GHz" });
});

void test("skips values that were not refreshed in this session", () => {
  const data = createDeviceData({
    "Device.DeviceInfo.UpTime": [100, "xsd:unsignedInt", NOW - 1],
    "Device.DeviceInfo.ProcessStatus.CPUUsage": [7, "xsd:unsignedInt", NOW],
  });
  const metrics = parse([
    { name: "system.uptime_seconds", path: "Device.DeviceInfo.UpTime" },
    {
      name: "system.cpu_percent",
      path: "Device.DeviceInfo.ProcessStatus.CPUUsage",
    },
  ]);

  const points = extractPoints("dev", data, metrics, NOW);
  assert.deepStrictEqual(
    points.map((p) => p.meta.metric),
    ["system.cpu_percent"],
  );
});

void test("ignores non numeric values and keeps zero", () => {
  const data = createDeviceData({
    "Device.DeviceInfo.SoftwareVersion": ["1.2.3", "xsd:string"],
    "Device.DeviceInfo.ProcessStatus.CPUUsage": [0, "xsd:unsignedInt"],
    "Device.Flag": [true, "xsd:boolean"],
  });
  const metrics = parse([
    { name: "system.firmware", path: "Device.DeviceInfo.SoftwareVersion" },
    {
      name: "system.cpu_percent",
      path: "Device.DeviceInfo.ProcessStatus.CPUUsage",
    },
    { name: "system.flag", path: "Device.Flag" },
  ]);

  const points = extractPoints("dev", data, metrics, NOW);
  assert.deepStrictEqual(
    points.map((p) => [p.meta.metric, p.value]),
    [
      ["system.cpu_percent", 0],
      ["system.flag", 1],
    ],
  );
});

void test("only applies metrics whose model matches", () => {
  const data = createDeviceData({
    "Device.DeviceInfo.ModelName": ["SG-XD71", "xsd:string"],
    "Device.IP.Interface.2.Stats.BytesSent": [5, "xsd:unsignedInt"],
  });
  const metrics = parse([
    {
      name: "wan.tx_bytes",
      path: "Device.IP.Interface.2.Stats.BytesSent",
      model: "sg-xd71",
    },
    {
      name: "other.tx_bytes",
      path: "Device.IP.Interface.2.Stats.BytesSent",
      model: "FAST5670",
    },
  ]);

  const points = extractPoints("dev", data, metrics, NOW);
  assert.deepStrictEqual(
    points.map((p) => p.meta.metric),
    ["wan.tx_bytes"],
  );
});

void test("rejects invalid configuration", () => {
  assert.throws(() => parseMetrics({}), /metrics/);
  assert.throws(() => parse([{ name: "a" }]), /name and path/);
  assert.throws(() => parse([{ name: "a", path: "b", kind: "x" }]), /kind/);
  assert.throws(() => parse([{ name: "a", path: "b", scale: "2" }]), /scale/);
  assert.throws(
    () =>
      parse([
        { name: "a", path: "b" },
        { name: "a", path: "b" },
      ]),
    /duplicate/,
  );
});
