const RAIN = "#2b6777";
const RAIN_SOFT = "#a9c8ce";

let chart;
let data = { summary: null, daily: [], monthly: [], yearly: [], recent_hourly: [], climatology: [] };

function showChart() {
  document.getElementById("chart").classList.remove("hidden");
  document.getElementById("table-container").classList.add("hidden");
}
function showTable() {
  document.getElementById("chart").classList.add("hidden");
  document.getElementById("table-container").classList.remove("hidden");
}

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

function drawBarChart(labels, values, label, barColors) {
  showChart();
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
          backgroundColor: barColors || RAIN,
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
      document.getElementById("panel-title").textContent = `Monthly rainfall — ${y} (colour shows above/below the long-term average for that month)`;
      const rows = data.monthly.filter((m) => m.month.startsWith(y));
      const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      const colors = rows.map((r) => {
        if (!r.complete || r.pct_of_avg == null) return RAIN_SOFT;
        return r.pct_of_avg >= 100 ? RAIN : "#c98a3d";
      });
      drawBarChart(rows.map((r) => monthNames[parseInt(r.month.slice(5, 7), 10) - 1]), rows.map((r) => r.total_mm), "mm per month", colors);
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

const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function cellHTML(entry) {
  if (!entry) return "<td>–</td>";
  const { total_mm, complete, pct_of_avg } = entry;
  const classes = [];
  if (!complete) classes.push("incomplete");
  else if (pct_of_avg != null) classes.push(pct_of_avg >= 100 ? "above" : "below");
  const pctLine = pct_of_avg != null ? `<span class="pct">${pct_of_avg}%</span>` : (!complete ? `<span class="pct">gap</span>` : "");
  return `<td class="${classes.join(" ")}">${total_mm.toFixed(1)}${pctLine}</td>`;
}

function viewTable() {
  document.getElementById("panel-title").textContent = "Monthly rainfall table";
  document.getElementById("controls").innerHTML = "";
  showTable();

  // Index monthly entries as {year: {monthNum: entry}}
  const byYear = {};
  data.monthly.forEach((m) => {
    const y = m.month.slice(0, 4);
    const mo = m.month.slice(5, 7);
    byYear[y] = byYear[y] || {};
    byYear[y][mo] = m;
  });
  const years = Object.keys(byYear).sort().reverse();

  const climByMonth = {};
  data.climatology.forEach((c) => (climByMonth[c.month_num] = c));

  let head = `<tr><th>Year</th>${MONTH_ABBR.map((m) => `<th>${m}</th>`).join("")}<th class="year-total">Year</th></tr>`;

  let bodyRows = years
    .map((y) => {
      const cells = [];
      let yearTotal = 0;
      let yearComplete = true;
      for (let i = 1; i <= 12; i++) {
        const mo = String(i).padStart(2, "0");
        const entry = byYear[y][mo];
        cells.push(cellHTML(entry));
        if (entry) yearTotal += entry.total_mm;
        if (!entry || !entry.complete) yearComplete = false;
      }
      const yearEntry = data.yearly.find((yy) => String(yy.year) === y);
      const pctLine = yearEntry && yearEntry.pct_of_avg != null ? `<span class="pct">${yearEntry.pct_of_avg}%</span>` : "";
      return `<tr><td>${y}</td>${cells.join("")}<td class="year-total">${yearTotal.toFixed(1)}${pctLine}</td></tr>`;
    })
    .join("");

  // Footer: lowest / highest / mean per month, using only complete months
  function footerRow(label, fn) {
    const cells = [];
    for (let i = 1; i <= 12; i++) {
      const mo = String(i).padStart(2, "0");
      const vals = data.monthly.filter((m) => m.month.slice(5, 7) === mo && m.complete).map((m) => m.total_mm);
      cells.push(`<td>${vals.length ? fn(vals).toFixed(1) : "–"}</td>`);
    }
    const yearVals = data.yearly.filter((y) => y.complete).map((y) => y.total_mm);
    const yearCell = `<td class="year-total">${yearVals.length ? fn(yearVals).toFixed(1) : "–"}</td>`;
    return `<tr><td>${label}</td>${cells.join("")}${yearCell}</tr>`;
  }
  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  let foot = footerRow("Lowest", (a) => Math.min(...a));
  foot += footerRow("Highest", (a) => Math.max(...a));
  foot += footerRow("Mean", mean);

  document.getElementById("table-container").innerHTML = `
    <div class="rain-table-wrap">
      <table class="rain-table">
        <thead>${head}</thead>
        <tbody>${bodyRows}</tbody>
        <tfoot>${foot}</tfoot>
      </table>
    </div>
    <p class="table-note">Percentages are against the average for that calendar month, calculated only from years with a complete data record for that month (so gaps in the gauge's history — such as 2007–2009 — don't skew the average low). Months shown in <em>italics</em> have a substantial gap in that period's readings and are excluded from the average and from the Lowest/Highest/Mean rows.</p>
  `;
}

const VIEWS = { recent: viewRecent, daily: viewDaily, monthly: viewMonthly, yearly: viewYearly, table: viewTable };

function setActiveTab(view) {
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  VIEWS[view]();
}

async function init() {
  const [summary, daily, monthly, yearly, recent_hourly, climatology] = await Promise.all([
    loadJSON("summary"),
    loadJSON("daily"),
    loadJSON("monthly"),
    loadJSON("yearly"),
    loadJSON("recent_hourly"),
    loadJSON("climatology"),
  ]);
  data = { summary, daily, monthly, yearly, recent_hourly, climatology };
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
