// ===============================
// C-17 LM Study App - app.js (Flashcard-only)
// Drop-in replacement: removes Multiple Choice + Short Answer logic/UI dependencies
// ===============================

// Update this string whenever you push a meaningful new build
const APP_VERSION = "1.2.0";

// Backend endpoint for saving flags (Google Apps Script web app URL)
const FLAG_API_URL =
  "https://script.google.com/macros/s/AKfycbwyssy1vWNQW_WbBj5LVXjf_-UDF-B4oHLWAg3YVoolfGpgVNDsiBY6BVdtBXs4JP9iCA/exec";

// ---------- Version display (App + Cache) ----------
function formatVersionLabel(ver) {
  if (!ver) return "";
  const v = String(ver).trim();
  if (/^v\d/i.test(v)) return v;
  if (/^ver\.?\s*/i.test(v)) return "v" + v.replace(/^ver\.?\s*/i, "");
  if (/^\d/.test(v)) return "v" + v;
  return v;
}

function setVersions() {
  const appEl = document.getElementById("appVersion");
  const cacheEl = document.getElementById("cacheVersion");

  if (appEl) appEl.textContent = formatVersionLabel(APP_VERSION);

  // If the page doesn't have a cacheVersion element, do nothing.
  if (!cacheEl) return;

  // If SW isn't supported, hide the cache line.
  if (!("serviceWorker" in navigator)) {
    cacheEl.textContent = "";
    return;
  }

  navigator.serviceWorker.ready
    .then((reg) => {
      if (!reg || !reg.active) {
        cacheEl.textContent = "";
        return;
      }

      const channel = new MessageChannel();
      channel.port1.onmessage = (event) => {
        if (event.data?.type !== "CACHE_VERSION") return;

        const cacheName = event.data.cache || "";
        // Expected: c17-study-cache-1.3 (or similar)
        const m =
          cacheName.match(/cache-(\d[\d.]*)/i) ||
          cacheName.match(/-(\d[\d.]*)$/);
        const cacheVersion = m ? m[1] : "unknown";

        cacheEl.textContent = `cache: v${cacheVersion}`;

        // Mark stale if semantic version differs
        const appMatch = String(APP_VERSION).match(/(\d+\.\d+(?:\.\d+)?)/);
        const appSemver = appMatch ? appMatch[1] : null;
        cacheEl.classList.toggle(
          "stale",
          Boolean(appSemver && cacheVersion !== appSemver)
        );
      };

      reg.active.postMessage("GET_CACHE_VERSION", [channel.port2]);
    })
    .catch(() => {
      cacheEl.textContent = "";
    });
}


// -----------------------------
// Card height sync (prevents cut-off when flag panel expands)
// -----------------------------
function syncCardHeight() {
  const card = document.getElementById("card");
  if (!card) return;

  const inner = card.querySelector(".card-inner");
  const qFace = card.querySelector(".card-question");
  const aFace = card.querySelector(".card-answer");
  if (!inner || !qFace || !aFace) return;

  const active = card.classList.contains("flipped") ? aFace : qFace;

  // scrollHeight works even when faces are absolutely positioned
  const h = active.scrollHeight;

  // Add a little breathing room so shadows/borders don't clip
  inner.style.height = `${Math.max(h, 220)}px`;
}

window.addEventListener("resize", () => syncCardHeight());

// -----------------------------
// App State
// -----------------------------

let allQuestions = [];
let filteredQuestions = [];
let currentIndex = 0;

let shuffleEnabled = true;
let showReference = true;

// Per-device flag storage: { [questionId]: { text, flaggedAt } }
let flags = {};

// PWA install prompt
let deferredPrompt = null;

// -----------------------------
// Init
// -----------------------------

document.addEventListener("DOMContentLoaded", () => {
  setVersions();
  loadFlags();
  setupUI();
  loadQuestions();
  setupPWA();
});

// -----------------------------
// Flags: localStorage helpers
// -----------------------------

function loadFlags() {
  try {
    const raw = localStorage.getItem("c17_flags");
    flags = raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.warn("Could not load flags from localStorage:", e);
    flags = {};
  }
}

