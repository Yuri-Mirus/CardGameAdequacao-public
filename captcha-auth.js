(function (global) {
  "use strict";

  function createTokenStore(onState = () => {}) {
    let token = null;
    let widgetId = null;
    const emit = (state, message) => onState(state, message);
    const clearValue = () => { token = null; };

    return {
      setWidgetId(id) { widgetId = id; },
      accept(value) {
        if (typeof value !== "string" || !value.trim()) {
          clearValue();
          emit("error", "A verificação retornou um token inválido. Tente novamente.");
          return false;
        }
        token = value.trim();
        emit("verified", "Verificação concluída. Clique em Começar jogo para continuar.");
        return true;
      },
      getValidToken(api) {
        if (!token) return null;
        if (!api || widgetId === null || typeof api.getResponse !== "function") {
          clearValue();
          emit("expired", "A verificação expirou. Complete o desafio novamente.");
          return null;
        }
        let currentResponse = "";
        try { currentResponse = api.getResponse(widgetId); } catch { currentResponse = ""; }
        if (typeof currentResponse !== "string" || currentResponse.trim() !== token) {
          clearValue();
          emit("expired", "A verificação expirou. Complete o desafio novamente.");
          return null;
        }
        return token;
      },
      expire() {
        clearValue();
        emit("expired", "O desafio expirou. Complete a verificação novamente.");
      },
      fail() {
        clearValue();
        emit("error", "A verificação apresentou um erro. Reinicie o desafio e tente novamente.");
      },
      clear() { clearValue(); },
      reset(api, message = "Verificação reiniciada. Complete o desafio se uma nova sessão for necessária.") {
        clearValue();
        if (api && widgetId !== null && typeof api.reset === "function") {
          try { api.reset(widgetId); } catch { /* o desafio será refeito ao recarregar a página */ }
        }
        emit("ready", message);
      }
    };
  }

  async function ensureAnonymousSession(auth, options = {}) {
    const captchaRequired = options.captchaRequired === true;
    const { data, error } = await auth.getSession();
    if (error) throw error;
    if (data?.session) {
      if (captchaRequired) options.resetCaptcha?.();
      return data.session;
    }

    let credentials;
    if (captchaRequired) {
      const captchaToken = options.getCaptchaToken?.();
      if (typeof captchaToken !== "string" || !captchaToken.trim()) {
        throw new Error("Conclua a verificação hCaptcha antes de iniciar a partida.");
      }
      credentials = { options: { captchaToken: captchaToken.trim() } };
    }

    let result;
    try {
      result = captchaRequired
        ? await auth.signInAnonymously(credentials)
        : await auth.signInAnonymously();
    } finally {
      if (captchaRequired) options.resetCaptcha?.();
    }
    if (result.error) throw result.error;
    if (!result.data?.session) throw new Error("O Supabase não criou uma sessão anônima.");
    return result.data.session;
  }

  global.CardGameCaptcha = Object.freeze({ createTokenStore, ensureAnonymousSession });
})(window);
