/* C-17 LM Study — Flashcard-only app.js (drop-in)
   - Flashcard flip only (no MC / short answer)
   - Flagging w/ Google Apps Script backend (form-encoded POST)
   - Export flags (JSON)
   - Cache + app version display
   - Update-available banner support
   - Dynamic card height sync so flag panel never clips
*/

"use strict";

/* =========================
   CONFIG
========================= */

// Update this when you release
const APP_VERSION = "v1.2.1";

// Your Google Apps Script Web App URL (must end with /exec)
const FLAG_API_URL = window.FLAGS_ENDPOINT || ""; // optional: define in index.html

/* =========================
   DOM
========================= */

const el = (id) => document.getElementById(id);

const card = el("card");
const questionText = el("questionText");
const answerText = el("answerText");
const referenceText = el("referenceText");
const categoryLabel = el("categoryLabel");
const counterLabel = el("counterLabel");
const modeHint = el("modeHint");

const categorySelect = el("categorySelect");
const shuffleToggle = el("shuffleToggle");
const showRefToggle = el("showRefToggle");

const prevBtn = el("prevBtn");
const nextBtn = el("nextBtn");
const flipBackBtn = el("flipBackBtn");

const flagToggleBtn = el("flagToggleBtn");
const flagPanel = el("flagPanel");
const flagText = el("flagText");
const saveFlagBtn = el("saveFlagBtn");
const clearFlagBtn = el("clearFlagBtn");
const flagStatus = el("flagStatus");
const exportFlagsBtn = el("exportFlagsBtn");

const toastEl = el("toast");
const installBtn = el("installBtn");

const appVersionEl = el("appVersion");
const cacheVersionEl = el("cacheVersion");

const updateBanner = el("updateBanner");
const updateReloadBtn = el("updateReloadBtn");

/* =========================
   STATE
========================= */

let questions = [];
let filteredQuestions = [];
let currentIndex = 0;

let shuffleEnabled = true;
let showReference = true;

// Flags are stored locally for export, and also POSTed to backend
let flags = {}; // { [id]: { text, savedAt, questionSnapshot } }

/* =========================
   UTIL
========================= */

function showToast(message, ms = 2200) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.remove("hidden");
  toastEl.classList.add("show");
  window.clearTimeout(showToast._t);
  showToast._t = window.setTimeout(() => {
    toastEl.classList.remove("show");
    toastEl.classList.add("hidden");
  }, ms);
}

function safeText(s) {
  return (s ?? "").toString();
}

