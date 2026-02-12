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

const modeSelect = el("modeSelect");
const subCategorySelect = el("subCategorySelect");
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



const filtersToggleBtn = el("filtersToggleBtn");
const controlsBody = el("controlsBody");

const bottomBar = el("bottomBar");
const bbPrevBtn = el("bbPrevBtn");
const bbNextBtn = el("bbNextBtn");
const bbPrimaryBtn = el("bbPrimaryBtn");
const refDetails = el("refDetails");

const mcContainer = el("mcContainer");
const mcChoices = el("mcChoices");
const mcSubmitBtn = el("mcSubmitBtn");

/* =========================
   STATE
========================= */

let questions = [];
let filteredQuestions = [];
let currentIndex = 0;

let shuffleEnabled = true;
let showReference = true;

// Filter state: Mode + Section
let selectedMode = "flashcard"; // flashcard | mc
let selectedSubCategory = "all";

// Mobile UI state
let controlsCollapsed = false;
// MC per-question UI state
let selectedMcKey = null;
let hasSubmittedMc = false;

// Flags are stored locally for export, and also POSTed to backend
let flags = {}; // { [id]: { text, savedAt, questionSnapshot } }

/* =========================
   RFRSH
========================= */

function setupPullToRefresh() {
  const ptr = document.getElementById("ptr");
  const ptrText = document.getElementById("ptrText");
  if (!ptr || !ptrText) return;

  // If we loaded with a cache-bust param, remove it after load so URLs stay clean
  try {
    const u = new URL(window.location.href);
    if (u.searchParams.has("r")) {
      u.searchParams.delete("r");
      window.history.replaceState(null, "", u.pathname + (u.search ? u.search : "") + u.hash);
    }
  } catch {}

  let startY = 0;
  let pulling = false;
  let dist = 0;
  const THRESHOLD = 80;

  const isInteractive = (target) => {
    if (!target) return false;
    const tag = (target.tagName || "").toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || tag === "button";
  };

  const show = () => { ptr.classList.remove("hidden"); };
  const hide = () => { ptr.classList.add("hidden"); ptr.style.transform = "translateY(-64px)"; };

  const setPull = (px) => {
    // Ease the pull distance so it feels nicer
    const eased = Math.min(110, px * 0.6);
    ptr.style.transform = `translateY(${eased - 64}px)`;
  };

  const doRefresh = () => {
    ptrText.textContent = "Refreshing…";
    // Cache-busting reload so iOS standalone + SW actually refreshes
    const u = new URL(window.location.href);
    u.searchParams.set("r", Date.now().toString());
    window.location.replace(u.toString());
  };

  window.addEventListener("touchstart", (e) => {
    if (isInteractive(e.target)) return;

    // Only activate when at top of page
    if (window.scrollY > 0) return;

    startY = e.touches[0].clientY;
    pulling = true;
    dist = 0;

    ptrText.textContent = "Pull to refresh";
    show();
  }, { passive: true });

  window.addEventListener("touchmove", (e) => {
    if (!pulling) return;
    if (isInteractive(e.target)) return;
    if (window.scrollY > 0) return;

    const y = e.touches[0].clientY;
    dist = Math.max(0, y - startY);

    if (dist > 0) {
      // prevent iOS rubber-band from feeling weird while we show our own PTR
      e.preventDefault();
      setPull(dist);

      if (dist >= THRESHOLD) {
        ptrText.textContent = "Release to refresh";
      } else {
        ptrText.textContent = "Pull to refresh";
      }
    }
  }, { passive: false });

  window.addEventListener("touchend", () => {
    if (!pulling) return;
    pulling = false;

    if (dist >= THRESHOLD) {
      doRefresh();
    } else {
      hide();
    }
  });

  window.addEventListener("touchcancel", () => {
    pulling = false;
    hide();
  });
}

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







function normalizeMcSection(category) {
  const c = safeText(category).toLowerCase();
  if (c.includes("airdrop")) return "Airdrop";
  if (c.includes("instructor")) return "Instructor";
  return "General";
}
function isMobileUI() {
  return window.matchMedia && window.matchMedia("(max-width: 768px)").matches;
}

function setControlsCollapsed(collapsed) {
  controlsCollapsed = !!collapsed;
  if (controlsBody) controlsBody.classList.toggle("collapsed", controlsCollapsed);
  try { localStorage.setItem("c17_controls_collapsed", controlsCollapsed ? "1" : "0"); } catch (_) {}
}

