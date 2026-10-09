import { ClosureComponent, VnodeDOM } from "../mithril-compat.ts";
import { m } from "../components.ts";
import { getKpis, KpiResult, KpiSeries, updateTags } from "../api-client.ts";
import { FlatDevice } from "../../lib/ui/db.ts";
import type { Chart as ChartInstance, ChartConfiguration } from "chart.js";
import * as notifications from "../notifications.ts";
import * as store from "../legacy-store.ts";
import { invalidate } from "../reactive-store.ts";

type ChartConstructor = typeof import("chart.js/auto").default;
type ChartPoint = { x: number; y: number };

interface Attrs {
  device: FlatDevice;
}

const RANGES = [
  { label: "2h", milliseconds: 2 * 60 * 60 * 1000 },
  { label: "24h", milliseconds: 24 * 60 * 60 * 1000 },
  { label: "7d", milliseconds: 7 * 24 * 60 * 60 * 1000 },
  { label: "30d", milliseconds: 30 * 24 * 60 * 60 * 1000 },
  { label: "1y", milliseconds: 365 * 24 * 60 * 60 * 1000 },
];
const COLORS = ["#4f8793", "#70927d", "#bd8c62", "#7889a0", "#a87c8e"];
const BUTTON_CLASS =
  "px-2.5 py-1.5 border text-xs font-medium rounded-sm focus:outline-hidden focus:ring-2 focus:ring-cyan-500";
const POLL_INTERVAL = 60000;

let ChartModule: ChartConstructor | null = null;

