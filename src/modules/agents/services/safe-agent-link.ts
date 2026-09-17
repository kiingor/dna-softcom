// Respostas podem conter texto vindo de documentos. Links externos e imagens
// não são renderizados; caminhos do DNA passam por uma allowlist de rotas.
export function safeAgentLink(href?: string) {
  return href &&
    /^\/dashboard\/(?:admissoes|vagas|candidatos|colaboradores|jornada)(?:\/[a-f0-9-]{36})?$/.test(
      href,
    )
    ? href
    : undefined;
}
