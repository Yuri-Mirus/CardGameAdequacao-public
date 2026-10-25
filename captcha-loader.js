(function (global, document) {
  "use strict";

  const enabled = global.SUPABASE_CONFIG?.captchaRequired === true;
  const runtime = { enabled, status: enabled ? "loading" : "disabled", widgetId: null, reload: null };
  let sdkScript = null;
  let loadTimer = null;

  function setStatus(status) {
    runtime.status = status;
    global.dispatchEvent(new global.CustomEvent("hcaptcha:state", { detail: { status } }));
  }

  global.onHCaptchaApiReady = function () {
    if (loadTimer !== null) global.clearTimeout(loadTimer);
    setStatus(global.hcaptcha && typeof global.hcaptcha.render === "function" ? "ready" : "error");
  };

  function loadSdk() {
    if (!enabled) return;
    if (sdkScript?.parentNode) sdkScript.parentNode.removeChild(sdkScript);
    if (loadTimer !== null) global.clearTimeout(loadTimer);
    setStatus("loading");
    sdkScript = document.createElement("script");
    sdkScript.id = "hcaptcha-sdk";
    sdkScript.src = "https://js.hcaptcha.com/1/api.js?onload=onHCaptchaApiReady&render=explicit";
    sdkScript.async = true;
    sdkScript.defer = true;
    sdkScript.onerror = function () {
      if (loadTimer !== null) global.clearTimeout(loadTimer);
      setStatus("error");
    };
    loadTimer = global.setTimeout(function () {
      if (runtime.status === "loading") setStatus("error");
    }, 15000);
    document.head.appendChild(sdkScript);
  }

  runtime.reload = loadSdk;
  global.HCaptchaRuntime = runtime;
  if (enabled) loadSdk();
})(window, document);
