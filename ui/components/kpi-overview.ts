import { ClosureComponent, VnodeDOM } from "../mithril-compat.ts";
import { m } from "../components.ts";
import { FleetKpiOverview, getFleetKpis } from "../api-client.ts";
import type { Chart as ChartInstance, ChartConfiguration } from "chart.js";

type ChartConstructor = typeof import("chart.js/auto").default;
type ChartPoint = { x: number; y: number };
type AnyChart =
  | ChartInstance<"doughnut", number[], string>
  | ChartInstance<"line", ChartPoint[]>;

const RANGES = [
  { label: "24h", milliseconds: 24 * 60 * 60 * 1000 },
  { label: "7d", milliseconds: 7 * 24 * 60 * 60 * 1000 },
  { label: "30d", milliseconds: 30 * 24 * 60 * 60 * 1000 },
  { label: "1y", milliseconds: 365 * 24 * 60 * 60 * 1000 },
];
const COLORS = [
  "#4f8793",
  "#70927d",
  "#bd8c62",
  "#7889a0",
  "#a87c8e",
  "#92936c",
  "#628c82",
  "#9b806f",
  "#7587a0",
  "#aa7582",
];
const BUTTON_CLASS =
  "px-2.5 py-1.5 border text-xs font-medium rounded-sm focus:outline-hidden focus:ring-2 focus:ring-cyan-500";
const MAX_PRODUCT_LINES = 8;
const METRIC_LABELS: Record<string, string> = {
  "system.cpu_percent": "CPU usage",
  "system.memory_free_mib": "Free memory",
  "system.uptime_seconds": "Uptime",
  "wifi.channel": "Wi-Fi channel",
  "wifi.clients": "Wi-Fi clients",
  "wifi.noise_dbm": "Wi-Fi noise",
};

interface Attrs {
  [key: string]: never;
}

let ChartModule: ChartConstructor | null = null;