function syncBottomBarPresence() {
  document.body.classList.toggle("has-bottom-bar", isMobileUI());
}
/* =========================
   MULTIPLE CHOICE (separate file)
   - questions_mc.json contains MC items with choices + correctKey
========================= */

const QUESTIONS_FREE_RESPONSE_URL = "questions.json";
const QUESTIONS_MULTIPLE_CHOICE_URL = "questions_mc.json";

function normalizeFreeResponseQuestions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(Boolean)
    .map((q, idx) => ({
      id: q.id || q.ID || `FR_${idx}`,
      type: "fr",
      category: safeText(q.category || q.Category),
      question: safeText(q.question || q.prompt || q.Question),
      answer: safeText(q.answer || q.Answer),
      reference: safeText(q.reference || q.Reference || q.ref),
    }))
    .filter(q => q.question.trim().length > 0);
}

function normalizeMultipleChoiceQuestions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(Boolean)
    .map((q, idx) => ({
      id: q.id || `MC_${idx}`,
      type: "mc",
      category: safeText(q.category || q.Category),
      question: safeText(q.prompt || q.question || ""),
      choices: Array.isArray(q.choices) ? q.choices : [],
      correctKey: safeText(q.correctKey).trim(),
      answer: safeText(q.correctKey).trim(),
      explanation: safeText(q.explanation),
      reference: safeText(q.reference),
    }))
    .filter(q => q.question.trim().length > 0 && q.choices.length >= 2 && q.correctKey);
}

async function loadQuestionsMerged() {
  const [freeRaw, mcRaw] = await Promise.all([
    fetch(`${QUESTIONS_FREE_RESPONSE_URL}?v=${encodeURIComponent(APP_VERSION)}`, { cache: "no-store" })
      .then(r => (r.ok ? r.json() : []))
      .catch(() => []),
    fetch(`${QUESTIONS_MULTIPLE_CHOICE_URL}?v=${encodeURIComponent(APP_VERSION)}`, { cache: "no-store" })
      .then(r => (r.ok ? r.json() : []))
      .catch(() => []),
  ]);

  const free = normalizeFreeResponseQuestions(freeRaw);
  const mc = normalizeMultipleChoiceQuestions(mcRaw);
  return [...free, ...mc];
}

function escapeHtml(str) {
  return (str ?? "").toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

  // ✅ allow the container to shrink before we measure
  inner.style.height = "auto";

  // Measure the active face
  const prevOverflow = face.style.overflow;
  face.style.overflow = "visible";
  const h = Math.ceil(face.scrollHeight) + 2;

  face.style.overflow = prevOverflow;
   
  // ✅ set an explicit height (so it can shrink too)
  inner.style.height = `${h}px`;
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
  let json = null;
   try {
     json = JSON.parse(text);
   } catch (e) {
     // If server returned a plain-text error, surface it clearly
     if (text && text.startsWith("ERROR")) {
       throw new Error(text);
     }
     // Otherwise don't hard-fail on non-JSON responses
     json = null;
   }
   
   if (json && json.ok === false) {
     throw new Error(json.error || "Server returned ok:false");
   }

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
  // Loads BOTH questions.json (free-response flashcards) and questions_mc.json (multiple choice)
  const merged = await loadQuestionsMerged();
  if (!Array.isArray(merged)) throw new Error("Questions must be an array");
  return merged;
}

