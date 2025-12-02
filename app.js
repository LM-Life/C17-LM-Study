// ===============================
// C-17 LM Study App - app.js
// ===============================

// Update this string whenever you push a meaningful new build
const APP_VERSION = "v1.2.0 - MQF Oct 2025 + Airdrop + Flags";

// Question data
let allQuestions = [];
let filteredQuestions = [];
let currentIndex = 0;

// Modes / settings
let currentMode = "flashcard";
let shuffleEnabled = true;
let showReference = true;

// Stats
let stats = {
  attempts: 0,
  correct: 0
};

// PWA install prompt
let deferredPrompt = null;

// Per-device flag storage: { [questionId]: { text, flaggedAt } }
let flags = {};

// ===============================
// Init
// ===============================

document.addEventListener("DOMContentLoaded", () => {
  // Show app version in footer if element exists
  const versionEl = document.getElementById("appVersion");
  if (versionEl) {
    versionEl.textContent = APP_VERSION;
  }

  loadFlags();
  setupUI();
  loadQuestions();
  setupPWA();
});

// ===============================
// Flags: localStorage helpers
// ===============================

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

  // Include question text for context if possible
  const exportData = entries.map(([id, data]) => {
    const numericId = Number(id);
    const q = allQuestions.find(q => q.id === numericId);
    return {
      id: numericId,
      question: q ? q.question : "(Question not found in current bank)",
      answer: q ? q.answer : "",
      category: q ? q.category : "",
      reference: q && q.reference ? q.reference : "",
      flagText: data.text,
      flaggedAt: data.flaggedAt
    };
  });

  const blob = new Blob([JSON.stringify(exportData, null, 2)], {
    type: "application/json"
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

// ===============================
// UI Setup
// ===============================

function setupUI() {
  const card = document.getElementById("card");
  const modeSelect = document.getElementById("modeSelect");
  const shuffleToggle = document.getElementById("shuffleToggle");
  const showRefToggle = document.getElementById("showRefToggle");
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  const flipBackBtn = document.getElementById("flipBackBtn");
  const checkShortAnswerBtn = document.getElementById("checkShortAnswerBtn");
  const categorySelect = document.getElementById("categorySelect");

  // Flag-related elements
  const flagToggleBtn = document.getElementById("flagToggleBtn");
  const flagPanel = document.getElementById("flagPanel");
  const saveFlagBtn = document.getElementById("saveFlagBtn");
  const clearFlagBtn = document.getElementById("clearFlagBtn");
  const flagText = document.getElementById("flagText");
  const exportFlagsBtn = document.getElementById("exportFlagsBtn"); // optional

  // Card flip
  card.addEventListener("click", (e) => {
    // Don't flip when interacting with inputs/buttons inside the card
    if (
      e.target.closest("textarea") ||
      e.target.closest("button") ||
      e.target.closest(".mc-option")
    ) {
      return;
    }
    card.classList.toggle("flipped");
  });

  flipBackBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    card.classList.remove("flipped");
  });

  // Mode change
  modeSelect.addEventListener("change", () => {
    currentMode = modeSelect.value;
    currentIndex = 0;
    updateFilteredQuestions();
    renderCurrentQuestion();
  });

  // Shuffle toggle
  shuffleToggle.addEventListener("change", () => {
    shuffleEnabled = shuffleToggle.checked;
    updateFilteredQuestions();
    renderCurrentQuestion();
  });

  // Show reference toggle
  showRefToggle.addEventListener("change", () => {
    showReference = showRefToggle.checked;
    renderCurrentQuestion();
  });

  // Navigation
  prevBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!filteredQuestions.length) return;
    currentIndex = (currentIndex - 1 + filteredQuestions.length) % filteredQuestions.length;
    card.classList.remove("flipped");
    renderCurrentQuestion();
  });

  nextBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!filteredQuestions.length) return;
    currentIndex = (currentIndex + 1) % filteredQuestions.length;
    card.classList.remove("flipped");
    renderCurrentQuestion();
  });

  // Short answer check
  checkShortAnswerBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    handleShortAnswerCheck();
  });

  // Category filter
  categorySelect.addEventListener("change", () => {
    currentIndex = 0;
    updateFilteredQuestions();
    renderCurrentQuestion();
  });

  // Flag UI: toggle panel
  if (flagToggleBtn && flagPanel) {
    flagToggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      flagPanel.classList.toggle("hidden");
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
      flags[q.id] = {
        text,
        flaggedAt: new Date().toISOString()
      };
      saveFlags();
      updateFlagUI(q.id);
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

  // Export flags (optional button for you / power users)
  if (exportFlagsBtn) {
    exportFlagsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      exportFlags();
    });
  }
}

