import {
  MongoClient,
  MongoServerError,
  Collection,
  CollectionInfo,
  GridFSBucket,
  Document,
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
export let maxWireVersion = 0;
export let supportsTimeSeries = false;
export let supportsAdvancedKpiRollup = false;

export async function connect(): Promise<void> {
  clientPromise = MongoClient.connect("" + get("MONGODB_CONNECTION_URL"));

  const client = await clientPromise;
  const handshake = await client.db().admin().command({ isMaster: 1 });
  maxWireVersion = handshake.maxWireVersion as number;
  supportsTimeSeries = maxWireVersion >= 13;
  supportsAdvancedKpiRollup = maxWireVersion >= 14;
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

async function ensureTtlIndex<T extends Document>(
  collection: Collection<T>,
  field: string,
  ttl: number,
): Promise<void> {
  const indexes = await collection.listIndexes().toArray();
  const index = indexes.find(
    (i) => i.key[field] === 1 && Object.keys(i.key).length === 1,
  );

  if (index?.expireAfterSeconds === ttl) return;
  if (index) await collection.dropIndex(index.name);
  await collection.createIndex({ [field]: 1 }, { expireAfterSeconds: ttl });
}

// MongoDB error codes: 48 NamespaceExists, 85 IndexOptionsConflict, 86 IndexKeySpecsConflict
export async function ensureKpiCollections(
  rawTtl: number,
  hourlyTtl: number,
): Promise<void> {
  const db = (await clientPromise).db();

  let existing = await db.listCollections({ name: "kpi" }).toArray();
  if (!existing.length) {
    try {
      if (supportsTimeSeries) {
        await db.createCollection("kpi", {
          timeseries: {
            timeField: "ts",
            metaField: "meta",
            granularity: "minutes",
          },
          expireAfterSeconds: rawTtl,
        });
      } else {
        await db.createCollection("kpi");
      }
    } catch (err) {
      if (!(err instanceof MongoServerError) || err.code !== 48) throw err;
    }
    existing = await db.listCollections({ name: "kpi" }).toArray();
  }

  const kpiCollection = existing[0] as CollectionInfo | undefined;
  if (kpiCollection?.options?.timeseries) {
    if (kpiCollection.options.expireAfterSeconds !== rawTtl)
      await db.command({ collMod: "kpi", expireAfterSeconds: rawTtl });
  } else {
    await ensureTtlIndex(collections.kpi, "ts", rawTtl);
  }

  await collections.kpiHourly.createIndex({ device: 1, metric: 1, hour: 1 });
  await ensureTtlIndex(collections.kpiHourly, "hour", hourlyTtl);
}
