"use strict";

const $ = id => document.getElementById(id);
const screens = { home: $("screen-home"), game: $("screen-game"), result: $("screen-result"), ranking: $("screen-ranking") };
const LEVELS = {
  easy: { label: "Fácil", points: 10 },
  medium: { label: "Médio", points: 20 },
  hard: { label: "Difícil", points: 30 }
};
const rankingPageSize = 100;
const ACTIVE_MATCH_KEY = "card-game-active-match";
const PENDING_START_KEY = "card-game-pending-start";

let supabaseClient = null;
let playerName = "";
let matchId = null;
let currentCard = null;
let pendingNextCard = null;
let pendingAnswer = null;
let questionIndex = 0;
let score = 0;
let correct = 0;
let highestLevel = "easy";
let locked = false;
let answerInProgress = false;
let ended = false;
let resultShown = false;
let rankingReturnTo = "home";
let rankingOffset = 0;

function showScreen(name) {
  Object.entries(screens).forEach(([key, element]) => { element.hidden = key !== name; });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function initializeSupabase() {
  const config = window.SUPABASE_CONFIG;
  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    $("connection-status").textContent = "Biblioteca Supabase não carregou. Verifique a conexão.";
    return;
  }
  if (!config?.url || !config?.publishableKey || config.url.includes("COLE_AQUI") || config.publishableKey.includes("COLE_AQUI")) {
    $("connection-status").textContent = "Configure URL e chave pública em supabase-config.js.";
    return;
  }
  try {
    supabaseClient = window.supabase.createClient(config.url, config.publishableKey, {
      auth: {
        persistSession: true,
        storage: window.sessionStorage,
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    });
    $("connection-status").textContent = "Conexão configurada; as partidas são validadas no servidor.";
  } catch {
    $("connection-status").textContent = "Configuração Supabase inválida. Confira URL e chave pública.";
  }
}

function createUuid() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  if (!window.crypto?.getRandomValues) throw new Error("Este navegador não oferece geração segura de identificador.");
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function setCaptchaStatus(state, message) {
  const status = $("captcha-status");
  if (!status) return;
  status.textContent = message;
  status.dataset.state = state;
  $("captcha-retry").hidden = !["expired", "error"].includes(state);
}

let captchaTokenStore = null;
let captchaWidgetId = null;

function renderCaptchaWidget() {
  const config = window.SUPABASE_CONFIG;
  const runtime = window.HCaptchaRuntime;
  if (!config?.captchaRequired || captchaWidgetId !== null || !window.hcaptcha?.render) return;
  if (!config.captchaSitekey) {
    setCaptchaStatus("error", "A verificação não está configurada. Avise o responsável pelo jogo.");
    return;
  }
  try {
    captchaWidgetId = window.hcaptcha.render("captcha-widget", {
      sitekey: config.captchaSitekey,
      size: "compact",
      callback: token => captchaTokenStore.accept(token),
      "expired-callback": () => captchaTokenStore.expire(),
      "chalexpired-callback": () => captchaTokenStore.expire(),
      "error-callback": () => captchaTokenStore.fail()
    });
    captchaTokenStore.setWidgetId(captchaWidgetId);
    if (runtime) runtime.widgetId = captchaWidgetId;
    setCaptchaStatus("ready", "Complete a verificação. O token será usado apenas na autenticação.");
  } catch {
    captchaWidgetId = null;
    setCaptchaStatus("error", "Não foi possível exibir a verificação. Tente recarregá-la.");
  }
}

function initializeCaptcha() {
  const config = window.SUPABASE_CONFIG;
  if (!config?.captchaRequired) {
    $("captcha-panel").hidden = true;
    return;
  }
  $("captcha-panel").hidden = false;
  if (!window.CardGameCaptcha?.createTokenStore) {
    setCaptchaStatus("error", "O recurso de verificação não carregou. Atualize a página e tente novamente.");
    return;
  }
  captchaTokenStore = window.CardGameCaptcha.createTokenStore(setCaptchaStatus);
  const runtime = window.HCaptchaRuntime;
  if (!runtime) {
    setCaptchaStatus("error", "Não foi possível carregar a verificação. Atualize a página e tente novamente.");
    return;
  }
  window.addEventListener("hcaptcha:state", event => {
    const state = event.detail?.status;
    if (state === "ready") {
      renderCaptchaWidget();
    } else if (state === "loading") {
      setCaptchaStatus("loading", "Carregando verificação. Se ela não aparecer, tente recarregá-la.");
    } else if (state === "error") {
      setCaptchaStatus("error", "A verificação não carregou. Confira sua conexão ou bloqueador e tente recarregá-la.");
    }
  });
  if (runtime.status === "ready") renderCaptchaWidget();
  else if (runtime.status === "error") setCaptchaStatus("error", "A verificação não carregou. Confira sua conexão ou bloqueador e tente recarregá-la.");
  else setCaptchaStatus("loading", "Carregando verificação. Se ela não aparecer, tente recarregá-la.");
}

function retryCaptcha() {
  const runtime = window.HCaptchaRuntime;
  const api = window.hcaptcha;
  if (api && captchaWidgetId !== null) {
    captchaTokenStore?.reset(api, "Verificação reiniciada. Complete o desafio para tentar novamente.");
    return;
  }
  captchaTokenStore?.clear();
  if (runtime?.reload) runtime.reload();
  else setCaptchaStatus("error", "Atualize a página e tente novamente. Se o problema persistir, verifique sua conexão.");
}

async function ensureAnonymousSession() {
  if (!window.CardGameCaptcha?.ensureAnonymousSession) {
    throw new Error("O recurso de autenticação segura não carregou. Atualize a página.");
  }
  const config = window.SUPABASE_CONFIG || {};
  return window.CardGameCaptcha.ensureAnonymousSession(supabaseClient.auth, {
    captchaRequired: config.captchaRequired === true,
    getCaptchaToken: () => captchaTokenStore?.getValidToken(window.hcaptcha) || null,
    resetCaptcha: () => captchaTokenStore?.reset(window.hcaptcha, "Verificação reiniciada. A sessão poderá ser reutilizada nesta página.")
  });
}

async function invokeFunction(name, body) {
  if (!supabaseClient) throw new Error("A conexão Supabase não está configurada.");
  const { data, error } = await supabaseClient.functions.invoke(name, { body });
  if (error) throw error;
  if (!data || typeof data !== "object") throw new Error("O servidor retornou uma resposta inválida.");
  if (data.error) {
    const messages = {
      unauthorized: "Sua sessão expirou. Recarregue a página e tente novamente.",
      session_expired: "Esta partida expirou. Comece uma nova partida.",
      session_not_active: "Esta partida não está mais ativa.",
      question_already_answered: "Esta carta já foi respondida com outra escolha. Retome a partida.",
      start_rate_limit: "Muitas partidas foram iniciadas nesta conta. Tente novamente mais tarde."
    };
    throw new Error(messages[data.error] || "O servidor recusou esta solicitação.");
  }
  return data;
}

function setSaveStatus(message, state, canRetry = false) {
  $("save-status").textContent = message;
  $("save-status").dataset.state = state;
  $("retry-save-button").hidden = !canRetry;
}

function updateStats() {
  const level = LEVELS[highestLevel] ? highestLevel : "easy";
  $("score-value").textContent = String(score);
  $("correct-value").textContent = String(correct);
  $("level-value").textContent = LEVELS[level].label;
  $("level-value").className = `level-pill level-${level}`;
  $("points-value").innerHTML = `${LEVELS[level].points} <small>pts</small>`;
  const progress = level === "easy" ? correct : level === "medium" ? correct - 3 : 6;
  const target = level === "hard" ? 6 : level === "easy" ? 3 : 6;
  $("progress-text").textContent = level === "hard" ? "Nível máximo alcançado" : `${progress} de ${target} acertos`;
  const progressTrack = document.querySelector(".progress-track");
  progressTrack.setAttribute("aria-valuemax", String(target));
  progressTrack.setAttribute("aria-valuenow", String(progress));
  $("progress-fill").style.width = `${Math.min(100, progress / target * 100)}%`;
}

function animateQuestionCard() {
  const cardSurface = document.querySelector(".question-card");
  if (!cardSurface) return;
  cardSurface.classList.remove("card-enter");
  void cardSurface.offsetWidth;
  cardSurface.classList.add("card-enter");
}

function renderCard(card) {
  if (!card || !Array.isArray(card.options) || card.options.length !== 4) {
    throw new Error("O servidor enviou uma carta inválida.");
  }
  currentCard = card;
  locked = false;
  $("answer-feedback").hidden = true;
  $("answer-feedback").classList.remove("wrong");
  $("continue-button").hidden = false;
  $("continue-button").disabled = false;
  $("continue-button").textContent = "Próxima carta →";
  $("card-type").textContent = card.type === "phrase" ? "FRASE INCOMPLETA" : "CENÁRIO";
  $("card-difficulty").textContent = LEVELS[card.level]?.label.toUpperCase() || "";
  $("card-difficulty").className = `difficulty-tag level-${card.level}`;
  $("scenario-text").hidden = card.type !== "scenario";
  $("scenario-text").textContent = card.context || "";
  $("question-title").textContent = card.question;
  const list = $("answer-list");
  list.replaceChildren();
  card.options.forEach((option, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "answer-option";
    button.setAttribute("aria-label", `Alternativa ${String.fromCharCode(65 + index)}: ${option}`);
    const letter = document.createElement("span");
    letter.className = "option-letter";
    letter.setAttribute("aria-hidden", "true");
    letter.textContent = String.fromCharCode(65 + index);
    const text = document.createElement("span");
    text.textContent = option;
    button.append(letter, text);
    button.addEventListener("click", () => selectAnswer(index));
    list.append(button);
  });
  updateStats();
  animateQuestionCard();
}

function syncSession(session) {
  matchId = session.matchId;
  playerName = session.playerName;
  score = session.score;
  correct = session.correct;
  highestLevel = session.highestLevel;
  questionIndex = session.questionIndex;
  ended = session.status !== "active";
  $("player-label").textContent = `Jogador: ${playerName}`;
  updateStats();
  if (session.status === "active") {
    currentCard = session.currentCard;
    renderCard(currentCard);
  }
}

function showAnswerFeedback(response, selectedOption) {
  const buttons = [...$("answer-list").querySelectorAll("button")];
  buttons.forEach((button, index) => {
    button.disabled = true;
    if (response.isCorrect && index === selectedOption) button.classList.add("correct");
    if (!response.isCorrect && index === selectedOption) button.classList.add("incorrect");
    if (!response.isCorrect && currentCard.options[index] === response.correctAnswer) button.classList.add("correct");
  });
  const feedback = $("answer-feedback");
  feedback.hidden = false;
  feedback.classList.toggle("wrong", !response.isCorrect);
  $("feedback-title").textContent = response.message || (response.isCorrect ? "Muito bem! Você acertou!" : "Resposta incorreta.");
  const levelMessage = response.isCorrect && response.highestLevel !== currentCard.level && response.status === "active"
    ? ` Você avançou para o nível ${response.levelLabel.toLowerCase()}!` : "";
  $("feedback-explanation").textContent = response.isCorrect
    ? `${response.explanation}${levelMessage}`
    : `A resposta correta era “${response.correctAnswer}”. ${response.explanation}`;
  $("continue-button").hidden = response.finished;
  $("continue-button").disabled = true;
  if (response.finished) window.setTimeout(() => finishGame(response), 700);
}

async function sendPendingAnswer() {
  if (!pendingAnswer || answerInProgress || ended) return;
  answerInProgress = true;
  $("continue-button").disabled = true;
  try {
    const response = await invokeFunction("game-answer", pendingAnswer);
    if (response.matchId !== matchId) throw new Error("A resposta recebida pertence a outra partida.");
    const oldLevel = highestLevel;
    score = response.score;
    correct = response.correct;
    highestLevel = response.highestLevel;
    questionIndex = response.currentPosition;
    pendingNextCard = response.nextCard;
    updateStats();
    showAnswerFeedback(response, pendingAnswer.selectedOption);
    if (response.finished) {
      finalResponse = response;
    } else {
      $("continue-button").disabled = false;
      $("continue-button").textContent = oldLevel !== highestLevel
        ? `Continuar no nível ${response.levelLabel.toLowerCase()} →`
        : "Próxima carta →";
    }
    pendingAnswer = null;
  } catch (error) {
    $("answer-feedback").hidden = false;
    $("answer-feedback").classList.add("wrong");
    $("feedback-title").textContent = "Não foi possível confirmar sua resposta.";
    $("feedback-explanation").textContent = `${error.message || "Falha de conexão."} Sua escolha ainda não foi confirmada. Tente novamente; o servidor evita pontuar duas vezes.`;
    $("continue-button").hidden = false;
    $("continue-button").disabled = false;
    $("continue-button").textContent = "Tentar novamente →";
  } finally {
    answerInProgress = false;
  }
}

let finalResponse = null;
function selectAnswer(index) {
  if (locked || ended || !currentCard || pendingAnswer || !Number.isInteger(index) || index < 0 || index > 3) return;
  locked = true;
  [...$("answer-list").querySelectorAll("button")].forEach(button => { button.disabled = true; });
  pendingAnswer = { matchId, questionIndex, selectedOption: index };
  $("answer-feedback").hidden = false;
  $("feedback-title").textContent = "Verificando sua resposta no servidor…";
  $("feedback-explanation").textContent = "A pontuação só é atualizada depois da validação.";
  $("continue-button").hidden = false;
  $("continue-button").disabled = true;
  $("continue-button").textContent = "Enviando…";
  sendPendingAnswer();
}

function advanceToNextCard() {
  if (pendingAnswer) return sendPendingAnswer();
  if (ended || !pendingNextCard) return;
  const next = pendingNextCard;
  pendingNextCard = null;
  renderCard(next);
}

function finishGame(response) {
  if (resultShown) return;
  ended = true;
  resultShown = true;
  finalResponse = response || finalResponse;
  const result = finalResponse;
  score = result?.score ?? score;
  correct = result?.correct ?? correct;
  highestLevel = result?.highestLevel ?? highestLevel;
  $("result-name").textContent = playerName;
  $("final-score").textContent = String(score);
  $("final-correct").textContent = String(correct);
  $("final-level").textContent = result?.levelLabel || LEVELS[highestLevel].label;
  const completedDeck = result?.status === "won";
  $("result-icon").textContent = completedDeck ? "★" : "✦";
  $("result-message").textContent = completedDeck
    ? "Você completou todas as cartas disponíveis em uma partida. Excelente domínio!"
    : correct === 0 ? "Toda partida ensina algo novo. Leia a explicação e tente mais uma vez."
      : correct >= 6 ? "Você chegou ao nível difícil! Continue praticando para ir ainda mais longe."
        : "Boa sequência! Pratique mais um pouco e você chegará ao próximo nível.";
  const last = $("last-answer");
  if (result && !result.isCorrect) {
    last.replaceChildren();
    const answer = document.createElement("strong");
    answer.textContent = `Resposta correta: ${result.correctAnswer}`;
    const explanation = document.createElement("span");
    explanation.textContent = result.explanation;
    last.append(answer, document.createElement("br"), explanation);
    last.hidden = false;
  } else {
    last.hidden = true;
  }
  setSaveStatus(result?.resultSaved
    ? "Partida registrada pelo servidor e confirmada no Supabase."
    : "Partida encerrada no servidor; não foi gerado resultado para o ranking.",
  result?.resultSaved ? "saved" : "pending");
  $("retry-save-button").hidden = true;
  try { window.sessionStorage.removeItem(ACTIVE_MATCH_KEY); } catch { /* armazenamento pode estar bloqueado */ }
  showScreen("result");
}

function startFailure(error) {
  $("home-error").textContent = error.message || "Não foi possível iniciar a partida. Verifique sua conexão.";
  $("home-error").hidden = false;
}

async function startGame() {
  if (!supabaseClient || $("start-button").disabled) return;
  const cleanName = Array.from($("player-name").value.trim().replace(/\s+/g, " ")).slice(0, 24).join("");
  if (!cleanName) {
    $("home-error").textContent = "Digite seu nome para começar.";
    $("home-error").hidden = false;
    $("player-name").focus();
    return;
  }
  $("home-error").hidden = true;
  resultShown = false;
  finalResponse = null;
  pendingAnswer = null;
  pendingNextCard = null;
  ended = false;
  score = 0;
  correct = 0;
  highestLevel = "easy";
  $("start-button").disabled = true;
  try {
    await ensureAnonymousSession();
    let pending;
    try { pending = JSON.parse(window.sessionStorage.getItem(PENDING_START_KEY) || "null"); } catch { pending = null; }
    if (!pending || pending.playerName !== cleanName) pending = { startRequestId: createUuid(), playerName: cleanName };
    window.sessionStorage.setItem(PENDING_START_KEY, JSON.stringify(pending));
    const session = await invokeFunction("game-start", pending);
    window.sessionStorage.removeItem(PENDING_START_KEY);
    matchId = session.matchId;
    window.sessionStorage.setItem(ACTIVE_MATCH_KEY, matchId);
    syncSession(session);
    if (session.status === "active") {
      ended = false;
      showScreen("game");
    } else if (session.lastResponse) {
      finalResponse = session.lastResponse;
      finishGame(finalResponse);
    } else {
      throw new Error("O servidor retornou uma partida encerrada sem resultado recuperável.");
    }
  } catch (error) {
    startFailure(error);
  } finally {
    $("start-button").disabled = false;
  }
}

async function resumeStoredGame() {
  if (!supabaseClient) return;
  let match;
  let pending;
  try {
    match = window.sessionStorage.getItem(ACTIVE_MATCH_KEY);
    pending = JSON.parse(window.sessionStorage.getItem(PENDING_START_KEY) || "null");
  } catch { return; }
  if (!match && !pending) return;
  try {
    const { data } = await supabaseClient.auth.getSession();
    if (!data.session) return;
    if (pending) {
      $("player-name").value = pending.playerName;
      await startGame();
      return;
    }
    const session = await invokeFunction("game-resume", { matchId: match });
    syncSession(session);
    if (session.status === "active") showScreen("game");
    else if (session.lastResponse) {
      finalResponse = session.lastResponse;
      finishGame(finalResponse);
    } else {
      window.sessionStorage.removeItem(ACTIVE_MATCH_KEY);
      $("home-error").textContent = "A partida não está mais ativa. Comece uma nova partida.";
      $("home-error").hidden = false;
    }
  } catch (error) {
    $("home-error").textContent = `Não foi possível retomar a partida. ${error.message || "Verifique a conexão."}`;
    $("home-error").hidden = false;
  }
}

function openRanking(returnTo) {
  rankingReturnTo = returnTo;
  rankingOffset = 0;
  showScreen("ranking");
  loadRanking();
}

async function loadRanking() {
  const status = $("ranking-status");
  const rows = $("ranking-rows");
  rows.replaceChildren();
  if (!supabaseClient) {
    status.textContent = "Ranking indisponível: confira a biblioteca e a configuração em supabase-config.js.";
    status.dataset.state = "error";
    return;
  }
  status.textContent = "Buscando resultados no Supabase…";
  status.dataset.state = "pending";
  $("refresh-ranking-button").disabled = true;
  $("ranking-previous-button").disabled = true;
  $("ranking-next-button").disabled = true;
  try {
    const { data, error } = await supabaseClient.from("resultados")
      .select("id,nome_jogador,pontuacao,acertos,nivel_maximo,data_partida")
      .order("pontuacao", { ascending: false })
      .order("acertos", { ascending: false })
      .order("data_partida", { ascending: true })
      .order("id", { ascending: true })
      .range(rankingOffset, rankingOffset + rankingPageSize);
    if (error) throw error;
    if (!data || data.length === 0) {
      if (rankingOffset > 0) { rankingOffset = 0; await loadRanking(); return; }
      status.textContent = "Ainda não há partidas registradas no ranking online.";
      status.dataset.state = "empty";
      $("ranking-page-label").textContent = "Página 1";
      $("ranking-previous-button").disabled = true;
      $("ranking-next-button").disabled = true;
      return;
    }
    const pageRows = data.slice(0, rankingPageSize);
    pageRows.forEach((row, index) => {
      const tr = document.createElement("tr");
      const position = rankingOffset + index + 1;
      if (position <= 3) tr.classList.add(`rank-top-${position}`);
      const values = [String(position), row.nome_jogador, String(row.pontuacao), String(row.acertos), row.nivel_maximo];
      values.forEach((value, cellIndex) => {
        const td = document.createElement("td");
        td.textContent = cellIndex === 0 && position <= 3 ? `${["🥇", "🥈", "🥉"][position - 1]} ${value}` : value;
        if (cellIndex === 2) td.classList.add("score-cell");
        tr.append(td);
      });
      rows.append(tr);
    });
    const firstPosition = rankingOffset + 1;
    const lastPosition = rankingOffset + pageRows.length;
    $("ranking-page-label").textContent = `Página ${Math.floor(rankingOffset / rankingPageSize) + 1} · partidas ${firstPosition}–${lastPosition}`;
    $("ranking-previous-button").disabled = rankingOffset === 0;
    $("ranking-next-button").disabled = data.length <= rankingPageSize;
    status.textContent = `Classificação recebida do Supabase · mostrando ${pageRows.length} ${pageRows.length === 1 ? "partida" : "partidas"} nesta página.`;
    status.dataset.state = "saved";
  } catch (error) {
    status.textContent = `Não foi possível carregar a classificação online.${error.message ? ` (${error.message})` : ""}`;
    status.dataset.state = "error";
  } finally {
    $("refresh-ranking-button").disabled = false;
    $("ranking-previous-button").disabled = rankingOffset === 0;
  }
}

async function abandonGame() {
  const oldMatch = matchId;
  matchId = null;
  ended = true;
  try { window.sessionStorage.removeItem(ACTIVE_MATCH_KEY); } catch { /* best effort */ }
  showScreen("home");
  if (oldMatch && supabaseClient) {
    try { await invokeFunction("game-abandon", { matchId: oldMatch }); } catch { /* expira no servidor */ }
  }
}

$("start-button").addEventListener("click", startGame);
$("captcha-retry").addEventListener("click", retryCaptcha);
$("player-name").addEventListener("keydown", event => { if (event.key === "Enter") startGame(); });
$("player-name").addEventListener("input", () => { $("home-error").hidden = true; });
$("continue-button").addEventListener("click", advanceToNextCard);
$("restart-button").addEventListener("click", () => {
  $("player-name").value = playerName;
  showScreen("home");
  startGame();
});
$("quit-button").addEventListener("click", abandonGame);
$("open-ranking-button").addEventListener("click", () => openRanking("home"));
$("result-ranking-button").addEventListener("click", () => openRanking("result"));
$("refresh-ranking-button").addEventListener("click", loadRanking);
$("back-ranking-button").addEventListener("click", () => showScreen(rankingReturnTo));
$("ranking-previous-button").addEventListener("click", () => {
  rankingOffset = Math.max(0, rankingOffset - rankingPageSize);
  loadRanking();
});
$("ranking-next-button").addEventListener("click", () => {
  rankingOffset += rankingPageSize;
  loadRanking();
});

initializeSupabase();
initializeCaptcha();
resumeStoredGame();
