import test from "node:test";
import assert from "node:assert";
import { buildTrace } from "../lib/trace.ts";

void test("builds a trace with expiry and ordered headers", () => {
  const timestamp = new Date(1000);
  const trace = buildTrace(
    {
      event: "incoming HTTP request",
      timestamp,
      remoteAddress: "10.0.0.1",
      deviceId: "dev-1",
      method: "POST",
      url: "/",
      headers: { "content-type": "text/xml", "set-cookie": ["a=1", "b=2"] },
      body: "<soap/>",
    },
    5000,
    100,
  );

  assert.deepStrictEqual(trace, {
    device: "dev-1",
    timestamp,
    expire: new Date(6000),
    event: "incoming HTTP request",
    remoteAddress: "10.0.0.1",
    method: "POST",
    url: "/",
    headers: [
      ["content-type", "text/xml"],
      ["set-cookie", "a=1, b=2"],
    ],
    body: "<soap/>",
  });
});

void test("ignores messages that are not tied to a device", () => {
  assert.strictEqual(
    buildTrace({ event: "client error", deviceId: null }, 1000, 100),
    null,
  );
});

void test("truncates large bodies", () => {
  const trace = buildTrace(
    { event: "outgoing HTTP response", deviceId: "d", body: "x".repeat(50) },
    1000,
    10,
  );

  assert.strictEqual(trace?.body, "x".repeat(10));
  assert.strictEqual(trace?.truncated, true);
});

void test("redacts basic credentials but keeps digest headers", () => {
  const basic = buildTrace(
    {
      event: "incoming HTTP request",
      deviceId: "d",
      headers: { authorization: "Basic YWRtaW46YWRtaW4=" },
    },
    1000,
    100,
  );
  assert.deepStrictEqual(basic?.headers, [
    ["authorization", "Basic [redacted]"],
  ]);

  const digest = buildTrace(
    {
      event: "incoming HTTP request",
      deviceId: "d",
      headers: { authorization: 'Digest username="admin"' },
    },
    1000,
    100,
  );
  assert.deepStrictEqual(digest?.headers, [
    ["authorization", 'Digest username="admin"'],
  ]);
});
