import { ClosureComponent } from "../mithril-compat.ts";
import { m } from "../components.ts";
import { getTraces, stopTraces, HttpError, TraceEntry } from "../api-client.ts";
import { getClockSkew } from "../skewed-date.ts";
import { FlatDevice } from "../../lib/ui/db.ts";

const POLL_INTERVAL = 2000;
// Entries inserted by other workers can land slightly out of order
const CURSOR_OVERLAP = 2000;
const MAX_ENTRIES = 500;

interface Attrs {
  device: FlatDevice;
}

const EVENTS: Record<string, { label: string; fromDevice: boolean }> = {
  "incoming HTTP request": { label: "CPE \u2192 ACS", fromDevice: true },
  "outgoing HTTP response": { label: "ACS \u2192 CPE", fromDevice: false },
  "outgoing HTTP request": {
    label: "ACS \u2192 CPE (conn. request)",
    fromDevice: false,
  },
  "incoming HTTP response": {
    label: "CPE \u2192 ACS (conn. request)",
    fromDevice: true,
  },
  "outgoing UDP message": {
    label: "ACS \u2192 CPE (UDP)",
    fromDevice: false,
  },
  "outgoing XMPP stanza": {
    label: "ACS \u2192 CPE (XMPP)",
    fromDevice: false,
  },
  "incoming XMPP stanza": {
    label: "CPE \u2192 ACS (XMPP)",
    fromDevice: true,
  },
};

function rpcName(entry: TraceEntry): string {
  if (entry.error) return `Error: ${entry.error}`;
  if (entry.body == null) return "";
  if (!entry.body.trim()) return "(empty)";
  const match = entry.body.match(
    /<(?:[\w-]+:)?Body[^>]*>\s*<(?:[\w-]+:)?([\w.-]+)/,
  );
  return match ? match[1] : "";
}