const component: ClosureComponent<Attrs> = () => {
  let data: FleetKpiOverview | null = null;
  let fromIndex = 0;
  let metric = "";
  let productFilter = "*";
  let loading = true;
  let error = "";
  let requestId = 0;
  let started = false;
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let productCanvas: HTMLCanvasElement | null = null;
  let trendCanvas: HTMLCanvasElement | null = null;
  let productChart: AnyChart | null = null;
  let trendChart: AnyChart | null = null;

  function destroyCharts(): void {
    productChart?.destroy();
    trendChart?.destroy();
    productChart = null;
    trendChart = null;
  }

  function drawCharts(): void {
    if (!ChartModule || !data) return destroyCharts();
    destroyCharts();
    const metricUnit = data.unit;

    const products = data.productClasses;
    if (productCanvas && products.length) {
      const visible = products.slice(0, 19);
      const otherCount = products
        .slice(19)
        .reduce((sum, product) => sum + product.devices, 0);
      const labels = visible.map((p) => p.productClass);
      const counts = visible.map((p) => p.devices);
      if (otherCount) {
        labels.push("Other");
        counts.push(otherCount);
      }
      productChart = new ChartModule(productCanvas, {
        type: "doughnut",
        data: {
          labels,
          datasets: [
            {
              data: counts,
              backgroundColor: labels.map(
                (_, index) => COLORS[index % COLORS.length],
              ),
              borderColor: "#ffffff",
              borderWidth: 2,
              hoverOffset: 3,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: "68%",
          plugins: {
            legend: {
              position: "right",
              labels: { boxWidth: 10, padding: 12 },
            },
            tooltip: {
              callbacks: {
                label: (item) => `${item.label}: ${item.formattedValue}`,
              },
            },
          },
        },
      }) as AnyChart;
    }

    if (!trendCanvas || !data.series.length) return;
    const chosen =
      productFilter === "*"
        ? data.series.slice(0, MAX_PRODUCT_LINES)
        : data.series.filter((series) => series.productClass === productFilter);
    if (!chosen.length) return;

    const lineData: ChartConfiguration<"line", ChartPoint[]> = {
      type: "line" as const,
      data: {
        datasets: chosen.map((series, index) => ({
          label: series.productClass,
          data: series.points.map(([x, y]) => ({ x, y })),
          borderColor: COLORS[index % COLORS.length],
          backgroundColor: COLORS[index % COLORS.length],
          borderWidth: 2,
          pointRadius: series.points.length > 100 ? 0 : 2,
          pointHoverRadius: 4,
          tension: 0.15,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        parsing: false,
        interaction: { mode: "nearest" as const, intersect: false },
        plugins: {
          legend: { position: "bottom" as const },
          tooltip: {
            callbacks: {
              label: (context) =>
                `${context.dataset.label}: ${context.formattedValue}${metricUnit ? ` ${metricUnit}` : ""}`,
            },
          },
        },
        scales: {
          x: {
            type: "linear" as const,
            min: Date.now() - RANGES[fromIndex].milliseconds,
            max: Date.now(),
            border: { display: false },
            ticks: {
              color: "#78716c",
              maxTicksLimit: 7,
              callback: (value: string | number) => {
                const date = new Date(Number(value));
                if (RANGES[fromIndex].milliseconds <= 24 * 60 * 60 * 1000)
                  return date.toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                return date.toLocaleDateString([], {
                  month: "short",
                  day: "numeric",
                });
              },
            },
            grid: { color: "#f1efed" },
          },
          y: {
            border: { display: false },
            title: { display: !!metricUnit, text: metricUnit },
            ticks: { color: "#78716c" },
            grid: { color: "#f1efed" },
          },
        },
      },
    };
    trendChart = new ChartModule(trendCanvas, lineData) as AnyChart;
  }

  async function refresh(): Promise<void> {
    const id = ++requestId;
    controller?.abort();
    controller = new AbortController();
    loading = true;
    error = "";
    try {
      if (!ChartModule) ChartModule = (await import("chart.js/auto")).default;
      const to = Date.now();
      const from = to - RANGES[fromIndex].milliseconds;
      data = await getFleetKpis(metric, from, to, controller.signal);
      if (id !== requestId) return;
      metric = data.metric;
      if (
        productFilter !== "*" &&
        !data.productClasses.some((p) => p.productClass === productFilter)
      )
        productFilter = "*";
      loading = false;
      drawCharts();
    } catch (err) {
      if (controller.signal.aborted || id !== requestId) return;
      error = err instanceof Error ? err.message : String(err);
      loading = false;
      destroyCharts();
    }
    m.redraw();
  }

  function stop(): void {
    if (timer) clearInterval(timer);
    timer = null;
    controller?.abort();
    destroyCharts();
  }

  function selectMetric(event: Event): void {
    metric = (event.currentTarget as HTMLSelectElement).value;
    void refresh();
  }

  function selectProduct(event: Event): void {
    productFilter = (event.currentTarget as HTMLSelectElement).value;
    drawCharts();
  }

  function selectRange(index: number): void {
    fromIndex = index;
    void refresh();
  }

  function formatNumber(value: number): string {
    return new Intl.NumberFormat().format(value);
  }

  return {
    onremove: stop,
    view: () => {
      if (!started) {
        started = true;
        void refresh();
        timer = setInterval(() => void refresh(), 60000);
      }

      const products = data?.productClasses || [];
      const metricOptions = data?.metrics || [];

      return m(
        "section.my-6",
        m(
          "div.flex flex-wrap items-end justify-between gap-3 mb-4",
          m(
            "div",
            m("h1.text-xl font-medium text-stone-900", "Fleet KPIs"),
            m(
              "p.text-sm text-stone-500 mt-1",
              "Device inventory and telemetry grouped by discovered product class",
            ),
          ),
          m(
            "div.flex flex-wrap items-center gap-2",
            metricOptions.length
              ? m(
                  "select.border border-stone-200 rounded-sm bg-white px-2 py-1.5 text-xs text-stone-700",
                  {
                    value: metric,
                    onchange: selectMetric,
                    "aria-label": "Fleet KPI metric",
                  },
                  metricOptions.map((name) => {
                    const label = METRIC_LABELS[name] || name;
                    const unit =
                      data?.unit && name === metric ? ` (${data.unit})` : "";
                    return m("option", { value: name }, `${label}${unit}`);
                  }),
                )
              : null,
            m(
              "select.border border-stone-200 rounded-sm bg-white px-2 py-1.5 text-xs text-stone-700",
              {
                value: productFilter,
                onchange: selectProduct,
                "aria-label": "Product class filter",
              },
              m("option", { value: "*" }, "All product classes"),
              products.map((p) =>
                m("option", { value: p.productClass }, p.productClass),
              ),
            ),
            ...RANGES.map((range, index) =>
              m(
                "button",
                {
                  type: "button",
                  class: `${BUTTON_CLASS} ${
                    fromIndex === index
                      ? "border-cyan-200 bg-cyan-50 text-cyan-800"
                      : "border-stone-200 bg-white text-stone-600 hover:bg-stone-50"
                  }`,
                  onclick: () => selectRange(index),
                },
                range.label,
              ),
            ),
          ),
        ),
        error
          ? m("div.p-3 mb-3 rounded-sm bg-rose-50 text-sm text-rose-700", error)
          : null,
        m(
          "div.grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4",
          [
            {
              label: "Devices",
              value: data ? formatNumber(data.totalDevices) : "—",
            },
            {
              label: "Inform in last 15 min",
              value: data ? formatNumber(data.onlineDevices) : "—",
            },
            {
              label: "Product classes",
              value: data ? formatNumber(products.length) : "—",
            },
          ].map((item) =>
            m(
              "div.border border-stone-100 rounded-md bg-white px-4 py-3 shadow-xs",
              m("div.text-xs text-stone-500", item.label),
              m(
                "div.text-2xl font-medium text-stone-800 mt-1 tabular-nums",
                item.value,
              ),
            ),
          ),
        ),
        m(
          "div.grid grid-cols-1 xl:grid-cols-2 gap-4 mb-5",
          m(
            "section.border border-stone-100 rounded-md bg-white p-4 shadow-xs",
            m(
              "h2.text-sm font-medium text-stone-700 mb-3",
              "Devices by product class",
            ),
            products.length
              ? m(
                  "div.relative h-64",
                  {
                    oncreate: (node: VnodeDOM) => {
                      productCanvas = node.dom?.querySelector("canvas") ?? null;
                      drawCharts();
                    },
                    onupdate: (node: VnodeDOM) => {
                      productCanvas = node.dom?.querySelector("canvas") ?? null;
                      drawCharts();
                    },
                    onremove: () => {
                      productCanvas = null;
                      productChart?.destroy();
                      productChart = null;
                    },
                  },
                  m("canvas"),
                )
              : m(
                  "div.flex h-64 items-center justify-center text-sm text-stone-500",
                  loading
                    ? "Loading device inventory..."
                    : "No visible devices",
                ),
          ),
          m(
            "section.border border-stone-100 rounded-md bg-white p-4 shadow-xs",
            m(
              "div.flex items-start justify-between gap-3",
              m(
                "h2.text-sm font-medium text-stone-700 mb-3",
                "KPI trend by product class",
              ),
              data?.resolution
                ? m(
                    "span.text-xs text-stone-500",
                    `Average per product class · ${data.unit || "value"} · ${data.resolution} buckets`,
                  )
                : null,
            ),
            data?.series.length
              ? m(
                  "div.relative h-64",
                  {
                    oncreate: (node: VnodeDOM) => {
                      trendCanvas = node.dom?.querySelector("canvas") ?? null;
                      drawCharts();
                    },
                    onupdate: (node: VnodeDOM) => {
                      trendCanvas = node.dom?.querySelector("canvas") ?? null;
                      drawCharts();
                    },
                    onremove: () => {
                      trendCanvas = null;
                      trendChart?.destroy();
                      trendChart = null;
                    },
                  },
                  m("canvas"),
                )
              : m(
                  "div.flex h-64 items-center justify-center text-sm text-stone-500",
                  loading
                    ? "Loading KPI samples..."
                    : "No samples for this metric and period",
                ),
          ),
        ),
        loading
          ? m("div.text-xs text-stone-400 text-right", "Updating…")
          : null,
      );
    },
  };
};

export default component;