function downloadJSON(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

function getDeviceId() {
  try {
    let id = localStorage.getItem("c17_device_id");
    if (!id) {
      id = "dev-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem("c17_device_id", id);
    }
    return id;
  } catch {
    return "unknown-device";
  }
}

/* =========================
   CARD HEIGHT SYNC (prevents clipping)
========================= */

function getActiveFace() {
  if (!card) return null;
  const flipped = card.classList.contains("flipped");
  return flipped ? card.querySelector(".card-answer") : card.querySelector(".card-question");
}

function syncCardHeight() {
  if (!card) return;

  const inner = card.querySelector(".card-inner");
  const face = getActiveFace();
  if (!inner || !face) return;

  // Temporarily allow measuring full height
  const prevOverflow = face.style.overflow;
  face.style.overflow = "visible";

  // Add a little padding so it feels roomy
  const h = Math.ceil(face.scrollHeight) + 2;

  face.style.overflow = prevOverflow;

  inner.style.minHeight = `${h}px`;
}

/* =========================
   FLAG PANEL
========================= */

function setFlagPanelOpen(open) {
  if (!flagPanel || !card) return;
  if (open) {
    flagPanel.classList.remove("hidden");
    card.classList.add("flag-open");
  } else {
    flagPanel.classList.add("hidden");
    card.classList.remove("flag-open");
    if (flagText) flagText.value = "";
  }
  syncCardHeight();
}

function updateFlagStatusUI(q) {
  if (!flagStatus || !q) return;
  if (flags[q.id]) {
    flagStatus.textContent = "Flagged";
  } else {
    flagStatus.textContent = "";
  }
}

/* =========================
   BACKEND POST (Apps Script-friendly)
========================= */

async function submitFlagToServer(question, flagTextValue) {
  if (!FLAG_API_URL) {
    // Not configured; treat as local-only
    return { ok: false, reason: "No FLAG_API_URL" };
  }

  const payload = {
    id: question.id,
    category: question.category || "",
    question: question.question || "",
    answer: question.answer || "",
    reference: question.reference || "",
    flagText: flagTextValue || "",
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent,
    deviceId: getDeviceId(),
    appVersion: APP_VERSION || "",
  };

  // Form-encoded is the most reliable for Apps Script
  const body = new URLSearchParams();
  body.set("data", JSON.stringify(payload));

  const res = await fetch(FLAG_API_URL, {
    method: "POST",
    mode: "cors",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: body.toString(),
  });

  const text = await res.text().catch(() => "");

  if (!res.ok) {
    console.error("Flag POST failed:", res.status, res.statusText, text.slice(0, 300));
    throw new Error(`HTTP ${res.status}`);
  }

  // We don't require JSON, but try to parse if available
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (_) {}
  return { ok: true, text, parsed };
}

/* =========================
   QUESTIONS LOADING
========================= */

async function loadQuestions() {
  // Cache-busting query param helps while iterating; SW still network-first for questions.json.
  const url = `questions.json?v=${encodeURIComponent(APP_VERSION)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load questions.json (HTTP ${res.status})`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error("questions.json must be an array");
  return data;
}

function populateCategories() {
  if (!categorySelect) return;
  const cats = Array.from(new Set(questions.map(q => safeText(q.category).trim()).filter(Boolean))).sort();
  categorySelect.innerHTML = `<option value="all">All Categories</option>` + cats.map(c => {
    const v = c.replace(/"/g, "&quot;");
    return `<option value="${v}">${v}</option>`;
  }).join("");
}

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function updateFilteredQuestions() {
  const cat = categorySelect ? categorySelect.value : "all";
  let list = questions;

  if (cat && cat !== "all") {
    list = list.filter(q => safeText(q.category) === cat);
  }

  filteredQuestions = shuffleEnabled ? shuffleArray(list) : list.slice();

  if (currentIndex >= filteredQuestions.length) currentIndex = 0;
}

function renderCurrentQuestion() {
  if (!filteredQuestions.length) {
    if (questionText) questionText.textContent = "No questions found.";
    if (answerText) answerText.textContent = "";
    if (referenceText) referenceText.textContent = "";
    if (categoryLabel) categoryLabel.textContent = "";
    if (counterLabel) counterLabel.textContent = "0 / 0";
    setFlagPanelOpen(false);
    return;
  }

  const q = filteredQuestions[currentIndex];

  if (questionText) questionText.textContent = safeText(q.question);
  if (answerText) answerText.textContent = safeText(q.answer);
  if (referenceText) {
    referenceText.textContent = showReference ? safeText(q.reference) : "";
    referenceText.style.display = showReference ? "block" : "none";
  }

  if (categoryLabel) categoryLabel.textContent = safeText(q.category || "Category");
  if (counterLabel) counterLabel.textContent = `${currentIndex + 1} / ${filteredQuestions.length}`;

  if (modeHint) modeHint.textContent = "Tap/click the card to flip";

  updateFlagStatusUI(q);

  // Close flag panel when navigating/questions change
  setFlagPanelOpen(false);

  // Make sure card starts unflipped on new question
  if (card) card.classList.remove("flipped");

  // sync height after DOM paints
  requestAnimationFrame(syncCardHeight);
}

/* =========================
   VERSIONS (App + Cache)
========================= */

function setAppVersionUI() {
  if (appVersionEl) appVersionEl.textContent = APP_VERSION;
}

function requestCacheVersion() {
  if (!("serviceWorker" in navigator)) return;
  if (!navigator.serviceWorker.controller) return;
  try {
    navigator.serviceWorker.controller.postMessage("GET_CACHE_VERSION");
  } catch (e) {
    console.warn("Unable to request cache version:", e);
  }
}

function setupCacheVersionListener() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "CACHE_VERSION") {
      if (cacheVersionEl) cacheVersionEl.textContent = `cache ${event.data.cache}`;
      return;
    }
    if (event.data?.type === "SW_UPDATE_READY") {
      // optional SW->UI messaging if you choose to implement
      showUpdateBanner(event.data?.workerId);
      return;
    }
  });
}

/* =========================
   UPDATE AVAILABLE (banner + reload)
========================= */

let _pendingWaitingWorker = null;

function showUpdateBanner() {
  if (!updateBanner || !updateReloadBtn) return;
  updateBanner.classList.remove("hidden");
  updateReloadBtn.onclick = () => {
    if (_pendingWaitingWorker) {
      _pendingWaitingWorker.postMessage("SKIP_WAITING");
    } else if (navigator.serviceWorker?.controller) {
      // fallback: ask active controller to skip waiting (may not work if none waiting)
      navigator.serviceWorker.controller.postMessage("SKIP_WAITING");
    } else {
      window.location.reload();
    }
  };
}

function setupUpdateFlow() {
  if (!("serviceWorker" in navigator)) return;

  navigator.serviceWorker.register("./service-worker.js").then((reg) => {
    // If there's already a waiting worker, show banner
    if (reg.waiting) {
      _pendingWaitingWorker = reg.waiting;
      showUpdateBanner();
    }

    reg.addEventListener("updatefound", () => {
      const newWorker = reg.installing;
      if (!newWorker) return;

      newWorker.addEventListener("statechange", () => {
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
          _pendingWaitingWorker = reg.waiting || newWorker;
          showUpdateBanner();
        }
      });
    });
  }).catch((e) => {
    console.warn("SW register failed:", e);
  });

  // When the new worker takes control, reload once
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    window.location.reload();
  });
}

