// Executa conversas no backend de homologação, registrando resultados para revisão.
// Credenciais só por ambiente; nunca são escritas no relatório.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const suite = JSON.parse(
  await readFile(
    new URL("../evals/agents/scenarios.json", import.meta.url),
    "utf8",
  ),
);
const selected = suite.cases
  .filter((c) => !option("--agent") || c.agent === option("--agent"))
  .filter((c) => !option("--case") || c.id === option("--case"))
  .slice(0, Number(option("--limit", "3")));
if (args.includes("--list")) {
  process.stdout.write(
    selected.map((c) => `${c.id}: ${c.acceptance}`).join("\n") + "\n",
  );
  process.exit(0);
}
const base = process.env.AGENT_EVAL_BASE_URL,
  token = process.env.AGENT_EVAL_TOKEN,
  key = process.env.AGENT_EVAL_ANON_KEY,
  company = process.env.AGENT_EVAL_COMPANY_ID;
if (
  process.env.AGENT_EVAL_STAGING !== "true" ||
  !base ||
  !token ||
  !key ||
  !company
)
  throw new Error(
    "Configure AGENT_EVAL_STAGING=true, AGENT_EVAL_BASE_URL, AGENT_EVAL_TOKEN, AGENT_EVAL_ANON_KEY e AGENT_EVAL_COMPANY_ID para o ambiente de teste. Use --list para conferir os casos sem chamar a API.",
  );
const report = {
  version: suite.version,
  startedAt: new Date().toISOString(),
  label: option("--label", "configuracao-atual"),
  cases: [],
};
for (const scenario of selected) {
  const result = {
    id: scenario.id,
    agent: scenario.agent,
    acceptance: scenario.acceptance,
    turns: [],
    humanRating: null,
  };
  let sessionId = null;
  for (const query of scenario.turns) {
    const started = Date.now(),
      requestId = randomUUID();
    try {
      const response = await fetch(
        `${base.replace(/\/$/, "")}/functions/v1/${scenario.agent === "analyst" ? "analyst-chat" : "recruiter-search"}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            apikey: key,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            companyId: company,
            sessionId,
            requestId,
            query,
            stream: false,
          }),
          signal: AbortSignal.timeout(70000),
        },
      );
      const body = await response.json();
      sessionId = body.sessionId ?? sessionId;
      result.turns.push({
        query,
        status: response.status,
        durationMs: Date.now() - started,
        success: body.success === true,
        answer: body.assistantText,
        error: body.error,
        code: body.code,
        metadata: body.metadata,
        tokens: body.tokens,
      });
      if (!response.ok || !body.success) break;
    } catch {
      result.turns.push({
        query,
        success: false,
        error: "network_or_timeout",
        durationMs: Date.now() - started,
      });
      break;
    }
  }
  report.cases.push(result);
  process.stdout.write(
    `${scenario.id}: ${result.turns.filter((t) => t.success).length}/${scenario.turns.length} turnos concluídos; utilidade pendente de revisão\n`,
  );
}
const output = option("--output", `/tmp/dna-agentes-eval-${Date.now()}.json`);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + "\n", {
  mode: 0o600,
});
process.stdout.write(`Relatório: ${output}\n`);
