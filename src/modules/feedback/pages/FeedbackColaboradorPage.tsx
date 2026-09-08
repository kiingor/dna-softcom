import { useMemo, useState } from "react";
import {
  MagnifyingGlass as Search,
  Lock,
  ArrowsClockwise,
  ChatCircleText,
  Info,
  Plus,
} from "@phosphor-icons/react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/shared/components/EmptyState";
import { usePermissions } from "@/hooks/usePermissions";
import { useFeedbacks } from "../hooks/use-feedbacks";
import { GuardiaoSelect } from "../components/GuardiaoSelect";
import { FeedbackKpis } from "../components/FeedbackKpis";
import { FeedbackStatusColumn } from "../components/FeedbackStatusColumn";
import { ObjetivosSheet } from "../components/ObjetivosSheet";
import { NovoFeedbackDialog } from "../components/NovoFeedbackDialog";
import { getTempoDeCasa, todayISO } from "../lib";
import {
  FEEDBACK_STATUS_META,
  FEEDBACK_STATUS_ORDER,
  type FeedbackColaborador,
  type FeedbackStatus,
  type FeedbackStatusFilter,
  type Guardiao,
  type TempoDeCasaFilter,
} from "../types";

export default function FeedbackColaboradorPage() {
  const { canView, canCreate, canEdit, canDelete, isLoading: permsLoading } =
    usePermissions("feedback");

  const [guardiao, setGuardiao] = useState<Guardiao | null>(null);
  const [nameFilter, setNameFilter] = useState("");
  const [setorFilter, setSetorFilter] = useState<string>("all");
  const [empresaFilter, setEmpresaFilter] = useState<string>("all");
  const [tempoDeCasaFilter, setTempoDeCasaFilter] = useState<TempoDeCasaFilter>("all");
  const [statusFilter, setStatusFilter] = useState<FeedbackStatusFilter>("all");
  const [selected, setSelected] = useState<FeedbackColaborador | null>(null);
  const [novoOpen, setNovoOpen] = useState(false);

  const { data, isLoading, isError, isFetching, refetch } = useFeedbacks({
    lancamentoUsuarioId: guardiao?.id,
  });

  // Setores e empresas distintos pros filtros (a partir do que veio do painel).
  const setorOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of data?.colaboradores ?? []) if (c.setor) set.add(c.setor);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [data]);

  const empresaOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of data?.colaboradores ?? []) if (c.empresa) set.add(c.empresa);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [data]);

  const referenceDate = todayISO();

  // Segmentação por nome, setor e empresa, antes do tempo de casa e do status.
  const matchingCollaborators = useMemo(() => {
    const q = nameFilter.trim().toLowerCase();
    return (data?.colaboradores ?? []).filter(
      (c) =>
        (!q || (c.nome ?? "").toLowerCase().includes(q)) &&
        (setorFilter === "all" || c.setor === setorFilter) &&
        (empresaFilter === "all" || c.empresa === empresaFilter),
    );
  }, [data, nameFilter, setorFilter, empresaFilter]);

  const segmented = useMemo(
    () =>
      matchingCollaborators.filter(
        (c) => tempoDeCasaFilter === "all" || getTempoDeCasa(c.dataAdmissao, referenceDate) === tempoDeCasaFilter,
      ),
    [matchingCollaborators, tempoDeCasaFilter, referenceDate],
  );

  const withoutAdmissionDate = useMemo(
    () => matchingCollaborators.filter((c) => getTempoDeCasa(c.dataAdmissao, referenceDate) === null).length,
    [matchingCollaborators, referenceDate],
  );

  const filtered = useMemo(
    () => segmented.filter((c) => statusFilter === "all" || c.status === statusFilter),
    [segmented, statusFilter],
  );

  const grouped = useMemo(() => {
    const by: Record<FeedbackStatus, FeedbackColaborador[]> = {
      Pendente: [],
      "Em Atraso": [],
      "Em dia": [],
    };
    for (const c of filtered) {
      if (by[c.status]) by[c.status].push(c);
    }
    return by;
  }, [filtered]);

  // Mantém os totais da segmentação visíveis ao alternar entre os status.
  const totais = useMemo(
    () => ({
      colaboradores: segmented.length,
      pendente: segmented.filter((c) => c.status === "Pendente").length,
      emDia: segmented.filter((c) => c.status === "Em dia").length,
      emAtraso: segmented.filter((c) => c.status === "Em Atraso").length,
      feedbacks: segmented.reduce((sum, c) => sum + (c.feedbacks ?? 0), 0),
    }),
    [segmented],
  );

  const hasData = (data?.colaboradores.length ?? 0) > 0;
  const visibleStatuses = statusFilter === "all" ? FEEDBACK_STATUS_ORDER : [statusFilter];

  const selectStatus = (status: FeedbackStatusFilter) => {
    setStatusFilter((current) => current === status ? "all" : status);
  };

  const clearFilters = () => {
    setNameFilter("");
    setSetorFilter("all");
    setEmpresaFilter("all");
    setTempoDeCasaFilter("all");
    setStatusFilter("all");
    setGuardiao(null);
  };

  if (!permsLoading && !canView) {
    return (
      <EmptyState
        icon={<Lock className="w-7 h-7 text-primary" />}
        title="Sem acesso"
        description="Você ainda não tem permissão pra ver os feedbacks. Fala com o RH pra liberar."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-muted-foreground">
            Acompanhe os feedbacks do time e registre objetivos por colaborador.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canCreate && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={!guardiao ? "cursor-not-allowed" : undefined}>
                  <Button onClick={() => setNovoOpen(true)} disabled={!guardiao}>
                    <Plus className="w-4 h-4 mr-2" />
                    Novo feedback
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {guardiao
                  ? "Registrar feedback para um colaborador."
                  : "Selecione o Guardião(ã) da Cultura primeiro."}
              </TooltipContent>
            </Tooltip>
          )}
          <Button
            variant="outline"
            size="icon"
            onClick={() => refetch()}
            disabled={isFetching}
            title="Atualizar"
          >
            <ArrowsClockwise className={isFetching ? "w-4 h-4 animate-spin" : "w-4 h-4"} />
          </Button>
        </div>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Buscar colaborador pelo nome"
                value={nameFilter}
                onChange={(e) => setNameFilter(e.target.value)}
                placeholder="Buscar colaborador pelo nome..."
                className="pl-9"
              />
            </div>

            <div className="flex items-center gap-1">
              <GuardiaoSelect value={guardiao} onChange={setGuardiao} className="w-56" />
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="Sobre o Guardião(ã) da Cultura"
                  >
                    <Info className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  Guardião(ã) da Cultura (opcional). Filtra o painel por quem lançou os feedbacks — e
                  define quem lança ao registrar um novo.
                </TooltipContent>
              </Tooltip>
            </div>

            <Select value={setorFilter} onValueChange={setSetorFilter}>
              <SelectTrigger className="w-48" aria-label="Setor">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os setores</SelectItem>
                {setorOptions.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={empresaFilter} onValueChange={setEmpresaFilter}>
              <SelectTrigger className="w-48" aria-label="Empresa">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as empresas</SelectItem>
                {empresaOptions.map((e) => (
                  <SelectItem key={e} value={e}>
                    {e}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={tempoDeCasaFilter}
              onValueChange={(value: TempoDeCasaFilter) => setTempoDeCasaFilter(value)}
            >
              <SelectTrigger className="w-60" aria-label="Tempo de casa">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os tempos de casa</SelectItem>
                <SelectItem value="ate-um-ano">Até um ano de casa</SelectItem>
                <SelectItem value="mais-de-um-ano">Mais de um ano de casa</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {tempoDeCasaFilter !== "all" && withoutAdmissionDate > 0 && (
            <p className="mt-3 text-xs text-muted-foreground" role="status">
              {withoutAdmissionDate}{" "}
              {withoutAdmissionDate === 1
                ? "colaborador sem data de admissão válida não entra"
                : "colaboradores sem data de admissão válida não entram"}{" "}
              na segmentação por tempo de casa.
            </p>
          )}
        </CardContent>
      </Card>

      {/* KPIs */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[104px] rounded-lg" />
          ))}
        </div>
      ) : data ? (
        <div className="space-y-3">
          <FeedbackKpis totais={totais} statusFilter={statusFilter} onStatusSelect={selectStatus} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground" role="status">
              Exibindo {filtered.length} de {segmented.length} colaboradores
              {statusFilter !== "all" && ` · ${FEEDBACK_STATUS_META[statusFilter].label}`}
            </p>
            {statusFilter !== "all" ? (
              <Button variant="ghost" size="sm" onClick={() => setStatusFilter("all")}>
                Mostrar todos os status
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">Clique em um indicador ou título de coluna para filtrar.</p>
            )}
          </div>
        </div>
      ) : null}

      {/* Painel por status */}
      <div id="feedback-kanban">
        {isLoading ? (
          <div className="flex gap-4 overflow-x-auto pb-2">
            {FEEDBACK_STATUS_ORDER.map((s) => (
              <Skeleton key={s} className="min-w-[280px] flex-1 h-[320px] rounded-lg" />
            ))}
          </div>
        ) : isError ? (
          <EmptyState
            icon={<ChatCircleText className="w-7 h-7 text-primary" />}
            title="Não consegui carregar os feedbacks"
            description="Tenta recarregar o painel em instantes."
            action={
              <Button variant="outline" onClick={() => refetch()}>
                Recarregar
              </Button>
            }
          />
        ) : !hasData ? (
          <EmptyState
            icon={<ChatCircleText className="w-7 h-7 text-primary" />}
            title="Nada por aqui ainda"
            description={
              guardiao
                ? "Esse Guardião não tem feedbacks lançados. Tenta tirar o filtro?"
                : "Ninguém no painel por enquanto."
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<ChatCircleText className="w-7 h-7 text-primary" />}
            title="Ninguém com esse filtro"
            description="Tenta ajustar os filtros de nome, setor, empresa, tempo de casa ou status."
            action={
              <Button variant="outline" onClick={clearFilters}>
                Limpar filtros
              </Button>
            }
          />
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-2">
            {visibleStatuses.map((status) => (
              <FeedbackStatusColumn
                key={status}
                status={status}
                colaboradores={grouped[status]}
                onSelect={setSelected}
                active={statusFilter === status}
                onStatusSelect={selectStatus}
              />
            ))}
          </div>
        )}
      </div>

      <ObjetivosSheet
        colaborador={selected}
        guardiao={guardiao}
        perms={{ canCreate, canEdit, canDelete }}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />

      <NovoFeedbackDialog open={novoOpen} onOpenChange={setNovoOpen} guardiao={guardiao} />
    </div>
  );
}
