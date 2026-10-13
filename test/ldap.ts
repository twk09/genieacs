import assert from "node:assert/strict";
import test from "node:test";
import { clientOptionsForUrl } from "../lib/ldap.ts";

void test("LDAP URLs do not enable implicit TLS", () => {
  assert.deepStrictEqual(
    clientOptionsForUrl("ldap://127.0.0.1:389", 5000, true),
    {
      url: "ldap://127.0.0.1:389",
      timeout: 5000,
      connectTimeout: 5000,
    },
  );
});

void test("LDAPS URLs receive TLS certificate validation options", () => {
  assert.deepStrictEqual(
    clientOptionsForUrl("ldaps://ldap.example.test:636", 5000, true),
    {
      url: "ldaps://ldap.example.test:636",
      timeout: 5000,
      connectTimeout: 5000,
      tlsOptions: { rejectUnauthorized: true },
    },
  );
});
