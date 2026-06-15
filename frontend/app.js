/**
 * LensFlow frontend
 * -----------------
 * Talks to the LensFlow backend (Express API) for all data.
 * Change API_BASE below if your backend runs on a different host/port.
 */
const API_BASE =
  (location.hostname === "localhost" || location.hostname === "127.0.0.1")
    ? "http://localhost:4000/api"
    : "/api";

let META = { lensSlaHours: {}, stages: [], stores: [] };

// ---------------------------------------------------------------------
// API HELPERS
// ---------------------------------------------------------------------
async function api(path, opts = {}) {
  const res = await fetch(API_BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

function setApiStatus(live) {
  const dot = document.querySelector(".dot-status");
  const text = document.getElementById("api-status-text");
  if (live) {
    dot.className = "dot-status live";
    text.textContent = "Backend connected";
  } else {
    dot.className = "dot-status down";
    text.textContent = "Backend offline — start backend/server.js";
  }
}

// ---------------------------------------------------------------------
// TAB SWITCHING
// ---------------------------------------------------------------------
document.querySelectorAll(".tab").forEach((t) => {
  t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    document.querySelectorAll(".view").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    document.getElementById("view-" + t.dataset.view).classList.add("active");
    if (t.dataset.view === "dashboard") renderDashboard();
    if (t.dataset.view === "alerts") renderAlerts();
  });
});

// ---------------------------------------------------------------------
// INIT / META
// ---------------------------------------------------------------------
async function loadMeta() {
  META = await api("/meta");

  const lensSel = document.getElementById("f-lenstype");
  lensSel.innerHTML = Object.entries(META.lensSlaHours)
    .map(([name, hrs]) => `<option value="${name}">${name} (SLA ${hrs}h)</option>`)
    .join("");

  const storeSel = document.getElementById("f-store");
  storeSel.innerHTML = META.stores.map((s) => `<option>${s}</option>`).join("");
}

// ---------------------------------------------------------------------
// MODULE 1: INVENTORY + AVAILABILITY
// ---------------------------------------------------------------------
async function renderInventoryTable() {
  const inv = await api("/inventory");
  const tbody = document.querySelector("#inv-table tbody");
  tbody.innerHTML = inv
    .map((r) => {
      const dot = r.stock === "In Stock" ? "green" : r.stock === "Low Stock" ? "amber" : "red";
      return `<tr>
        <td>${r.lensType}</td>
        <td>${r.powerRange[0]} to ${r.powerRange[1]}</td>
        <td>${r.index}</td>
        <td>${r.coating}</td>
        <td><span class="dot ${dot}"></span>${r.stock}</td>
      </tr>`;
    })
    .join("");
}

