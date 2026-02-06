// ===============================
// C-17 Loadmaster Study App - app.js
// ===============================

// Update this string whenever you push a meaningful new build
const APP_VERSION = "1.2.1";
const versionEl = document.getElementById("appVersion");
if (versionEl) {
  versionEl.textContent = `v${APP_VERSION}`;
}

// Backend endpoint for saving flags (Google Apps Script web app URL)
const FLAG_API_URL = "https://script.google.com/macros/s/AKfycbwyssy1vWNQW_WbBj5LVXjf_-UDF-B4oHLWAg3YVoolfGpgVNDsiBY6BVdtBXs4JP9iCA/exec";

// -------------------------------
// DOM
// -------------------------------
const els = {
  card: document.getElementById("card"),
  questionText: document.getElementById("questionText"),
  answerText: document.getElementById("answerText"),
  referenceText: document.getElementById("referenceText"),
  categoryLabel: document.getElementById("categoryLabel"),
  counterLabel: document.getElementById("counterLabel"),
  modeHint: document.getElementById("modeHint"),

  categorySelect: document.getElementById("categorySelect"),
  modeSelect: document.getElementById("modeSelect"),
  shuffleToggle: document.getElementById("shuffleToggle"),
  showRefToggle: document.getElementById("showRefToggle"),

  prevBtn: document.getElementById("prevBtn"),
  nextBtn: document.getElementById("nextBtn"),
  flipBackBtn: document.getElementById("flipBackBtn"),

  mcArea: document.getElementById("mcArea"),
  mcOptions: document.getElementById("mcOptions"),

  shortAnswerArea: document.getElementById("shortAnswerArea"),
  shortAnswerInput: document.getElementById("shortAnswerInput"),
  checkShortAnswerBtn: document.getElementById("checkShortAnswerBtn"),

  correctCount: document.getElementById("correctCount"),
  attemptCount: document.getElementById("attemptCount"),
  progressBar: document.getElementById("progressBar"),

  flagToggleBtn: document.getElementById("flagToggleBtn"),
  flagStatus: document.getElementById("flagStatus"),
  flagPanel: document.getElementById("flagPanel"),
  flagText: document.getElementById("flagText"),
  saveFlagBtn: document.getElementById("saveFlagBtn"),
  clearFlagBtn: document.getElementById("clearFlagBtn"),
  exportFlagsBtn: document.getElementById("exportFlagsBtn"),

  toast: document.getElementById("toast"),
  installBtn: document.getElementById("installBtn"),
  appVersion: document.getElementById("appVersion"),
};

// -------------------------------
// State
// -------------------------------
let allQuestions = [];
let filteredQuestions = [];
let currentIndex = 0;

let correct = 0;
let attempts = 0;

const LS_KEYS = {
  flags: "lmStudy_flags_v1",
  deviceId: "lmStudy_deviceId_v1",
};

function getDeviceId() {
  let id = localStorage.getItem(LS_KEYS.deviceId);
  if (!id) {
    id = "dev-" + Math.random().toString(36).slice(2, 10) + "-" + Date.now().toString(36);
    localStorage.setItem(LS_KEYS.deviceId, id);
  }
  return id;
}

function getFlags() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEYS.flags) || "[]");
  } catch {
    return [];
  }
}

function setFlags(arr) {
  localStorage.setItem(LS_KEYS.flags, JSON.stringify(arr));
}

// -------------------------------
// Utilities
// -------------------------------
function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function normalize(str) {
  return (str || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'");
}

let toastTimer = null;
function showToast(message, ms = 2200) {
  if (!els.toast) return;
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), ms);
}

