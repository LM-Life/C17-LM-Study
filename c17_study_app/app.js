let allQuestions = [];
let filteredQuestions = [];
let currentIndex = 0;
let currentMode = "flashcard";
let shuffleEnabled = true;
let showReference = true;
let stats = {
  attempts: 0,
  correct: 0
};

let deferredPrompt = null;

document.addEventListener("DOMContentLoaded", () => {
  setupUI();
  loadQuestions();
  setupPWA();
});

function setupUI() {
  const card = document.getElementById("card");
  const modeSelect = document.getElementById("modeSelect");
  const shuffleToggle = document.getElementById("shuffleToggle");
  const showRefToggle = document.getElementById("showRefToggle");
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  const flipBackBtn = document.getElementById("flipBackBtn");
  const checkShortAnswerBtn = document.getElementById("checkShortAnswerBtn");

  card.addEventListener("click", (e) => {
    if (e.target.closest("textarea") || e.target.closest("button") || e.target.closest(".mc-option")) {
      return;
    }
    card.classList.toggle("flipped");
  });

  flipBackBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    card.classList.remove("flipped");
  });

  modeSelect.addEventListener("change", () => {
    currentMode = modeSelect.value;
    currentIndex = 0;
    updateFilteredQuestions();
    renderCurrentQuestion();
  });

  shuffleToggle.addEventListener("change", () => {
    shuffleEnabled = shuffleToggle.checked;
    updateFilteredQuestions();
    renderCurrentQuestion();
  });

  showRefToggle.addEventListener("change", () => {
    showReference = showRefToggle.checked;
    renderCurrentQuestion();
  });

  prevBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!filteredQuestions.length) return;
    currentIndex = (currentIndex - 1 + filteredQuestions.length) % filteredQuestions.length;
    document.getElementById("card").classList.remove("flipped");
    renderCurrentQuestion();
  });

  nextBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!filteredQuestions.length) return;
    currentIndex = (currentIndex + 1) % filteredQuestions.length;
    document.getElementById("card").classList.remove("flipped");
    renderCurrentQuestion();
  });

  checkShortAnswerBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    handleShortAnswerCheck();
  });

  const categorySelect = document.getElementById("categorySelect");
  categorySelect.addEventListener("change", () => {
    currentIndex = 0;
    updateFilteredQuestions();
    renderCurrentQuestion();
  });
}

async function loadQuestions() {
  try {
    const res = await fetch("questions.json");
    if (!res.ok) throw new Error("Failed to load questions.json");
    allQuestions = await res.json();

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
  const selectedCategory = categorySelect.value;

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

  if (!filteredQuestions.length) {
    questionEl.textContent = "No questions available in this category.";
    answerEl.textContent = "";
    referenceEl.textContent = "";
    categoryLabel.textContent = "None";
    counterLabel.textContent = "0 / 0";
    shortAnswerArea.classList.add("hidden");
    mcArea.classList.add("hidden");
    return;
  }

  const q = filteredQuestions[currentIndex];

  card.classList.remove("flipped");
  questionEl.textContent = q.question;
  answerEl.textContent = q.answer;
  referenceEl.textContent = showReference && q.reference ? `Reference: ${q.reference}` : "";
  categoryLabel.textContent = q.category || "Uncategorized";
  counterLabel.textContent = `${currentIndex + 1} / ${filteredQuestions.length}`;

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
    document.getElementById("shortAnswerInput").value = "";
  }

  updateProgressUI();
}

function renderMCOptions(question, container) {
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
  const input = document.getElementById("shortAnswerInput");
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

function updateProgressUI() {
  const correctCountEl = document.getElementById("correctCount");
  const attemptCountEl = document.getElementById("attemptCount");
  const progressBar = document.getElementById("progressBar");

  correctCountEl.textContent = stats.correct;
  attemptCountEl.textContent = stats.attempts;

  const pct = stats.attempts > 0 ? Math.round((stats.correct / stats.attempts) * 100) : 0;
  progressBar.style.width = pct + "%";
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function setupPWA() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(console.error);
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const btn = document.getElementById("installBtn");
    btn.hidden = false;
    btn.addEventListener("click", async () => {
      btn.hidden = true;
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
    }, { once: true });
  });
}