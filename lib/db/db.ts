import {
  MongoClient,
  MongoServerError,
  Collection,
  GridFSBucket,
} from "mongodb";
import { get } from "../config.ts";
import * as MongoTypes from "./types.ts";

export let filesBucket: GridFSBucket;
export let uploadsBucket: GridFSBucket;

export const collections = {
  devices: null as unknown as Collection<MongoTypes.Device>,
  presets: null as unknown as Collection<MongoTypes.Preset>,
  objects: null as unknown as Collection<MongoTypes.Object>,
  provisions: null as unknown as Collection<MongoTypes.Provision>,
  virtualParameters: null as unknown as Collection<MongoTypes.VirtualParameter>,
  faults: null as unknown as Collection<MongoTypes.Fault>,
  tasks: null as unknown as Collection<MongoTypes.Task>,
  files: null as unknown as Collection<MongoTypes.File>,
  operations: null as unknown as Collection<MongoTypes.Operation>,
  permissions: null as unknown as Collection<MongoTypes.Permission>,
  users: null as unknown as Collection<MongoTypes.User>,
  config: null as unknown as Collection<MongoTypes.Config>,
  cache: null as unknown as Collection<MongoTypes.Cache>,
  locks: null as unknown as Collection<MongoTypes.Lock>,
  views: null as unknown as Collection<MongoTypes.View>,
  uploads: null as unknown as Collection<MongoTypes.Upload>,
  traces: null as unknown as Collection<MongoTypes.Trace>,
  kpi: null as unknown as Collection<MongoTypes.KpiPoint>,
  kpiHourly: null as unknown as Collection<MongoTypes.KpiHourly>,
};

let clientPromise: Promise<MongoClient>;

export async function connect(): Promise<void> {
  clientPromise = MongoClient.connect("" + get("MONGODB_CONNECTION_URL"));

  const client = await clientPromise;
  const db = client.db();

  collections.tasks = db.collection("tasks");
  collections.devices = db.collection("devices");
  collections.presets = db.collection("presets");
  collections.objects = db.collection("objects");
  collections.files = db.collection("fs.files");
  collections.provisions = db.collection("provisions");
  collections.virtualParameters = db.collection("virtualParameters");
  collections.faults = db.collection("faults");
  collections.operations = db.collection("operations");
  collections.permissions = db.collection("permissions");
  collections.users = db.collection("users");
  collections.config = db.collection("config");
  collections.cache = db.collection("cache");
  collections.locks = db.collection("locks");
  collections.views = db.collection("views");
  collections.uploads = db.collection("uploads.files");
  collections.traces = db.collection("traces");
  collections.kpi = db.collection("kpi");
  collections.kpiHourly = db.collection("kpiHourly");
  filesBucket = new GridFSBucket(db);
  uploadsBucket = new GridFSBucket(db, { bucketName: "uploads" });

  await Promise.all([
    collections.tasks.createIndex({ device: 1, timestamp: 1 }),
    collections.cache.createIndex({ expire: 1 }, { expireAfterSeconds: 0 }),
    collections.locks.createIndex({ expire: 1 }, { expireAfterSeconds: 0 }),
    collections.traces.createIndex({ device: 1, timestamp: 1 }),
    collections.traces.createIndex({ expire: 1 }, { expireAfterSeconds: 0 }),
  ]);
}

export async function disconnect(): Promise<void> {
  if (clientPromise != null) await (await clientPromise).close();
}

// MongoDB error codes: 48 NamespaceExists, 85 IndexOptionsConflict, 86 IndexKeySpecsConflict
export async function ensureKpiCollections(
  rawTtl: number,
  hourlyTtl: number,
): Promise<void> {
  const db = (await clientPromise).db();

  const existing = await db.listCollections({ name: "kpi" }).toArray();
  if (existing.length) {
    await db.command({ collMod: "kpi", expireAfterSeconds: rawTtl });
  } else {
    try {
      await db.createCollection("kpi", {
        timeseries: {
          timeField: "ts",
          metaField: "meta",
          granularity: "minutes",
        },
        expireAfterSeconds: rawTtl,
      });
    } catch (err) {
      if (!(err instanceof MongoServerError) || err.code !== 48) throw err;
    }
  }

  await collections.kpiHourly.createIndex({ device: 1, metric: 1, hour: 1 });
  try {
    await collections.kpiHourly.createIndex(
      { hour: 1 },
      { expireAfterSeconds: hourlyTtl },
    );
  } catch (err) {
    if (!(err instanceof MongoServerError)) throw err;
    if (err.code !== 85 && err.code !== 86) throw err;
    await db.command({
      collMod: "kpiHourly",
      index: { keyPattern: { hour: 1 }, expireAfterSeconds: hourlyTtl },
    });
  }
}