const component: ClosureComponent<Attrs> = () => {
  let deviceId = "";
  let canvas: HTMLCanvasElement | null = null;
  let chart: ChartInstance<"line", ChartPoint[]> | null = null;
  let result: KpiResult | null = null;
  let rangeIndex = 1;
  let selectedMetric = "";
  let loading = true;
  let error = "";
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let requestId = 0;
  let paused = false;
  let savingPause = false;

  function destroyChart(): void {
    chart?.destroy();
    chart = null;
  }

  function renderChart(): void {
    if (!canvas || !ChartModule || !result) return destroyChart();
    const series = result.series.filter((s) => s.metric === selectedMetric);
    if (!series.length) return destroyChart();

    destroyChart();
    const config: ChartConfiguration<"line", ChartPoint[]> = {
      type: "line",
      data: {
        datasets: series.map((s, index) => ({
          label: `${s.band && s.band !== "unknown" ? `${s.band} ` : ""}${s.instance || s.metric}`,
          data: s.points.map(([x, y]) => ({ x, y })),
          borderColor: COLORS[index % COLORS.length],
          backgroundColor: COLORS[index % COLORS.length],
          borderWidth: 2,
          pointRadius: s.points.length > 100 ? 0 : 2,
          pointHoverRadius: 4,
          tension: 0.15,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        parsing: false,
        interaction: { mode: "nearest", intersect: false },
        plugins: {
          legend: { display: series.length > 1, position: "bottom" },
          tooltip: {
            callbacks: {
              title: (items) =>
                items.length
                  ? new Date(Number(items[0].parsed.x)).toLocaleString()
                  : "",
            },
          },
        },
        scales: {
          x: {
            type: "linear",
            min: Date.now() - RANGES[rangeIndex].milliseconds,
            max: Date.now(),
            ticks: {
              maxTicksLimit: 7,
              callback: (value) =>
                new Date(Number(value)).toLocaleDateString([], {
                  month: "short",
                  day: "numeric",
                }),
            },
          },
          y: {
            title: { display: !!series[0].unit, text: series[0].unit },
          },
        },
      },
    };

    chart = new ChartModule(canvas, config);
  }

  async function refresh(): Promise<void> {
    if (!deviceId || paused) return;
    const currentRequest = ++requestId;
    controller?.abort();
    controller = new AbortController();
    loading = true;
    error = "";
    try {
      if (!ChartModule) ChartModule = (await import("chart.js/auto")).default;
      const to = Date.now();
      const from = to - RANGES[rangeIndex].milliseconds;
      const data = await getKpis(deviceId, from, to, controller.signal);
      if (currentRequest !== requestId) return;
      result = data;
      const metrics = Array.from(new Set(data.series.map((s) => s.metric)));
      if (!metrics.includes(selectedMetric)) selectedMetric = metrics[0] || "";
      loading = false;
      renderChart();
    } catch (err) {
      if (controller.signal.aborted || currentRequest !== requestId) return;
      error = err instanceof Error ? err.message : String(err);
      loading = false;
      destroyChart();
    }
    m.redraw();
  }

  function start(device: string, disabled: boolean): void {
    deviceId = device;
    paused = disabled;
    result = null;
    selectedMetric = "";
    rangeIndex = 1;
    if (paused) {
      loading = false;
      return;
    }
    void refresh();
    timer = setInterval(() => void refresh(), POLL_INTERVAL);
  }

  function stop(): void {
    if (timer) clearInterval(timer);
    timer = null;
    controller?.abort();
    destroyChart();
  }

  function selectRange(index: number): void {
    if (paused) return;
    rangeIndex = index;
    void refresh();
  }

  function selectMetric(event: Event): void {
    if (paused) return;
    selectedMetric = (event.currentTarget as HTMLSelectElement).value;
    renderChart();
  }

  function setPaused(event: Event): void {
    const disabled = (event.currentTarget as HTMLInputElement).checked;
    savingPause = true;
    updateTags(deviceId, { "kpi-disabled": disabled })
      .then(() => {
        paused = disabled;
        if (paused) {
          stop();
          result = null;
          loading = false;
        } else {
          void refresh();
          timer = setInterval(() => void refresh(), POLL_INTERVAL);
        }
        store.setTimestamp(Date.now());
        invalidate(Date.now());
        notifications.push(
          "success",
          `${deviceId}: KPI collection ${paused ? "paused" : "resumed"}`,
        );
      })
      .catch((err) => {
        notifications.push("error", `${deviceId}: ${err.message}`);
      })
      .finally(() => {
        savingPause = false;
        m.redraw();
      });
  }

  function renderSeries(series: KpiSeries[]): any {
    if (paused)
      return "KPI collection is paused. Existing history is hidden until resumed.";
    const metrics = Array.from(new Set(series.map((s) => s.metric)));
    if (loading && !result) return "Loading KPI history...";
    if (!metrics.length)
      return "No KPI samples yet. Wait for the next modem Inform.";
    return null;
  }

  return {
    onremove: stop,
    view: (vnode) => {
      const id = vnode.attrs.device["DeviceID.ID"] as string;
      const devicePaused = !!vnode.attrs.device["Tags.kpi-disabled"];
      if (id !== deviceId) {
        stop();
        start(id, devicePaused);
      } else if (devicePaused !== paused && !savingPause) {
        stop();
        start(id, devicePaused);
      }

      const series = result?.series || [];
      const metrics = Array.from(new Set(series.map((s) => s.metric)));
      const emptyMessage = renderSeries(series);

      return m(
        "section",
        { class: "my-4 border border-stone-100 rounded-md bg-white shadow-xs" },
        m(
          "div",
          {
            class:
              "flex flex-wrap items-center gap-2 px-3 py-2 border-b border-stone-100",
          },
          m(
            "h3",
            { class: "text-sm font-medium text-stone-900 mr-2" },
            "KPI history",
          ),
          m(
            "label.flex items-center gap-2 text-xs text-stone-600",
            m("input.h-4 w-4 accent-cyan-700", {
              type: "checkbox",
              checked: paused,
              disabled:
                savingPause || !window.authorizer.hasAccess("devices", 3),
              onchange: setPaused,
              "aria-label": "Pause KPI collection for this device",
            }),
            "Pause collection",
          ),
          metrics.length
            ? m(
                "select",
                {
                  class:
                    "max-w-full border border-stone-300 rounded-sm bg-white px-2 py-1 text-xs text-stone-800",
                  value: selectedMetric,
                  disabled: paused,
                  onchange: selectMetric,
                  "aria-label": "KPI metric",
                },
                metrics.map((metric) => m("option", { value: metric }, metric)),
              )
            : null,
          m("span", { class: "ml-auto" }),
          ...RANGES.map((range, index) =>
            m(
              "button",
              {
                type: "button",
                disabled: paused,
                class: `${BUTTON_CLASS} ${
                  rangeIndex === index
                    ? "border-cyan-200 bg-cyan-50 text-cyan-800"
                    : "border-stone-200 bg-white text-stone-600 hover:bg-stone-50"
                }`,
                onclick: () => selectRange(index),
              },
              range.label,
            ),
          ),
        ),
        error
          ? m("div", { class: "px-3 py-2 text-sm text-red-700" }, error)
          : null,
        emptyMessage
          ? m(
              "div",
              { class: "px-3 py-8 text-center text-sm text-stone-500" },
              emptyMessage,
            )
          : null,
        m(
          "div",
          {
            class: "relative h-72 px-3 py-3",
            style: emptyMessage ? "display:none" : "",
          },
          m("canvas", {
            oncreate: (node: VnodeDOM) => {
              canvas = node.dom as HTMLCanvasElement;
              renderChart();
            },
            onremove: () => {
              canvas = null;
            },
          }),
          loading
            ? m(
                "div",
                {
                  class:
                    "absolute inset-0 flex items-center justify-center bg-white/70 text-xs text-stone-500",
                },
                "Updating...",
              )
            : null,
        ),
        result?.resolution
          ? m(
              "div",
              { class: "px-3 pb-2 text-right text-xs text-stone-500" },
              `Resolution: ${result.resolution} · refreshes every minute`,
            )
          : null,
      );
    },
  };
};

export default component;