// ===============================
// Data Loading
// ===============================

async function loadQuestions() {
  try {
    const res = await fetch("questions.json");
    if (!res.ok) throw new Error("Failed to load questions.json");
    const data = await res.json();

    if (!Array.isArray(data)) {
      throw new Error("questions.json is not an array of questions");
    }

    // Normalize: make sure each question has required fields
    allQuestions = data.map((q, idx) => ({
      id: q.id != null ? q.id : idx + 1,
      category: q.category || "General",
      question: q.question || "(Missing question text)",
      answer: q.answer || "",
      reference: q.reference || ""
    }));

    populateCategories();
    updateFilteredQuestions();
    renderCurrentQuestion();
  } catch (err) {
    console.error(err);
    document.getElementById("questionText").textContent =
      "Error loading questions.json. Please ensure the file is present with valid JSON.";
  }
}

function populateCategories() {
  const categorySelect = document.getElementById("categorySelect");
  if (!categorySelect) return;

  // Reset and add "All"
  categorySelect.innerHTML = "";
  const allOpt = document.createElement("option");
  allOpt.value = "all";
  allOpt.textContent = "All Categories";
  categorySelect.appendChild(allOpt);

  const categories = Array.from(new Set(allQuestions.map(q => q.category))).sort();
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

  filteredQuestions = allQuestions.filter(q => {
    if (selectedCategory === "all") return true;
    return q.category === selectedCategory;
  });

  if (shuffleEnabled) {
    shuffleArray(filteredQuestions);
  }

  if (currentIndex >= filteredQuestions.length) {
    currentIndex = 0;
  }
}

// ===============================
// Rendering
// ===============================

function renderCurrentQuestion() {
  const questionEl = document.getElementById("questionText");
  const answerEl = document.getElementById("answerText");
  const referenceEl = document.getElementById("referenceText");
  const categoryLabel = document.getElementById("categoryLabel");
  const counterLabel = document.getElementById("counterLabel");
  const modeHint = document.getElementById("modeHint");
  const shortAnswerArea = document.getElementById("shortAnswerArea");
  const mcArea = document.getElementById("mcArea");
  const mcOptionsContainer = document.getElementById("mcOptions");
  const card = document.getElementById("card");
  const flagText = document.getElementById("flagText");
  const flagPanel = document.getElementById("flagPanel");

  if (!filteredQuestions.length) {
    questionEl.textContent = "No questions available in this category.";
    answerEl.textContent = "";
    referenceEl.textContent = "";
    categoryLabel.textContent = "None";
    counterLabel.textContent = "0 / 0";
    shortAnswerArea.classList.add("hidden");
    mcArea.classList.add("hidden");
    if (flagPanel) flagPanel.classList.add("hidden");
    if (flagText) flagText.value = "";
    updateProgressUI();
    return;
  }

  const q = filteredQuestions[currentIndex];

  // Reset card side
  card.classList.remove("flipped");

  questionEl.textContent = q.question;
  answerEl.textContent = q.answer;
  referenceEl.textContent =
    showReference && q.reference ? `Reference: ${q.reference}` : "";
  categoryLabel.textContent = q.category || "Uncategorized";
  counterLabel.textContent = `${currentIndex + 1} / ${filteredQuestions.length}`;

  // Mode-specific setup
  if (currentMode === "flashcard") {
    modeHint.textContent = "Tap/click anywhere on the card to flip between question and answer.";
    shortAnswerArea.classList.add("hidden");
    mcArea.classList.add("hidden");
  } else if (currentMode === "multiple-choice") {
    modeHint.textContent = "Select the best answer, then flip the card to verify.";
    shortAnswerArea.classList.add("hidden");
    mcArea.classList.remove("hidden");
    renderMCOptions(q, mcOptionsContainer);
  } else if (currentMode === "short-answer") {
    modeHint.textContent = "Type your answer, hit 'Check Answer', then flip to compare.";
    shortAnswerArea.classList.remove("hidden");
    mcArea.classList.add("hidden");
    const saInput = document.getElementById("shortAnswerInput");
    if (saInput) saInput.value = "";
  }

  // Flag UI reset & restore
  if (flagPanel) {
    flagPanel.classList.add("hidden");
  }
  if (flagText) {
    const flagData = flags[q.id];
    flagText.value = flagData ? flagData.text : "";
  }
  updateFlagUI(q.id);

  updateProgressUI();
}

