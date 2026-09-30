import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

/**
 * Injeta a Content-Security-Policy no `index.html` do build de produção.
 *
 * Vai como `<meta http-equiv>` em vez de header do servidor de propósito: a
 * política acompanha o artefato do build e continua valendo em qualquer
 * hospedagem (Vercel hoje, VPS com Traefik depois) sem precisar reconfigurar
 * proxy. O que `meta` não suporta — `frame-ancestors`, HSTS — vai por header
 * em `vercel.json`.
 *
 * A origem do Supabase entra a partir do `.env` do build, então trocar de
 * projeto (ou migrar pra Supabase self-hosted) não exige mexer aqui.
 */
const contentSecurityPolicy = (supabaseUrl: string | undefined): Plugin => {
  let apiOrigin = "";
  let wsOrigin = "";

  try {
    const url = new URL(supabaseUrl ?? "");
    apiOrigin = url.origin;
    wsOrigin = url.origin.replace(/^http/, "ws");
  } catch {
    // Sem VITE_SUPABASE_URL válida o app não sobe de qualquer forma; a CSP
    // apenas fica sem a exceção da API.
  }

  const policy = [
    "default-src 'self'",
    "base-uri 'self'",
    // Nada de <object>/<embed>: vetor clássico de plugin legado.
    "object-src 'none'",
    // Formulário só posta pro próprio app (barra exfiltração via form injetado).
    "form-action 'self'",
    // Vite gera só scripts externos — dá pra proibir inline sem hash/nonce.
    "script-src 'self'",
    // Radix e Tailwind escrevem style inline; a fonte Manrope vem do Google.
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    "font-src 'self' data: https://fonts.gstatic.com",
    // blob:/data: cobrem preview de upload e PDF gerado no cliente.
    `img-src 'self' data: blob:${apiOrigin ? " " + apiOrigin : ""}`,
    "media-src 'self' blob: data:",
    // viacep: busca de endereço por CEP no formulário público de admissão.
    `connect-src 'self' https://viacep.com.br${apiOrigin ? ` ${apiOrigin} ${wsOrigin}` : ""}`,
    // Worker do pdf.js (leitura de contracheque/currículo em PDF).
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "manifest-src 'self'",
    "upgrade-insecure-requests",
  ].join("; ");

  return {
    name: "dna-csp",
    apply: "build",
    transformIndexHtml(html) {
      return {
        html,
        tags: [
          {
            tag: "meta",
            attrs: { "http-equiv": "Content-Security-Policy", content: policy },
            injectTo: "head-prepend",
          },
        ],
      };
    },
  };
};

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    plugins: [
      react(),
      contentSecurityPolicy(env.VITE_SUPABASE_URL),
    ].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