document.getElementById("submit-order").addEventListener("click", async () => {
  const btn = document.getElementById("submit-order");
  const box = document.getElementById("availability-result");
  const payload = {
    customer: document.getElementById("f-name").value || "Walk-in Customer",
    source: document.getElementById("f-source").value,
    store: document.getElementById("f-store").value,
    lensType: document.getElementById("f-lenstype").value,
    sphere: parseFloat(document.getElementById("f-sphere").value),
    cyl: parseFloat(document.getElementById("f-cyl").value || "0"),
    index: document.getElementById("f-index").value,
    coating: document.getElementById("f-coating").value,
    frame: document.getElementById("f-frame").value,
  };

  btn.disabled = true;
  btn.textContent = "Checking…";
  try {
    // 1. ask backend whether this spec is in-house stock or needs lab order
    const avail = await api("/check-availability", {
      method: "POST",
      body: JSON.stringify({
        lensType: payload.lensType,
        sphere: payload.sphere,
        index: payload.index,
        coating: payload.coating,
      }),
    });

    // 2. create the order record
    const order = await api("/orders", { method: "POST", body: JSON.stringify(payload) });

    const tagClass = avail.level === "in-stock" ? "green" : "amber";
    const boxClass = avail.level === "in-stock" ? "in-stock" : "order-made";
    const etaDate = new Date(avail.eta);

    box.innerHTML = `
      <div class="result-box ${boxClass}">
        <span class="result-tag ${tagClass}">${avail.match ? avail.match.stock : "No Match"} · ${payload.lensType}</span>
        <div class="result-detail">
          <strong>${avail.statusLabel}</strong><br/>
          Order <strong>${order.id}</strong> created for ${payload.customer} (${payload.store}).<br/>
          Spec: ${payload.sphere > 0 ? "+" : ""}${payload.sphere} SPH · Index ${payload.index} · ${payload.coating}<br/>
          SLA window for ${payload.lensType}: <strong>${avail.slaHours} hrs</strong>
        </div>
        <div class="eta-big">ETA: ${etaDate.toLocaleString([], { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
      </div>
    `;
  } catch (e) {
    box.innerHTML = `<div class="result-box order-made"><strong>Error:</strong> ${e.message}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Check Availability & Place Order";
  }
});

// ---------------------------------------------------------------------
// MODULE 2: DASHBOARD
// ---------------------------------------------------------------------
const STAGE_CLASS = {
  "Order Placed": "placed", "Power Check": "power", "Lab Processing": "lab",
  "Coating": "coating", "QC": "qc", "Dispatch": "dispatch", "Delivered": "delivered",
};

function fmtHours(h) {
  const sign = h < 0 ? "-" : "";
  h = Math.abs(h);
  const d = Math.floor(h / 24);
  const r = Math.round(h % 24);
  return `${sign}${d > 0 ? d + "d " : ""}${r}h`;
}

let filtersPopulated = false;
function populateFilterOptions() {
  if (filtersPopulated) return;
  const statusSel = document.getElementById("filter-status");
  const lensSel = document.getElementById("filter-lens");
  const storeSel = document.getElementById("filter-store");
  META.stages.forEach((s) => (statusSel.innerHTML += `<option value="${s}">${s}</option>`));
  Object.keys(META.lensSlaHours).forEach((s) => (lensSel.innerHTML += `<option value="${s}">${s}</option>`));
  META.stores.forEach((s) => (storeSel.innerHTML += `<option value="${s}">${s}</option>`));
  filtersPopulated = true;
}

async function renderKPIs() {
  const k = await api("/kpis");
  document.getElementById("kpi-row").innerHTML = `
    <div class="kpi"><div class="num">${k.active}</div><div class="lbl">Active Orders</div></div>
    <div class="kpi ontrack"><div class="num">${k.onTrack}</div><div class="lbl">On Track</div></div>
    <div class="kpi risk"><div class="num">${k.atRisk}</div><div class="lbl">At Risk</div></div>
    <div class="kpi breach"><div class="num">${k.breached}</div><div class="lbl">SLA Breached</div></div>
  `;
}

async function renderDashboard() {
  populateFilterOptions();
  await renderKPIs();

  const params = new URLSearchParams();
  const status = document.getElementById("filter-status").value;
  const lensType = document.getElementById("filter-lens").value;
  const store = document.getElementById("filter-store").value;
  const search = document.getElementById("filter-search").value;
  if (status) params.set("status", status);
  if (lensType) params.set("lensType", lensType);
  if (store) params.set("store", store);
  if (search) params.set("search", search);

  const orders = await api("/orders?" + params.toString());
  const tbody = document.getElementById("orders-tbody");

  if (orders.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:30px; color:var(--muted);">No orders match these filters.</td></tr>`;
    return;
  }

  tbody.innerHTML = orders
    .map((o) => {
      const timeLeft = o.status === "Delivered" ? "—" : fmtHours(o.hoursLeft);
      const slaLabel = o.status === "Delivered" ? "Delivered" : o.slaState === "breach" ? "Breached" : o.slaState === "risk" ? "At Risk" : "On Track";
      const statusOptions = META.stages.map((s) => `<option value="${s}" ${s === o.status ? "selected" : ""}>${s}</option>`).join("");

      return `<tr>
        <td><strong>${o.id}</strong><br/><span style="color:var(--muted); font-size:11px;">${o.source}</span></td>
        <td>${o.customer}</td>
        <td>${o.store}</td>
        <td>${o.lensType}</td>
        <td><span class="badge ${STAGE_CLASS[o.status]}">${o.status}</span></td>
        <td><span class="sla-pill ${o.status === "Delivered" ? "ok" : o.slaState}">${slaLabel}</span></td>
        <td>${timeLeft}</td>
        <td><input class="delay-input" placeholder="reason..." value="${o.delayReason || ""}" data-id="${o.id}" data-field="delayReason" /></td>
        <td>
          <div class="row-actions">
            <select class="status-select" data-id="${o.id}" data-field="status">${statusOptions}</select>
          </div>
        </td>
      </tr>`;
    })
    .join("");

  // wire up change handlers
  tbody.querySelectorAll("select.status-select").forEach((sel) => {
    sel.addEventListener("change", async (e) => {
      await api(`/orders/${e.target.dataset.id}`, { method: "PATCH", body: JSON.stringify({ status: e.target.value }) });
      renderDashboard();
    });
  });
  tbody.querySelectorAll("input.delay-input").forEach((inp) => {
    inp.addEventListener("change", async (e) => {
      await api(`/orders/${e.target.dataset.id}`, { method: "PATCH", body: JSON.stringify({ delayReason: e.target.value }) });
    });
  });
}

document.getElementById("filter-status").addEventListener("change", renderDashboard);
document.getElementById("filter-lens").addEventListener("change", renderDashboard);
document.getElementById("filter-store").addEventListener("change", renderDashboard);
document.getElementById("filter-search").addEventListener("input", renderDashboard);
document.getElementById("refresh-orders").addEventListener("click", renderDashboard);
document.getElementById("reset-filters").addEventListener("click", () => {
  document.getElementById("filter-status").value = "";
  document.getElementById("filter-lens").value = "";
  document.getElementById("filter-store").value = "";
  document.getElementById("filter-search").value = "";
  renderDashboard();
});

// ---------------------------------------------------------------------
// MODULE 3: TAT ALERTS
// ---------------------------------------------------------------------
async function renderAlerts() {
  const alerts = await api("/alerts");
  const list = document.getElementById("alert-list");

  if (alerts.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="big">No breach risks detected</div>All active orders are tracking within their predicted SLA window.</div>`;
    return;
  }

  list.innerHTML = alerts
    .map((a) => {
      const o = a.order;
      const isBreach = a.level === "breach";
      const msg = isBreach
        ? `Predicted to exceed SLA (${a.slaHours}h) for ${o.lensType} — currently in <strong>${o.status}</strong>${o.delayReason ? `. Logged delay: "${o.delayReason}"` : ""}.`
        : `Trending close to SLA limit (${a.slaHours}h) for ${o.lensType} — currently in <strong>${o.status}</strong>. Recommend prioritizing.`;
      return `
        <div class="alert ${isBreach ? "" : "risk-amber"}">
          <div class="alert-main">
            <div class="alert-order">${o.id} · ${o.customer} · ${o.store}</div>
            <div class="alert-msg">${msg}</div>
            <div class="alert-meta">${isBreach ? "BREACH ALERT" : "AT-RISK ALERT"} · Sent to store team just now</div>
          </div>
          <div class="alert-chan">
            <span class="chan-pill email">✉ Email sent</span>
            <span class="chan-pill whatsapp">✆ WhatsApp sent</span>
          </div>
        </div>`;
    })
    .join("");
}

// ---------------------------------------------------------------------
// BOOT
// ---------------------------------------------------------------------
(async function init() {
  try {
    await loadMeta();
    setApiStatus(true);
    await renderInventoryTable();
    await renderDashboard();
    await renderAlerts();
    // light auto-refresh so SLA timers / alerts stay live
    setInterval(() => {
      const activeView = document.querySelector(".view.active").id;
      if (activeView === "view-dashboard") renderDashboard();
      if (activeView === "view-alerts") renderAlerts();
    }, 30000);
  } catch (e) {
    setApiStatus(false);
    console.error(e);
  }
})();
