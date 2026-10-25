import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = name => fs.readFileSync(path.join(root, name), "utf8");
const configSource = read("supabase-config.js");
const authSource = read("captcha-auth.js");
const loaderSource = read("captcha-loader.js");
const html = read("index.html");
const game = read("game.js");
const css = read("style.css");
const SITEKEY = "04beb150-01a8-44ae-915a-23aa325afc80";

function getConfig(hostname) {
  const context = { window: { location: { hostname } } };
  vm.runInNewContext(configSource, context);
  return context.window.SUPABASE_CONFIG;
}

function getCaptchaApi() {
  const context = { window: {} };
  vm.runInNewContext(authSource, context);
  return context.window.CardGameCaptcha;
}

function runLoader(config) {
  const appended = [];
  const events = [];
  const window = {
    SUPABASE_CONFIG: config,
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    dispatchEvent: event => events.push(event),
    setTimeout,
    clearTimeout
  };
  const document = {
    createElement: () => ({}),
    head: { appendChild: script => { script.parentNode = document.head; appended.push(script); }, removeChild: () => {} }
  };
  vm.runInNewContext(loaderSource, { window, document });
  return { window, appended, events };
}

test("a tela inicial inclui o widget oficial e a Sitekey pública configurada", () => {
  const hosted = getConfig("yuri-mirus.github.io");
  assert.equal(hosted.captchaRequired, true);
  assert.equal(hosted.captchaSitekey, SITEKEY);
  assert.match(html, /id=["']captcha-panel["']/);
  assert.match(html, /id=["']captcha-widget["']/);
  assert.match(html, /src=["']captcha-loader\.js["']/);
  assert.match(loaderSource, /https:\/\/js\.hcaptcha\.com\/1\/api\.js/);
  assert.match(css, /\.captcha-panel/);
  assert.match(css, /@media\(max-width:380px\)[\s\S]*\.captcha-widget/);
});

test("o carregador não solicita hCaptcha no Supabase local", () => {
  for (const host of ["localhost", "127.0.0.1"]) {
    const config = getConfig(host);
    assert.equal(config.captchaRequired, false);
    assert.equal(config.captchaSitekey, null);
    const runtime = runLoader(config);
    assert.equal(runtime.window.HCaptchaRuntime.status, "disabled");
    assert.equal(runtime.appended.length, 0);
  }
});

test("no domínio publicado o carregador usa o SDK oficial e sinaliza prontidão", () => {
  const runtime = runLoader(getConfig("yuri-mirus.github.io"));
  assert.equal(runtime.window.HCaptchaRuntime.status, "loading");
  assert.equal(runtime.appended.length, 1);
  assert.match(runtime.appended[0].src, /^https:\/\/js\.hcaptcha\.com\/1\/api\.js/);
  runtime.window.hcaptcha = { render() {} };
  runtime.window.onHCaptchaApiReady();
  assert.equal(runtime.window.HCaptchaRuntime.status, "ready");
  assert.equal(runtime.events.at(-1).detail.status, "ready");
});

test("a autenticação anônima hospedada recebe o token hCaptcha e o limpa após a tentativa", async () => {
  const api = getCaptchaApi();
  const states = [];
  const store = api.createTokenStore((state, message) => states.push({ state, message }));
  store.setWidgetId("widget-1");
  assert.equal(store.accept("token-valido"), true);
  const captcha = { getResponse: id => id === "widget-1" ? "token-valido" : "", reset: () => { captcha.resetCount++; }, resetCount: 0 };
  const calls = [];
  const session = { user: { id: "user-1" } };
  const auth = {
    getSession: async () => ({ data: { session: null }, error: null }),
    signInAnonymously: async (...args) => { calls.push(args); return { data: { session }, error: null }; }
  };
  const result = await api.ensureAnonymousSession(auth, {
    captchaRequired: true,
    getCaptchaToken: () => store.getValidToken(captcha),
    resetCaptcha: () => store.reset(captcha)
  });
  assert.equal(result, session);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 1);
  assert.equal(calls[0][0].options.captchaToken, "token-valido");
  assert.equal(captcha.resetCount, 1);
  assert.equal(store.getValidToken(captcha), null);
  assert.equal(states.at(-1).state, "ready");
});

test("sem token, a criação hospedada é rejeitada antes de chamar Supabase Auth", async () => {
  const api = getCaptchaApi();
  let signInCalls = 0;
  let resetCalls = 0;
  const auth = {
    getSession: async () => ({ data: { session: null }, error: null }),
    signInAnonymously: async () => { signInCalls++; return { data: {}, error: null }; }
  };
  await assert.rejects(
    api.ensureAnonymousSession(auth, { captchaRequired: true, getCaptchaToken: () => null, resetCaptcha: () => { resetCalls++; } }),
    /hCaptcha/
  );
  assert.equal(signInCalls, 0);
  assert.equal(resetCalls, 0);
});

test("tokens expirados ou com erro são descartados e exibem estado recuperável", () => {
  const api = getCaptchaApi();
  const states = [];
  const store = api.createTokenStore((state, message) => states.push({ state, message }));
  store.setWidgetId("widget-2");
  const captcha = { getResponse: () => "token-2", reset() {} };
  store.accept("token-2");
  assert.equal(store.getValidToken(captcha), "token-2");
  store.expire();
  assert.equal(store.getValidToken(captcha), null);
  assert.equal(states.at(-1).state, "expired");
  assert.match(states.at(-1).message, /expirou/i);
  store.accept("token-3");
  store.fail();
  assert.equal(store.getValidToken(captcha), null);
  assert.equal(states.at(-1).state, "error");
  assert.match(states.at(-1).message, /erro/i);
});

test("uma sessão anônima já válida é reutilizada sem novo login ou token", async () => {
  const api = getCaptchaApi();
  const session = { user: { id: "existing-user" } };
  let signInCalls = 0;
  let tokenReads = 0;
  let resetCalls = 0;
  const auth = {
    getSession: async () => ({ data: { session }, error: null }),
    signInAnonymously: async () => { signInCalls++; return { data: { session: null }, error: null }; }
  };
  const result = await api.ensureAnonymousSession(auth, {
    captchaRequired: true,
    getCaptchaToken: () => { tokenReads++; return null; },
    resetCaptcha: () => { resetCalls++; }
  });
  assert.equal(result, session);
  assert.equal(signInCalls, 0);
  assert.equal(tokenReads, 0);
  assert.equal(resetCalls, 1);
});

test("no host local, autenticação sem CAPTCHA continua usando signInAnonymously sem token", async () => {
  const api = getCaptchaApi();
  let argsSeen = null;
  const session = { user: { id: "local-user" } };
  const auth = {
    getSession: async () => ({ data: { session: null }, error: null }),
    signInAnonymously: async (...args) => { argsSeen = args; return { data: { session }, error: null }; }
  };
  const result = await api.ensureAnonymousSession(auth, { captchaRequired: false });
  assert.equal(result, session);
  assert.deepEqual(argsSeen, []);
});

test("falha na autenticação ainda reinicia o desafio", async () => {
  const api = getCaptchaApi();
  const session = { user: { id: "unused" } };
  let resetCalls = 0;
  const auth = {
    getSession: async () => ({ data: { session: null }, error: null }),
    signInAnonymously: async () => ({ data: { session }, error: new Error("auth falhou") })
  };
  await assert.rejects(api.ensureAnonymousSession(auth, {
    captchaRequired: true,
    getCaptchaToken: () => "token-valido",
    resetCaptcha: () => { resetCalls++; }
  }), /auth falhou/);
  assert.equal(resetCalls, 1);
});

test("o token do CAPTCHA não é incluído no corpo enviado à Edge Function", () => {
  assert.match(game, /await ensureAnonymousSession\(\)/);
  assert.match(game, /invokeFunction\("game-start", pending\)/);
  const startBlock = game.match(/async function startGame\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.doesNotMatch(startBlock, /invokeFunction\([^\n]*captchaToken/);
});


test("falha ao carregar o SDK mostra erro recuperável e permite recarregar", () => {
  const runtime = runLoader(getConfig("yuri-mirus.github.io"));
  runtime.appended[0].onerror();
  assert.equal(runtime.window.HCaptchaRuntime.status, "error");
  assert.equal(runtime.events.at(-1).detail.status, "error");
  runtime.window.HCaptchaRuntime.reload();
  assert.equal(runtime.window.HCaptchaRuntime.status, "loading");
  assert.equal(runtime.appended.length, 2);
  runtime.window.hcaptcha = { render() {} };
  runtime.window.onHCaptchaApiReady();
  assert.equal(runtime.window.HCaptchaRuntime.status, "ready");
});