function populateModeAndSections() {
  // Mode dropdown
  if (modeSelect) {
    modeSelect.value = selectedMode;
  }

  // Section dropdown depends on mode:
  // - Flashcard: unique categories from free-response questions (type === 'fr')
  // - Multiple Choice: General / Airdrop / Instructor (from MC questions)
  if (!subCategorySelect) return;

  let sections = [];
  if (selectedMode === "mc") {
    sections = ["General", "Airdrop", "Instructor"];
  } else {
    sections = Array.from(
      new Set(
        questions
          .filter(q => q.type === "fr")
          .map(q => safeText(q.category).trim())
          .filter(Boolean)
      )
    ).sort();
  }

  const opts = [`<option value="all">All</option>`].concat(
    sections.map(s => {
      const v = s.replace(/"/g, "&quot;");
      return `<option value="${v}">${v}</option>`;
    })
  );

  subCategorySelect.innerHTML = opts.join("");
  // Keep selection if still valid, otherwise reset
  const stillValid =
    selectedSubCategory === "all" ||
    sections.includes(selectedSubCategory);

  selectedSubCategory = stillValid ? selectedSubCategory : "all";
  subCategorySelect.value = selectedSubCategory;
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
  // Mode filter
  let list = questions;

  if (selectedMode === "mc") {
    list = list.filter(q => q.type === "mc");
  } else {
    list = list.filter(q => q.type === "fr");
  }

  // Section filter
  if (selectedSubCategory && selectedSubCategory !== "all") {
    list = list.filter(q => {
      if (q.type === "mc") return normalizeMcSection(q.category) === selectedSubCategory;
      return safeText(q.category).trim() === selectedSubCategory;
    });
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
    if (mcContainer) mcContainer.classList.add("hidden");
    requestAnimationFrame(syncCardHeight);
    return;
  }

  const q = filteredQuestions[currentIndex];

  // Reset MC state whenever question changes
  selectedMcKey = null;
  hasSubmittedMc = false;

  // Question text
  if (questionText) questionText.textContent = safeText(q.question);

  // Reference handling on answer face
  if (referenceText) {
    // For MC we may show reference after submit; default to user's toggle behavior
    referenceText.textContent = showReference ? safeText(q.reference) : "";
    referenceText.style.display = showReference ? "block" : "none";
  }

  // Category/counter
  if (categoryLabel) categoryLabel.textContent = safeText(q.category || "Category");
  if (counterLabel) counterLabel.textContent = `${currentIndex + 1} / ${filteredQuestions.length}`;

  // Mode hint + per-type UI
  if (q.type === "mc") {
    if (modeHint) modeHint.textContent = "Select an option, then tap Submit";
          
    // Show MC container and build choices
    if (mcContainer) mcContainer.classList.remove("hidden");
    if (mcChoices) mcChoices.innerHTML = "";
    if (mcSubmitBtn) mcSubmitBtn.style.display = isMobileUI() ? "none" : "inline-flex";

    // Disable submit until a selection is made
    if (mcSubmitBtn) mcSubmitBtn.disabled = true;

    const choices = Array.isArray(q.choices) ? q.choices : [];
    choices.forEach((choice) => {
      const key = safeText(choice.key).trim();
      const text = safeText(choice.text);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mc-choice";
      btn.dataset.key = key;
      btn.innerHTML = `<span class="mc-key">${escapeHtml(key)}</span><span class="mc-text">${escapeHtml(text)}</span>`;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (hasSubmittedMc) return;
        selectedMcKey = key;

        // visual selected
        [...mcChoices.querySelectorAll(".mc-choice")].forEach(b => b.classList.remove("selected"));
        btn.classList.add("selected");

        if (mcSubmitBtn) mcSubmitBtn.disabled = false;
        requestAnimationFrame(syncCardHeight);
      
        if (bbPrimaryBtn && q.type === "mc" && !hasSubmittedMc) bbPrimaryBtn.disabled = false;
});
      mcChoices.appendChild(btn);
    });

    if (mcSubmitBtn) {
      mcSubmitBtn.onclick = (e) => {
        e.stopPropagation();
        submitMultipleChoice(q);
      };
    }

    // For MC, clear answer until submitted
    if (answerText) answerText.textContent = "";

  } else {
    if (modeHint) modeHint.textContent = "Tap/click the card to flip";
    if (mcContainer) mcContainer.classList.add("hidden");
    if (mcSubmitBtn) mcSubmitBtn.style.display = "none";

    // Free-response uses the stored answer
    if (answerText) answerText.textContent = safeText(q.answer);
  }

  updateFlagStatusUI(q);

  // Close flag panel when navigating/questions change
  setFlagPanelOpen(false);

  // Make sure card starts unflipped on new question
  if (card) card.classList.remove("flipped");

  // sync height after DOM paints
  
  // Bottom bar behavior (mobile)
  if (bbPrimaryBtn) {
    if (q.type === "mc") {
      bbPrimaryBtn.textContent = hasSubmittedMc ? "Next" : "Submit";
      bbPrimaryBtn.disabled = (!hasSubmittedMc && !selectedMcKey);
    } else {
      bbPrimaryBtn.textContent = "Flip";
      bbPrimaryBtn.disabled = false;
    }
  }
  if (refDetails) {
    if (isMobileUI()) refDetails.open = false;
  }

  requestAnimationFrame(syncCardHeight);
}



