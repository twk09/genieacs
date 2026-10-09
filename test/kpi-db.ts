import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { CollectionInfo, MongoClient } from "mongodb";

const connectionString = process.env.GENIEACS_MONGODB_TEST_URL;

void test(
  "KPI storage and aggregations work on MongoDB 4.4 and 7.0",
  { skip: !connectionString },
  async () => {
    if (!connectionString) return;

    const databaseName = new URL(connectionString).pathname.slice(1);
    assert.match(
      databaseName,
      /_test$/,
      "test URL must target a *_test database",
    );

    process.env.GENIEACS_MONGODB_CONNECTION_URL = connectionString;
    process.env.GENIEACS_KPI_CONFIG_FILE = resolve(
      process.cwd(),
      "test/kpi-config.json",
    );

    const db = await import("../lib/db/db.ts");
    const cache = await import("../lib/cache.ts");
    const kpi = await import("../lib/kpi-store.ts");
    const Expression = (await import("../lib/common/expression.ts")).default;

    const testClient = await MongoClient.connect(connectionString);
    await db.connect();
    const database = testClient.db();
    try {
      await database.dropDatabase();
      assert.ok(
        [9, 21].includes(db.maxWireVersion),
        `unexpected MongoDB wire version: ${db.maxWireVersion}`,
      );

      const rawTtl = 10 * 365 * 24 * 3600;
      await db.ensureKpiCollections(rawTtl, rawTtl);
      const kpiCollection = (
        await database.listCollections({ name: "kpi" }).toArray()
      )[0] as CollectionInfo | undefined;
      assert.ok(kpiCollection);
      assert.equal(
        Boolean(kpiCollection.options?.timeseries),
        db.supportsTimeSeries,
      );

      const from = Date.UTC(2025, 0, 1);
      const hour = 3600 * 1000;
      const at = (minutes: number): Date =>
        new Date(from + minutes * 60 * 1000);
      await db.collections.devices.insertOne({
        _id: "compat-test-device",
        _lastInform: at(0),
        _registered: at(0),
        _deviceId: { _ProductClass: "CompatRouter" },
        Device: { DeviceInfo: { ModelName: { _value: "CompatRouter" } } },
      } as unknown as Parameters<typeof db.collections.devices.insertOne>[0]);

      await db.collections.kpi.insertMany([
        ...[
          [10, 10],
          [50, 30],
          [70, 50],
        ].map(([minutes, value]) => ({
          ts: at(minutes),
          meta: {
            device: "compat-test-device",
            metric: "integration.load",
            instance: "",
            band: "",
            kind: "gauge" as const,
          },
          value,
        })),
        ...[
          [5, 100],
          [20, 160],
          [65, 200],
          [80, 250],
        ].map(([minutes, value]) => ({
          ts: at(minutes),
          meta: {
            device: "compat-test-device",
            metric: "integration.bytes",
            instance: "",
            band: "",
            kind: "counter" as const,
          },
          value,
        })),
      ]);

      await kpi.rollupHourlyCompatible(from, from + 2 * hour);
      const compatibleHourly = await db.collections.kpiHourly
        .find({ device: "compat-test-device" })
        .sort({ hour: 1, metric: 1 })
        .toArray();
      assert.equal(compatibleHourly.length, 4);
      assert.equal(
        compatibleHourly.find((item) => item.metric === "integration.load")
          ?.avg,
        20,
      );

      await cache.set("kpi-rollup-watermark", String(from), rawTtl);
      await kpi.rollupHourly(from + 2 * hour + 10 * 60 * 1000);

      const hourly = await db.collections.kpiHourly
        .find({ device: "compat-test-device" })
        .sort({ hour: 1, metric: 1 })
        .toArray();
      assert.equal(hourly.length, 4);
      assert.equal(
        hourly.find((item) => item.metric === "integration.load")?.avg,
        20,
      );
      assert.equal(
        hourly.find(
          (item) =>
            item.metric === "integration.bytes" && item.hour.getTime() === from,
        )?.increase,
        60,
      );
      assert.equal(
        hourly.find(
          (item) =>
            item.metric === "integration.bytes" &&
            item.hour.getTime() === from + hour,
        )?.increase,
        90,
      );

      const daily = await kpi.queryKpi(
        "compat-test-device",
        from,
        from + 61 * 24 * hour,
      );
      assert.equal(daily.resolution, "day");
      assert.equal(
        daily.series.find((series) => series.metric === "integration.load")
          ?.points[0][1],
        35,
      );

      const fleet = await kpi.queryFleetKpis(
        Expression.parse("true"),
        "integration.load",
        from,
        from + 2 * hour,
      );
      assert.equal(fleet.totalDevices, 1);
      assert.equal(fleet.productClasses[0].productClass, "CompatRouter");
      assert.deepStrictEqual(
        fleet.series[0].points.map((point) => point[1]),
        [10, 30, 50],
      );
    } finally {
      try {
        await database.dropDatabase();
      } finally {
        try {
          await db.disconnect();
        } finally {
          await testClient.close();
        }
      }
    }
  },
);
