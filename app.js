const RAIN = "#2b6777";
const RAIN_SOFT = "#a9c8ce";

let chart;
let data = { summary: null, daily: [], monthly: [], yearly: [], recent_hourly: [] };

async function loadJSON(name) {
  const res = await fetch(`data/${name}.json?_=${Date.now()}`);
  if (!res.ok) throw new Error(`Failed to load ${name}.json`);
  return res.json();
}

function fmt(n) {
  if (n === null || n === undefined) return "–";
  return `${n.toFixed(1)}mm`;
}

function renderHero() {
  const s = data.summary || {};
  const stats = [
    { label: "Last 24 hours", value: fmt(s.last_24h_mm) },
    { label: "This month so far", value: fmt(s.this_month_mm), note: s.this_month_avg_mm != null ? `avg ${fmt(s.this_month_avg_mm)}` : null },
    { label: "This year so far", value: fmt(s.this_year_mm), note: s.avg_year_mm != null ? `avg ${fmt(s.avg_year_mm)}/yr` : null },
    { label: "Years of record", value: s.record_years ?? "–" },
  ];
  document.getElementById("hero").innerHTML = stats
    .map(
      (st) => `<div class="stat">
        <div class="num">${st.value}</div>
        <div class="label">${st.label}${st.note ? " · " + st.note : ""}</div>
      </div>`
    )
    .join("");
  document.getElementById("last-updated").textContent = s.last_updated_utc
    ? new Date(s.last_updated_utc).toLocaleString("en-GB")
    : "–";
}

function drawBarChart(labels, values, label) {
  const ctx = document.getElementById("chart").getContext("2d");
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label,
          data: values,
          backgroundColor: RAIN,
          borderRadius: 3,
          maxBarThickness: 26,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          title: { display: true, text: "mm" },
          grid: { color: "#dfe7e6" },
        },
        x: { grid: { display: false } },
      },
    },
  });
}

function viewRecent() {
  document.getElementById("panel-title").textContent = "Rainfall, last 14 days by hour";
  document.getElementById("controls").innerHTML = "";
  const labels = data.recent_hourly.map((r) =>
    new Date(r.hour).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit" })
  );
  drawBarChart(labels, data.recent_hourly.map((r) => r.total_mm), "mm per hour");
}

function viewDaily() {
  const months = [...new Set(data.daily.map((d) => d.date.slice(0, 7)))].sort();
  const controls = document.getElementById("controls");
  controls.innerHTML = `<select id="month-select">${months
    .map((m) => `<option value="${m}">${m}</option>`)
    .join("")}</select>`;
  const select = document.getElementById("month-select");
  select.value = months[months.length - 1];

  function render() {
    const m = select.value;
    document.getElementById("panel-title").textContent = `Daily rainfall — ${m}`;
    const rows = data.daily.filter((d) => d.date.startsWith(m));
    drawBarChart(rows.map((d) => d.date.slice(8, 10)), rows.map((d) => d.total_mm), "mm per day");
  }
  select.addEventListener("change", render);
  render();
}

function viewMonthly() {
  const years = [...new Set(data.monthly.map((m) => m.month.slice(0, 4)))].sort();
  const controls = document.getElementById("controls");
  controls.innerHTML = `<select id="year-select"><option value="__all">All years (totals)</option>${years
    .map((y) => `<option value="${y}">${y}</option>`)
    .join("")}</select>`;
  const select = document.getElementById("year-select");
  select.value = years[years.length - 1];

  function render() {
    const y = select.value;
    if (y === "__all") {
      document.getElementById("panel-title").textContent = "Monthly totals, all years combined (average per month)";
      const byMonthNum = {};
      data.monthly.forEach((m) => {
        const num = m.month.slice(5, 7);
        byMonthNum[num] = byMonthNum[num] || [];
        byMonthNum[num].push(m.total_mm);
      });
      const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      const labels = monthNames;
      const values = Object.keys(byMonthNum)
        .sort()
        .map((k) => {
          const arr = byMonthNum[k];
          return arr.reduce((a, b) => a + b, 0) / arr.length;
        });
      drawBarChart(labels, values.map((v) => Math.round(v * 10) / 10), "avg mm per month");
    } else {
      document.getElementById("panel-title").textContent = `Monthly rainfall — ${y}`;
      const rows = data.monthly.filter((m) => m.month.startsWith(y));
      const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      drawBarChart(rows.map((r) => monthNames[parseInt(r.month.slice(5, 7), 10) - 1]), rows.map((r) => r.total_mm), "mm per month");
    }
  }
  select.addEventListener("change", render);
  render();
}

function viewYearly() {
  document.getElementById("panel-title").textContent = "Total rainfall by year";
  document.getElementById("controls").innerHTML = "";
  drawBarChart(data.yearly.map((y) => y.year), data.yearly.map((y) => y.total_mm), "mm per year");
}

const VIEWS = { recent: viewRecent, daily: viewDaily, monthly: viewMonthly, yearly: viewYearly };

function setActiveTab(view) {
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  VIEWS[view]();
}

async function init() {
  const [summary, daily, monthly, yearly, recent_hourly] = await Promise.all([
    loadJSON("summary"),
    loadJSON("daily"),
    loadJSON("monthly"),
    loadJSON("yearly"),
    loadJSON("recent_hourly"),
  ]);
  data = { summary, daily, monthly, yearly, recent_hourly };
  renderHero();
  setActiveTab("recent");

  document.querySelectorAll("#tabs button").forEach((btn) => {
    btn.addEventListener("click", () => setActiveTab(btn.dataset.view));
  });
}

init().catch((err) => {
  document.querySelector(".wrap").insertAdjacentHTML(
    "afterbegin",
    `<p style="color:#a33;">Couldn't load data yet — the first update may still be running. (${err.message})</p>`
  );
});