/* =========================
   INSTALL (PWA)
========================= */

let deferredPrompt = null;

function setupInstallPrompt() {
  if (!installBtn) return;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.hidden = false;
  });

  installBtn.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch (_) {}
    deferredPrompt = null;
    installBtn.hidden = true;
  });
}

/* =========================
   EVENTS
========================= */

function currentQuestion() {
  return filteredQuestions.length ? filteredQuestions[currentIndex] : null;
}

function setupEvents() {
  if (!card) return;

  // Flip on card tap (except when interacting with controls)
  card.addEventListener("click", (e) => {
    const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
    if (["button", "select", "textarea", "input", "label", "a"].includes(tag)) return;
    card.classList.toggle("flipped");
    requestAnimationFrame(syncCardHeight);
  });

  if (flipBackBtn) {
    flipBackBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      card.classList.remove("flipped");
      requestAnimationFrame(syncCardHeight);
    });
  }

  if (shuffleToggle) {
    shuffleToggle.addEventListener("change", () => {
      shuffleEnabled = !!shuffleToggle.checked;
      currentIndex = 0;
      updateFilteredQuestions();
      renderCurrentQuestion();
    });
  }

  if (showRefToggle) {
    showRefToggle.addEventListener("change", () => {
      showReference = !!showRefToggle.checked;
      // Don't reset question, just rerender
      renderCurrentQuestion();
    });
  }

  if (prevBtn) {
    prevBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!filteredQuestions.length) return;
      currentIndex = (currentIndex - 1 + filteredQuestions.length) % filteredQuestions.length;
      renderCurrentQuestion();
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!filteredQuestions.length) return;
      currentIndex = (currentIndex + 1) % filteredQuestions.length;
      renderCurrentQuestion();
    });
  }

  if (categorySelect) {
    categorySelect.addEventListener("change", () => {
      currentIndex = 0;
      updateFilteredQuestions();
      renderCurrentQuestion();
    });
  }

  // Flag UI
  if (flagToggleBtn) {
    flagToggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = flagPanel?.classList.contains("hidden");
      setFlagPanelOpen(open);
    });
  }

  if (saveFlagBtn) {
    saveFlagBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const q = currentQuestion();
      if (!q) return;

      const text = safeText(flagText?.value).trim();
      if (!text) {
        showToast("Type a reason before saving.");
        return;
      }

      // Save locally (always)
      flags[q.id] = {
        text,
        savedAt: new Date().toISOString(),
        questionSnapshot: {
          id: q.id, category: q.category, question: q.question, answer: q.answer, reference: q.reference || ""
        },
      };
      try { localStorage.setItem("c17_flags", JSON.stringify(flags)); } catch (_) {}

      updateFlagStatusUI(q);

      // Send to backend
      try {
        await submitFlagToServer(q, text);
        showToast("🚩 Flag saved");
      } catch (err) {
        console.error("Flag submit failed:", err);
        showToast("⚠️ Failed to save flag");
      }

      setFlagPanelOpen(false);
    });
  }

  if (clearFlagBtn) {
    clearFlagBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const q = currentQuestion();
      if (!q) return;

      delete flags[q.id];
      try { localStorage.setItem("c17_flags", JSON.stringify(flags)); } catch (_) {}
      updateFlagStatusUI(q);
      showToast("Flag cleared");
      setFlagPanelOpen(false);
    });
  }

  if (exportFlagsBtn) {
    exportFlagsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const out = Object.values(flags).map(f => f.questionSnapshot ? ({
        ...f.questionSnapshot,
        flagText: f.text,
        savedAt: f.savedAt,
        deviceId: getDeviceId(),
        appVersion: APP_VERSION,
      }) : f);
      downloadJSON("flags_export.json", out);
      showToast("⬇️ Exported flags");
    });
  }

  // Resize should re-sync
  window.addEventListener("resize", () => requestAnimationFrame(syncCardHeight));
}

/* =========================
   INIT
========================= */

async function init() {
  setAppVersionUI();
  setupCacheVersionListener();
  setupUpdateFlow();
  setupInstallPrompt();

  // Load flags from localStorage (export still works offline)
  try {
    const raw = localStorage.getItem("c17_flags");
    if (raw) flags = JSON.parse(raw) || {};
  } catch {
    flags = {};
  }

  // Load questions
  try {
    questions = await loadQuestions();
  } catch (e) {
    console.error(e);
    if (questionText) questionText.textContent = "Error loading questions.json. Check console.";
    showToast("❌ Failed to load questions.json");
    return;
  }

  populateCategories();

  shuffleEnabled = !!(shuffleToggle ? shuffleToggle.checked : true);
  showReference = !!(showRefToggle ? showRefToggle.checked : true);

  updateFilteredQuestions();
  setupEvents();
  renderCurrentQuestion();

  // Cache version (wait for SW control)
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.ready.then(() => {
      requestCacheVersion();
    }).catch(() => {});
  }
}

document.addEventListener("DOMContentLoaded", init);