function submitMultipleChoice(q) {
  if (!q || q.type !== "mc") return;
  if (!selectedMcKey) return;

  hasSubmittedMc = true;
  if (mcSubmitBtn) mcSubmitBtn.disabled = true;

  
  if (bbPrimaryBtn) { bbPrimaryBtn.textContent = "Next"; bbPrimaryBtn.disabled = false; }
const selected = safeText(selectedMcKey).trim().toUpperCase();
  const correctKey = safeText(q.correctKey).trim().toUpperCase();
  const isCorrect = (selected === correctKey);

  // Find correct choice text
  const correctChoice = (Array.isArray(q.choices) ? q.choices : []).find(c => safeText(c.key).trim().toUpperCase() === correctKey);
  const correctText = correctChoice ? `${safeText(correctChoice.key)} — ${safeText(correctChoice.text)}` : correctKey;

  // Highlight choices
  if (mcChoices) {
    [...mcChoices.querySelectorAll(".mc-choice")].forEach((b) => {
      const k = safeText(b.dataset.key).trim().toUpperCase();
      if (k === correctKey) b.classList.add("correct");
      if (k === selected && !isCorrect) b.classList.add("incorrect");
    });
  }

  // Populate the answer face
  const header = isCorrect ? "Correct ✅" : "Incorrect ❌";
  const explain = safeText(q.explanation).trim();
  const ref = safeText(q.reference).trim();

  if (answerText) {
    answerText.innerHTML = `
      <div class="mc-result">${escapeHtml(header)}</div>
      <div class="mc-correct"><b>Correct:</b> ${escapeHtml(correctText)}</div>
      ${explain ? `<div class="mc-explain">${escapeHtml(explain)}</div>` : ""}
    `;
  }

  // Reference toggle still applies
  if (referenceText) {
    referenceText.textContent = (showReference && ref) ? ref : "";
    referenceText.style.display = (showReference && ref) ? "block" : "none";
  }

  // Auto-flip to show the answer once submitted
  if (card) card.classList.add("flipped");

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
    // Disable tap-to-flip for multiple choice (prevents reference/choice taps from flipping)
    const q = currentQuestion();
    if (q && q.type === "mc") return;

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
    if (isMobileUI()) setControlsCollapsed(true);
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

  if (modeSelect) {
    modeSelect.addEventListener("change", () => {
      selectedMode = modeSelect.value === "mc" ? "mc" : "flashcard";
      currentIndex = 0;
      // Rebuild sections for the new mode
      populateModeAndSections();
      updateFilteredQuestions();
      renderCurrentQuestion();
    });
  }

  if (subCategorySelect) {
    subCategorySelect.addEventListener("change", () => {
      selectedSubCategory = subCategorySelect.value || "all";
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


  // Mobile: Filters collapse toggle
  if (filtersToggleBtn) {
    filtersToggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      setControlsCollapsed(!controlsCollapsed);
      showToast(controlsCollapsed ? "Filters hidden" : "Filters shown", 1200);
    });
  }

  // Mobile: Bottom bar navigation mirrors main buttons
  if (bbPrevBtn) {
    bbPrevBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      prevBtn?.click();
    });
  }
  if (bbNextBtn) {
    bbNextBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      nextBtn?.click();
    });
  }
  if (bbPrimaryBtn) {
  bbPrimaryBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const q = currentQuestion();
    if (!q) return;

    if (q.type === "mc") {
      if (hasSubmittedMc) {
        nextBtn?.click();
      } else {
        submitMultipleChoice(q);
      }
    } else {
      // Flashcard flip
      if (card) card.classList.toggle("flipped");
      requestAnimationFrame(syncCardHeight);
    }
  });
}

// Prevent reference disclosure clicks from bubbling to the card
if (refDetails) {
  refDetails.addEventListener("click", (e) => e.stopPropagation());
}

 else {
        if (card) card.classList.toggle("flipped");
        requestAnimationFrame(syncCardHeight);
      }
    });
  }

  // Resize should re-sync
  window.addEventListener("resize", () => { syncBottomBarPresence(); requestAnimationFrame(syncCardHeight); });
}

/* =========================
   INIT
========================= */

async function init() {
  setAppVersionUI();
  setupCacheVersionListener();
  setupUpdateFlow();
  setupInstallPrompt();
  setupPullToRefresh();
  syncBottomBarPresence();
  // Load flags from localStorage (export still works offline)
  try {
    const raw = localStorage.getItem("c17_flags");
    if (raw) flags = JSON.parse(raw) || {};
  } catch {
    flags = {};
  }


  // Load mobile UI prefs
  try { controlsCollapsed = (localStorage.getItem("c17_controls_collapsed") === "1"); } catch (_) { controlsCollapsed = false; }
  if (isMobileUI()) setControlsCollapsed(controlsCollapsed);

  // Load questions
  try {
    questions = await loadQuestions();
  } catch (e) {
    console.error(e);
    if (questionText) questionText.textContent = "Error loading questions.json. Check console.";
    showToast("❌ Failed to load questions.json");
    return;
  }

  populateModeAndSections();

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
