if (typeof Symbol.dispose !== "symbol") {
  Object.defineProperty(Symbol, "dispose", {
    configurable: true,
    value: Symbol.for("Symbol.dispose"),
  });
}

export class DisposableStackFallback {
  #cleanups: (() => void)[] = [];
  #disposed = false;

  get disposed(): boolean {
    return this.#disposed;
  }

  use<T extends Disposable | null | undefined>(value: T): T {
    if (value == null) return value;
    this.#assertNotDisposed();
    this.#cleanups.push(() => value[Symbol.dispose]());
    return value;
  }

  defer(onDispose: () => void): void {
    this.#assertNotDisposed();
    this.#cleanups.push(onDispose);
  }

  [Symbol.dispose](): void {
    if (this.#disposed) return;
    this.#disposed = true;

    let firstError: unknown;
    while (this.#cleanups.length) {
      try {
        this.#cleanups.pop()!();
      } catch (err) {
        firstError ??= err;
      }
    }
    if (firstError) throw firstError;
  }

  #assertNotDisposed(): void {
    if (this.#disposed) throw new ReferenceError("DisposableStack is disposed");
  }
}

if (typeof globalThis.DisposableStack !== "function") {
  Object.defineProperty(globalThis, "DisposableStack", {
    configurable: true,
    value: DisposableStackFallback,
    writable: true,
  });
}