function saveFlags() {
  try {
    localStorage.setItem("c17_flags", JSON.stringify(flags));
  } catch (e) {
    console.warn("Could not save flags to localStorage:", e);
  }
}

function updateFlagUI(questionId) {
  const flagStatusEl = document.getElementById("flagStatus");
  if (!flagStatusEl) return;

  const flagData = flags[questionId];
  if (flagData) {
    flagStatusEl.textContent = "Flagged";
    flagStatusEl.classList.add("flagged");
  } else {
    flagStatusEl.textContent = "";
    flagStatusEl.classList.remove("flagged");
  }
}

// Export flags (for dev review) – per device
function exportFlags() {
  const entries = Object.entries(flags);
  if (!entries.length) {
    alert("No questions have been flagged on this device.");
    return;
  }

  const exportData = entries.map(([id, data]) => {
    const numericId = Number(id);
    const q = allQuestions.find((qq) => qq.id === numericId);
    return {
      id: numericId,
      question: q ? q.question : "(Question not found in current bank)",
      answer: q ? q.answer : "",
      category: q ? q.category : "",
      reference: q && q.reference ? q.reference : "",
      flagText: data.text,
      flaggedAt: data.flaggedAt,
      deviceId: getDeviceId(),
      userAgent: navigator.userAgent,
    };
  });

  const blob = new Blob([JSON.stringify(exportData, null, 2)], {
    type: "application/json",
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  a.href = url;
  a.download = `c17_flags_${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function getDeviceId() {
  try {
    let id = localStorage.getItem("c17_device_id");
    if (!id) {
      id =
        "dev-" +
        Math.random().toString(36).slice(2) +
        Date.now().toString(36);
      localStorage.setItem("c17_device_id", id);
    }
    return id;
  } catch {
    return "unknown-device";
  }
}

async function submitFlagToServer(question, flagText) {
  try {
    const payload = {
      id: question.id,
      category: question.category,
      question: question.question,
      flag: flagText,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      deviceId: getDeviceId(),
      appVersion: APP_VERSION,
    };

    const res = await fetch(FLAG_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error("Flag submission failed");
    showToast("🚩 Flag saved");
  } catch (err) {
    console.error(err);
    showToast("⚠️ Failed to save flag");
  }
}

// -----------------------------
// UI Setup
// -----------------------------

function setupUI() {
  const card = document.getElementById("card");
  const shuffleToggle = document.getElementById("shuffleToggle");
  const showRefToggle = document.getElementById("showRefToggle");
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  const flipBackBtn = document.getElementById("flipBackBtn");
  const categorySelect = document.getElementById("categorySelect");

  // (Flashcard-only) Hide mode selector if it exists
  const modeSelect = document.getElementById("modeSelect");
  if (modeSelect) {
    modeSelect.value = "flashcard";
    modeSelect.disabled = true;
    const wrap = modeSelect.closest(".control-group");
    if (wrap) wrap.style.display = "none";
  }

  // Hide MC/Short-Answer UI areas if present in HTML
  const shortAnswerArea = document.getElementById("shortAnswerArea");
  if (shortAnswerArea) shortAnswerArea.classList.add("hidden");
  const mcArea = document.getElementById("mcArea");
  if (mcArea) mcArea.classList.add("hidden");

  // Flag-related elements
  const flagToggleBtn = document.getElementById("flagToggleBtn");
  const flagPanel = document.getElementById("flagPanel");
  const saveFlagBtn = document.getElementById("saveFlagBtn");
  const clearFlagBtn = document.getElementById("clearFlagBtn");
  const flagText = document.getElementById("flagText");
  const exportFlagsBtn = document.getElementById("exportFlagsBtn");

  function hideFlagPanel() {
    if (flagPanel) flagPanel.classList.add("hidden");
    if (card) card.classList.remove("flag-open");
    syncCardHeight();
  }

  // Card flip (flashcard only)
  if (card) {
    card.addEventListener("click", (e) => {
      if (e.target.closest("textarea") || e.target.closest("button")) return;
      card.classList.toggle("flipped");
      syncCardHeight();
    });
  }

  if (flipBackBtn && card) {
    flipBackBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      card.classList.remove("flipped");
      syncCardHeight();
    });
  }

  // Shuffle toggle
  if (shuffleToggle) {
    shuffleToggle.addEventListener("change", () => {
      shuffleEnabled = shuffleToggle.checked;
      currentIndex = 0;
      updateFilteredQuestions();
      renderCurrentQuestion();
      syncCardHeight();
      hideFlagPanel();
    });
  }

  // Show reference toggle
  if (showRefToggle) {
    showRefToggle.addEventListener("change", () => {
      showReference = showRefToggle.checked;
      renderCurrentQuestion();
      syncCardHeight();
    });
  }

  // Category filter
  if (categorySelect) {
    categorySelect.addEventListener("change", () => {
      currentIndex = 0;
      updateFilteredQuestions();
      renderCurrentQuestion();
      syncCardHeight();
      hideFlagPanel();
    });
  }

  // Navigation
  if (prevBtn && card) {
    prevBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!filteredQuestions.length) return;
      currentIndex =
        (currentIndex - 1 + filteredQuestions.length) % filteredQuestions.length;
      card.classList.remove("flipped");
      syncCardHeight();
      hideFlagPanel();
      renderCurrentQuestion();
      syncCardHeight();
    });
  }

  if (nextBtn && card) {
    nextBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!filteredQuestions.length) return;
      currentIndex = (currentIndex + 1) % filteredQuestions.length;
      card.classList.remove("flipped");
      syncCardHeight();
      hideFlagPanel();
      renderCurrentQuestion();
      syncCardHeight();
    });
  }

  // Flag UI: toggle panel
  if (flagToggleBtn && flagPanel && card) {
    flagToggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      flagPanel.classList.toggle("hidden");
      const isOpen = !flagPanel.classList.contains("hidden");
      card.classList.toggle("flag-open", isOpen);
      syncCardHeight();
    });
  }

  // Save flag
  if (saveFlagBtn && flagText) {
    saveFlagBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!filteredQuestions.length) return;

      const q = filteredQuestions[currentIndex];
      const text = (flagText.value || "").trim();
      if (!text) {
        alert("Type what is wrong or unclear before saving the flag.");
        return;
      }

      flags[q.id] = { text, flaggedAt: new Date().toISOString() };
      saveFlags();
      updateFlagUI(q.id);
      submitFlagToServer(q, text);
    });
  }

  // Clear flag
  if (clearFlagBtn && flagText) {
    clearFlagBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!filteredQuestions.length) return;

      const q = filteredQuestions[currentIndex];
      delete flags[q.id];
      saveFlags();
      flagText.value = "";
      updateFlagUI(q.id);
    });
  }

  // Export flags
  if (exportFlagsBtn) {
    exportFlagsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      exportFlags();
    });
  }
}

// -----------------------------
// Data Loading
// -----------------------------

async function loadQuestions() {
  try {
    const res = await fetch("questions.json", { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load questions.json");
    const data = await res.json();

    if (!Array.isArray(data)) throw new Error("questions.json is not an array");

    allQuestions = data.map((q, idx) => ({
      id: q.id != null ? q.id : idx + 1,
      category: q.category || "General",
      question: q.question || "(Missing question text)",
      answer: q.answer || "",
      reference: q.reference || "",
    }));

    populateCategories();
    updateFilteredQuestions();
    renderCurrentQuestion();
      syncCardHeight();
  } catch (err) {
    console.error(err);
    const qEl = document.getElementById("questionText");
    if (qEl) {
      qEl.textContent =
        "Error loading questions.json. Please ensure the file is present with valid JSON.";
    }
  }
}

function populateCategories() {
  const categorySelect = document.getElementById("categorySelect");
  if (!categorySelect) return;

  categorySelect.innerHTML = "";
  const allOpt = document.createElement("option");
  allOpt.value = "all";
  allOpt.textContent = "All Categories";
  categorySelect.appendChild(allOpt);

  const categories = Array.from(new Set(allQuestions.map((q) => q.category))).sort();
  for (const cat of categories) {
    const opt = document.createElement("option");
    opt.value = cat;
    opt.textContent = cat;
    categorySelect.appendChild(opt);
  }
}

function updateFilteredQuestions() {
  const categorySelect = document.getElementById("categorySelect");
  const selectedCategory = categorySelect ? categorySelect.value : "all";

  filteredQuestions = allQuestions.filter((q) => {
    if (selectedCategory === "all") return true;
    return q.category === selectedCategory;
  });

  if (shuffleEnabled) shuffleArray(filteredQuestions);
  if (currentIndex >= filteredQuestions.length) currentIndex = 0;
}

// -----------------------------
// Rendering (Flashcards only)
// -----------------------------

function renderCurrentQuestion() {
  const questionEl = document.getElementById("questionText");
  const answerEl = document.getElementById("answerText");
  const referenceEl = document.getElementById("referenceText");
  const categoryLabel = document.getElementById("categoryLabel");
  const counterLabel = document.getElementById("counterLabel");
  const modeHint = document.getElementById("modeHint");
  const card = document.getElementById("card");

  const flagText = document.getElementById("flagText");
  const flagPanel = document.getElementById("flagPanel");

  if (!questionEl || !answerEl) return;

  if (!filteredQuestions.length) {
    questionEl.textContent = "No questions available in this category.";
    answerEl.textContent = "";
    if (referenceEl) referenceEl.textContent = "";
    if (categoryLabel) categoryLabel.textContent = "None";
    if (counterLabel) counterLabel.textContent = "0 / 0";
    if (modeHint)
      modeHint.textContent =
        "Flashcards: Tap/click anywhere on the card to flip between question and answer.";
    if (flagPanel) flagPanel.classList.add("hidden");
    if (flagText) flagText.value = "";
    return;
  }

  const q = filteredQuestions[currentIndex];

  if (card) card.classList.remove("flipped");
      syncCardHeight();

  questionEl.textContent = q.question;
  answerEl.textContent = q.answer;

  if (referenceEl) {
    referenceEl.textContent =
      showReference && q.reference ? `Reference: ${q.reference}` : "";
  }

  if (categoryLabel) categoryLabel.textContent = q.category || "Uncategorized";
  if (counterLabel)
    counterLabel.textContent = `${currentIndex + 1} / ${filteredQuestions.length}`;

  if (modeHint)
    modeHint.textContent =
      "Flashcards: Tap/click anywhere on the card to flip between question and answer.";

  // Reset flag panel on render
  if (flagPanel) flagPanel.classList.add("hidden");
  if (flagText) {
    const flagData = flags[q.id];
    flagText.value = flagData ? flagData.text : "";
  }
  updateFlagUI(q.id);
}

// -----------------------------
// Utilities
// -----------------------------

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function showToast(message, duration = 2000) {
  const toast = document.getElementById("toast");
  if (!toast) return;

  toast.textContent = message;
  toast.classList.remove("hidden");
  toast.classList.add("show");

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.classList.add("hidden"), 300);
  }, duration);
}

// -----------------------------
// PWA Setup
// -----------------------------

function setupPWA() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(console.error);
    setVersions();
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;

    const btn = document.getElementById("installBtn");
    if (!btn) return;

    btn.hidden = false;
    btn.addEventListener(
      "click",
      async () => {
        btn.hidden = true;
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
      },
      { once: true }
    );
  });

  const installBtn = document.getElementById("installBtn");
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;

  if (isStandalone && installBtn) installBtn.style.display = "none";
}

function requestCacheVersion() {
  if (!navigator.serviceWorker.controller) return;

  navigator.serviceWorker.controller.postMessage("GET_CACHE_VERSION");
}

navigator.serviceWorker.addEventListener("message", (event) => {
  if (event.data?.type === "CACHE_VERSION") {
    const el = document.getElementById("cacheVersion");
    if (el) {
      el.textContent = `cache ${event.data.cache}`;
    }
  }
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.ready.then(() => {
    requestCacheVersion();
  });
}
