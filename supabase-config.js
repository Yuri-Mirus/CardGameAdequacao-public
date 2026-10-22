// Chaves publishable são públicas; nunca coloque service_role ou sb_secret aqui.
const localConfig = Object.freeze({
  url: "http://127.0.0.1:54321",
  publishableKey: "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"
});

// Mantém intactas as credenciais públicas do projeto hospedado.
const hostedConfig = Object.freeze({
  url: "https://ochfpbfbjhbdabazukyr.supabase.co",
  publishableKey: "sb_publishable_V4lXfHgXmjVyPWjYzghFvA_1bFxgmZg"
});

const isLocalHost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
window.SUPABASE_CONFIG = isLocalHost ? localConfig : hostedConfig;
