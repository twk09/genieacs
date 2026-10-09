import assert from "node:assert/strict";
import test from "node:test";
import { DisposableStackFallback } from "../ui/runtime-compat.ts";

void test("DisposableStack fallback disposes resources in reverse order", () => {
  const stack = new DisposableStackFallback();
  const disposed: string[] = [];

  stack.use({ [Symbol.dispose]: () => disposed.push("resource") });
  stack.defer(() => disposed.push("cleanup"));

  assert.equal(stack.disposed, false);
  stack[Symbol.dispose]();
  stack[Symbol.dispose]();

  assert.deepStrictEqual(disposed, ["cleanup", "resource"]);
  assert.equal(stack.disposed, true);
  assert.throws(() => stack.defer(() => {}), ReferenceError);
});

void test("DisposableStack fallback ignores nullish resources", () => {
  const stack = new DisposableStackFallback();
  assert.equal(stack.use(null), null);
  assert.equal(stack.use(undefined), undefined);
  stack[Symbol.dispose]();
});