function downloadJSON(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Close + reset flag UI
function closeFlagPanel({ clearText = true } = {}) {
  if (!els.flagPanel) return;
  els.flagPanel.classList.add("hidden");
  els.card?.classList.remove("flag-open");
  if (clearText && els.flagText) els.flagText.value = "";
  if (els.flagStatus) els.flagStatus.textContent = "";
}

// -------------------------------
// Loading + filtering
// -------------------------------
async function loadQuestions() {
  try {
    const res = await fetch("questions.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // Minimal validation / normalization
    allQuestions = (Array.isArray(data) ? data : []).map((q, idx) => ({
      id: q.id ?? idx + 1,
      category: q.category || "Uncategorized",
      question: q.question || "",
      answer: q.answer || "",
      reference: q.reference || "",
      choices: Array.isArray(q.choices) ? q.choices : null,
    }));

    populateCategoryDropdown();
    updateFilteredQuestions(true);
    renderCurrentQuestion();
    showToast("Questions loaded.");
  } catch (err) {
    console.error(err);
    els.questionText.textContent = "Error loading questions.json";
    els.modeHint.textContent = "Please ensure the file is present with valid JSON.";
    showToast("Error loading questions.json");
  }
}

function populateCategoryDropdown() {
  const cats = Array.from(new Set(allQuestions.map(q => q.category))).sort((a, b) =>
    a.localeCompare(b)
  );

  // keep first option "all"
  els.categorySelect.innerHTML = `<option value="all">All Categories</option>`;
  for (const c of cats) {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    els.categorySelect.appendChild(opt);
  }
}

function updateFilteredQuestions(resetIndex = false) {
  const selectedCat = els.categorySelect.value;
  const mode = els.modeSelect.value;
  const doShuffle = !!els.shuffleToggle.checked;

  let base = allQuestions.slice();
  if (selectedCat !== "all") base = base.filter(q => q.category === selectedCat);

  // Shuffle the *set* if desired
  filteredQuestions = doShuffle ? shuffleArray(base) : base;

  if (resetIndex) currentIndex = 0;
  // If currentIndex fell out of bounds (e.g., category change), clamp it
  if (currentIndex < 0) currentIndex = 0;
  if (currentIndex >= filteredQuestions.length) currentIndex = Math.max(filteredQuestions.length - 1, 0);

  // Mode-specific UI changes happen in render
  els.modeHint.textContent = mode === "flashcard"
    ? "Tap/click anywhere on the card to flip between question and answer."
    : mode === "multiple-choice"
      ? "Pick an answer, then flip the card to confirm."
      : "Type your answer, hit “Check Answer”, then flip to see the official answer + reference.";
}

// -------------------------------
// Render
// -------------------------------
function renderCurrentQuestion() {
  // Always collapse the flag panel when the question changes
  closeFlagPanel({ clearText: true });

  // Reset flip state + per-question inputs
  els.card.classList.remove("flipped");
  els.shortAnswerInput.value = "";
  els.mcOptions.innerHTML = "";
  els.mcArea.classList.add("hidden");
  els.shortAnswerArea.classList.add("hidden");

  if (!filteredQuestions.length) {
    els.questionText.textContent = "No questions in this filter.";
    els.answerText.textContent = "";
    els.referenceText.textContent = "";
    els.categoryLabel.textContent = "Category";
    els.counterLabel.textContent = "0 / 0";
    updateProgressUI();
    return;
  }

  const q = filteredQuestions[currentIndex];

  els.questionText.textContent = q.question || "(No question text)";
  els.answerText.textContent = q.answer || "(No answer provided)";
  els.referenceText.textContent = q.reference ? `Reference: ${q.reference}` : "";
  els.referenceText.style.display = els.showRefToggle.checked ? "block" : "none";

  els.categoryLabel.textContent = (q.category || "Category").toUpperCase();
  els.counterLabel.textContent = `${currentIndex + 1} / ${filteredQuestions.length}`;

  // Flag status
  const flags = getFlags();
  const existing = flags.find(f => String(f.questionId) === String(q.id));
  els.flagStatus.textContent = existing ? "Flag saved ✅" : "";

  // Mode areas
  const mode = els.modeSelect.value;
  if (mode === "multiple-choice") {
    els.mcArea.classList.remove("hidden");
    renderMultipleChoice(q);
  } else if (mode === "short-answer") {
    els.shortAnswerArea.classList.remove("hidden");
  }

  updateProgressUI();
}

function renderMultipleChoice(q) {
  const correctAnswer = (q.answer || "").trim();
  let options = [];

  if (Array.isArray(q.choices) && q.choices.length >= 2) {
    options = q.choices.slice();
    // ensure correct answer appears
    if (correctAnswer && !options.some(o => normalize(o) === normalize(correctAnswer))) {
      options.push(correctAnswer);
    }
  } else {
    // Generate plausible distractors from other answers
    const pool = allQuestions
      .map(x => (x.answer || "").trim())
      .filter(a => a && normalize(a) !== normalize(correctAnswer));

    options = [correctAnswer];

    while (options.length < 4 && pool.length) {
      const pick = pool[Math.floor(Math.random() * pool.length)];
      if (!options.some(o => normalize(o) === normalize(pick))) options.push(pick);
      if (options.length >= 4) break;
    }
  }

  options = shuffleArray(options).slice(0, 4).filter(Boolean);

  els.mcOptions.innerHTML = "";
  options.forEach(opt => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn option";
    btn.textContent = opt;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      attempts += 1;

      const isCorrect = normalize(opt) === normalize(correctAnswer);
      if (isCorrect) {
        correct += 1;
        showToast("✅ Correct");
        btn.classList.add("correct");
      } else {
        showToast("❌ Incorrect");
        btn.classList.add("incorrect");
      }
      updateProgressUI();

      // Disable all options after selection
      Array.from(els.mcOptions.querySelectorAll("button")).forEach(b => (b.disabled = true));
    });
    els.mcOptions.appendChild(btn);
  });
}