function formatXml(xml: string): string {
  if (!xml.startsWith("<") || xml.length > 200000) return xml;
  let depth = 0;
  return xml
    .replace(/>\s*</g, ">\n<")
    .split("\n")
    .map((line) => {
      if (/^<\//.test(line)) depth = Math.max(0, depth - 1);
      const out = "  ".repeat(depth) + line;
      if (/^<[^!?/][^>]*[^/]>$/.test(line)) depth++;
      return out;
    })
    .join("\n");
}

function formatTime(timestamp: string): string {
  const d = new Date(timestamp);
  return (
    d.toLocaleTimeString([], { hour12: false }) +
    "." +
    String(d.getMilliseconds()).padStart(3, "0")
  );
}

const BUTTON_CLASS =
  "px-2.5 py-1.5 border text-xs font-medium rounded-sm focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:opacity-50";

const component: ClosureComponent<Attrs> = () => {
  let timer: ReturnType<typeof setInterval> | null = null;
  let controller: AbortController | null = null;
  let deviceId = "";
  let entries: TraceEntry[] = [];
  const seen = new Set<string>();
  const expanded = new Set<string>();
  let cursor = 0;
  let live = false;
  let error = "";

  function stopPolling(): void {
    if (timer) clearInterval(timer);
    timer = null;
    controller?.abort();
    controller = null;
  }

  // The server stops capturing on its own a few seconds after the last poll
  function stopLive(): void {
    stopPolling();
    if (!live) return;
    live = false;
    stopTraces(deviceId).catch(() => null);
  }

  function reset(id: string): void {
    stopLive();
    deviceId = id;
    entries = [];
    seen.clear();
    expanded.clear();
    cursor = 0;
  }

  function poll(): void {
    if (!live || !deviceId) return;
    controller?.abort();
    const ctl = new AbortController();
    controller = ctl;
    getTraces(deviceId, cursor - CURSOR_OVERLAP, ctl.signal)
      .then((res) => {
        for (const t of res) {
          if (seen.has(t._id)) continue;
          seen.add(t._id);
          entries.push(t);
          cursor = Math.max(cursor, new Date(t.timestamp).getTime());
        }
        if (entries.length > MAX_ENTRIES) {
          for (const t of entries.slice(0, entries.length - MAX_ENTRIES)) {
            seen.delete(t._id);
            expanded.delete(t._id);
          }
          entries = entries.slice(-MAX_ENTRIES);
        }
        error = "";
        m.redraw();
      })
      .catch((err) => {
        if (ctl.signal.aborted) return;
        error = err.message;
        if (err instanceof HttpError && err.code === 403) {
          live = false;
          stopPolling();
        }
        m.redraw();
      });
  }

  function startLive(): void {
    live = true;
    entries = [];
    seen.clear();
    expanded.clear();
    error = "";
    // Only show what happens from now on, using the server's clock
    cursor = Date.now() + getClockSkew();
    poll();
    timer = setInterval(poll, POLL_INTERVAL);
  }

  function renderEntry(entry: TraceEntry): any {
    const info = EVENTS[entry.event] || {
      label: entry.event,
      fromDevice: false,
    };
    const isOpen = expanded.has(entry._id);
    const detail = entry.statusCode
      ? `HTTP ${entry.statusCode}`
      : [entry.method, entry.url].filter(Boolean).join(" ");

    return m(
      "div",
      { class: "border-b border-stone-100 last:border-b-0", key: entry._id },
      m(
        "button",
        {
          class:
            "w-full text-left px-3 py-2 flex items-center gap-3 text-xs text-stone-700 hover:bg-stone-50/80",
          onclick: () => {
            if (isOpen) expanded.delete(entry._id);
            else expanded.add(entry._id);
          },
        },
        m(
          "span",
          { class: "font-mono text-stone-500 shrink-0" },
          formatTime(entry.timestamp),
        ),
        m(
          "span",
          {
            class: `shrink-0 px-2 py-0.5 rounded-full font-medium ${
              info.fromDevice
                ? "bg-cyan-50 text-cyan-800"
                : "bg-stone-100 text-stone-700"
            }`,
          },
          info.label,
        ),
        m("span", { class: "font-medium text-stone-800" }, rpcName(entry)),
        m("span", { class: "text-stone-500 truncate" }, detail),
      ),
      isOpen
        ? m(
            "div",
            { class: "px-3 pb-3" },
            entry.remoteAddress
              ? m(
                  "div",
                  { class: "text-xs text-stone-500 mb-1" },
                  `Remote address: ${entry.remoteAddress}`,
                )
              : null,
            entry.headers?.length
              ? m(
                  "dl",
                  { class: "text-xs font-mono mb-2" },
                  entry.headers.map(([k, v]) =>
                    m(
                      "div",
                      { class: "flex gap-2" },
                      m("dt", { class: "text-stone-500 shrink-0" }, `${k}:`),
                      m("dd", { class: "text-stone-900 break-all" }, v),
                    ),
                  ),
                )
              : null,
            entry.body
              ? m(
                  "pre",
                  {
                    class:
                      "p-2 bg-stone-900 text-stone-100 text-xs overflow-auto max-h-96 rounded-sm",
                  },
                  formatXml(entry.body),
                )
              : null,
            entry.truncated
              ? m(
                  "div",
                  { class: "text-xs text-red-600 mt-1" },
                  "Body truncated (see DEBUG_TRACE_MAX_BODY)",
                )
              : null,
          )
        : null,
    );
  }

  function downloadTxt(): void {
    if (!entries.length) return;

    const content = entries
      .map((entry) => {
        const info = EVENTS[entry.event] || {
          label: entry.event,
          fromDevice: false,
        };
        const lines = [
          `Timestamp: ${new Date(entry.timestamp).toISOString()}`,
          `Direction: ${info.label}`,
          `Event: ${entry.event}`,
          entry.remoteAddress ? `Remote address: ${entry.remoteAddress}` : "",
          entry.method ? `Method: ${entry.method}` : "",
          entry.url ? `URL: ${entry.url}` : "",
          entry.statusCode ? `Status: HTTP ${entry.statusCode}` : "",
          entry.error ? `Error: ${entry.error}` : "",
          entry.headers?.length
            ? `Headers:\n${entry.headers.map(([k, v]) => `${k}: ${v}`).join("\n")}`
            : "",
          entry.body != null ? `Body:\n${formatXml(entry.body)}` : "",
          entry.truncated ? "Body truncated" : "",
        ];
        return lines.filter(Boolean).join("\n");
      })
      .join("\n\n---\n\n");

    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const safeDeviceId = deviceId.replace(/[^a-z0-9._-]+/gi, "_");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    anchor.href = url;
    anchor.download = `genieacs-trace-${safeDeviceId}-${timestamp}.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return {
    onremove: stopLive,
    view: (vnode) => {
      const device = vnode.attrs.device;
      const id = device["DeviceID.ID"] as string;

      if (id !== deviceId) reset(id);

      return m(
        "div",
        { class: "my-4 border border-stone-100 rounded-md bg-white shadow-xs" },
        m(
          "div",
          {
            class:
              "flex flex-wrap items-center gap-2 px-3 py-2 border-b border-stone-100",
          },
          m("h3", { class: "text-sm font-medium text-stone-900" }, "Debug"),
          m(
            "span",
            { class: "text-xs text-stone-500" },
            live
              ? "Live · stops when you leave this page"
              : "Off · captures only while this panel is live",
          ),
          m("span", { class: "ml-auto" }),
          m(
            "button",
            {
              class: `${BUTTON_CLASS} bg-white text-stone-700 border-stone-300 hover:bg-stone-50`,
              onclick: () => {
                entries = [];
                expanded.clear();
              },
            },
            "Clear",
          ),
          entries.length
            ? m(
                "button",
                {
                  class: `${BUTTON_CLASS} bg-white text-stone-700 border-stone-300 hover:bg-stone-50`,
                  onclick: downloadTxt,
                  title:
                    "Download the traces received in this live view as a text file",
                },
                "Download TXT",
              )
            : null,
          m(
            "button",
            {
              class: `${BUTTON_CLASS} ${
                live
                  ? "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                  : "border-cyan-200 bg-cyan-50 text-cyan-800 hover:bg-cyan-100"
              }`,
              onclick: () => {
                if (live) stopLive();
                else startLive();
              },
            },
            live ? "Stop live trace" : "Start live trace",
          ),
        ),
        error
          ? m("div", { class: "px-3 py-2 text-xs text-red-600" }, error)
          : null,
        entries.length
          ? m(
              "div",
              { class: "max-h-[32rem] overflow-y-auto" },
              entries.slice().reverse().map(renderEntry),
            )
          : m(
              "div",
              { class: "px-3 py-4 text-xs text-stone-500" },
              live
                ? "No messages yet. Use Summon or wait for the next inform."
                : "Start the live trace to see the messages exchanged with this device.",
            ),
      );
    },
  };
};

export default component;
