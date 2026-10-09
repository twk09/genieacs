import * as cache from "./cache.ts";

// Tracing only lasts while a browser keeps renewing the lease by polling
const LEASE_MS = 10000;

function leaseKey(deviceId: string): string {
  return `debug-trace-${deviceId}`;
}

export async function renewTraceLease(deviceId: string): Promise<void> {
  // The cache TTL index is only swept about once a minute, so expiry is stored in the value
  await cache.set(leaseKey(deviceId), String(Date.now() + LEASE_MS), 60);
}

export async function releaseTraceLease(deviceId: string): Promise<void> {
  await cache.del(leaseKey(deviceId));
}

export async function isTracing(deviceId: string): Promise<boolean> {
  const expiry = await cache.get(leaseKey(deviceId));
  return expiry != null && Number(expiry) > Date.now();
}