function renderMCOptions(question, container) {
  if (!container) return;

  container.innerHTML = "";

  const pool = filteredQuestions.length >= 4 ? filteredQuestions : allQuestions;
  const wrongAnswers = pool
    .filter(q => q.answer && q.answer !== question.answer)
    .map(q => q.answer);

  const options = [question.answer];
  shuffleArray(wrongAnswers);
  for (const a of wrongAnswers) {
    if (options.length >= 4) break;
    if (!options.includes(a)) options.push(a);
  }

  shuffleArray(options);

  options.forEach(optText => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mc-option";
    btn.textContent = optText;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      handleMCSelection(btn, optText === question.answer);
    });
    container.appendChild(btn);
  });
}

// ===============================
// Answer Handling
// ===============================

function handleMCSelection(button, isCorrect) {
  stats.attempts += 1;
  if (isCorrect) {
    stats.correct += 1;
  }

  const allOpts = button.parentElement.querySelectorAll(".mc-option");
  allOpts.forEach(opt => {
    opt.disabled = true;
    if (opt.textContent === filteredQuestions[currentIndex].answer) {
      opt.classList.add("correct");
    } else if (opt === button && !isCorrect) {
      opt.classList.add("incorrect");
    }
  });

  updateProgressUI();
}

function handleShortAnswerCheck() {
  if (!filteredQuestions.length) return;

  const input = document.getElementById("shortAnswerInput");
  if (!input) return;

  const userText = (input.value || "").trim();
  if (!userText) {
    alert("Type an answer first, then press Check Answer.");
    return;
  }
  stats.attempts += 1;

  const correct = filteredQuestions[currentIndex].answer || "";
  if (userText.length && correct.length) {
    const u = userText.toLowerCase();
    const c = correct.toLowerCase();
    if (u === c || u.includes(c) || c.includes(u)) {
      stats.correct += 1;
    }
  }

  updateProgressUI();
  document.getElementById("card").classList.add("flipped");
}

// ===============================
// Progress
// ===============================

function updateProgressUI() {
  const correctCountEl = document.getElementById("correctCount");
  const attemptCountEl = document.getElementById("attemptCount");
  const progressBar = document.getElementById("progressBar");

  if (correctCountEl) correctCountEl.textContent = stats.correct;
  if (attemptCountEl) attemptCountEl.textContent = stats.attempts;

  const pct = stats.attempts > 0 ? Math.round((stats.correct / stats.attempts) * 100) : 0;
  if (progressBar) {
    progressBar.style.width = pct + "%";
  }
}

// ===============================
// Utility
// ===============================

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// ===============================
// PWA Setup
// ===============================

function setupPWA() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(console.error);
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
}