function updateProgressUI() {
  els.correctCount.textContent = String(correct);
  els.attemptCount.textContent = String(attempts);

  const total = filteredQuestions.length || 0;
  const pct = total ? Math.round(((currentIndex + 1) / total) * 100) : 0;
  els.progressBar.style.width = `${pct}%`;
}

// -------------------------------
// Navigation
// -------------------------------
function goNext() {
  if (!filteredQuestions.length) return;
  currentIndex = (currentIndex + 1) % filteredQuestions.length;
  renderCurrentQuestion();
}

function goPrev() {
  if (!filteredQuestions.length) return;
  currentIndex = (currentIndex - 1 + filteredQuestions.length) % filteredQuestions.length;
  renderCurrentQuestion();
}

// -------------------------------
// Flagging
// -------------------------------
function openFlagPanel() {
  if (!els.flagPanel) return;
  els.flagPanel.classList.remove("hidden");
  els.card?.classList.add("flag-open");
  els.flagText?.focus();
}

function toggleFlagPanel() {
  if (!els.flagPanel) return;
  const isHidden = els.flagPanel.classList.contains("hidden");
  if (isHidden) openFlagPanel();
  else closeFlagPanel({ clearText: false });
}

async function submitFlagToServer(flagPayload) {
  // We try CORS first (best for debugging), then fallback to no-cors (fire-and-forget).
  const body = JSON.stringify(flagPayload);

  try {
    const res = await fetch(FLAG_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      mode: "cors",
      redirect: "follow",
    });
    // Apps Script often replies with text
    if (res && res.ok) return true;
    return false;
  } catch (err) {
    // CORS / network issue — fallback
    try {
      await fetch(FLAG_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        mode: "no-cors",
      });
      return true;
    } catch (e2) {
      console.error("Flag submit failed:", err, e2);
      return false;
    }
  }
}

async function saveFlag() {
  if (!filteredQuestions.length) return;
  const q = filteredQuestions[currentIndex];
  const note = (els.flagText.value || "").trim();

  const payload = {
    appVersion: APP_VERSION,
    timestamp: new Date().toISOString(),
    deviceId: getDeviceId(),
    userAgent: navigator.userAgent,

    questionId: q.id,
    category: q.category,
    question: q.question,
    answer: q.answer,
    reference: q.reference || "",
    note,
    url: location.href,
  };

  // Save local
  const flags = getFlags();
  const idx = flags.findIndex(f => String(f.questionId) === String(q.id));
  if (idx >= 0) flags[idx] = payload;
  else flags.push(payload);
  setFlags(flags);

  els.flagStatus.textContent = "Flag saved ✅";
  showToast("Flag saved.");

  // Send to backend
  const ok = await submitFlagToServer(payload);
  if (ok) showToast("Flag sent to dev sheet ✅");
  else showToast("Saved locally (send failed)");
}

function clearFlag() {
  if (!filteredQuestions.length) return;
  const q = filteredQuestions[currentIndex];

  // Clear local
  const flags = getFlags().filter(f => String(f.questionId) !== String(q.id));
  setFlags(flags);

  closeFlagPanel({ clearText: true });
  showToast("Flag cleared.");
}

// -------------------------------
// Short Answer checking
// -------------------------------
function checkShortAnswer() {
  if (!filteredQuestions.length) return;

  const q = filteredQuestions[currentIndex];
  const user = normalize(els.shortAnswerInput.value);
  const official = normalize(q.answer);

  if (!user) {
    showToast("Type an answer first.");
    return;
  }

  attempts += 1;
  const isCorrect = user === official;
  if (isCorrect) {
    correct += 1;
    showToast("✅ Correct");
  } else {
    showToast("❌ Not quite");
  }
  updateProgressUI();
}

// -------------------------------
// PWA install button (kept, but you can hide on mobile via CSS)
// -------------------------------
let deferredPrompt = null;
if (els.installBtn) els.installBtn.style.display = "none";

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (els.installBtn) els.installBtn.style.display = "inline-flex";
});

els.installBtn?.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  els.installBtn.style.display = "none";
});

// -------------------------------
// Event wiring
// -------------------------------
function isInteractiveTarget(target) {
  if (!target) return false;
  return !!target.closest("button, a, input, textarea, select, label");
}

els.card?.addEventListener("click", (e) => {
  // Don't flip when clicking interactive controls inside the card
  if (isInteractiveTarget(e.target)) return;
  els.card.classList.toggle("flipped");
});

els.flipBackBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  els.card.classList.remove("flipped");
});

els.prevBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  goPrev();
});

els.nextBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  goNext();
});

// Collapse flag panel when moving via keyboard arrows too
window.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight") goNext();
  if (e.key === "ArrowLeft") goPrev();
});

els.categorySelect?.addEventListener("change", () => {
  updateFilteredQuestions(true);
  renderCurrentQuestion();
});

els.modeSelect?.addEventListener("change", () => {
  updateFilteredQuestions(false);
  renderCurrentQuestion();
});

els.shuffleToggle?.addEventListener("change", () => {
  updateFilteredQuestions(true);
  renderCurrentQuestion();
});

els.showRefToggle?.addEventListener("change", () => {
  // No need to refilter; just show/hide ref
  els.referenceText.style.display = els.showRefToggle.checked ? "block" : "none";
});

els.checkShortAnswerBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  checkShortAnswer();
});

els.flagToggleBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleFlagPanel();
});

els.saveFlagBtn?.addEventListener("click", async (e) => {
  e.stopPropagation();
  await saveFlag();
  // keep panel open so user can edit, but don't overflow the card
});

els.clearFlagBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  clearFlag();
});

els.exportFlagsBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  const flags = getFlags();
  if (!flags.length) {
    showToast("No flags to export.");
    return;
  }
  downloadJSON(`flags_export_${new Date().toISOString().slice(0, 10)}.json`, flags);
  showToast("Flags exported.");
});

// -------------------------------
// Init
// -------------------------------
if (els.appVersion) els.appVersion.textContent = APP_VERSION;
loadQuestions();
