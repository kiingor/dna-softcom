import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Users, Pencil, Trash as Trash2, Copy, DotsThreeVertical, MagnifyingGlass, ArrowsClockwise } from "@phosphor-icons/react";
import { supabase } from '@/integrations/supabase/client';
import { useDashboard } from '@/contexts/DashboardContext';
import PermissionGuard from '@/components/dashboard/PermissionGuard';
import { usePermissions } from '@/hooks/usePermissions';
import { useCoreResourceMutation } from '@/hooks/useCoreResourceMutation';
import { AGENDA_SYNC_DISABLED } from '@/lib/agenda-sync';
import { useTeamDeleteImpact } from '../hooks/use-team-delete-impact';
import {
  describeBlockingCollaborators,
  describeDetached,
} from '../utils/team-delete-impact';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { TableSkeleton } from '@/components/ui/table-skeleton';

interface Team {
  id: string;
  name: string;
  description: string | null;
  store_id: string | null;
  created_at: string;
  stores?: { store_name: string } | null;
}

export default function SetoresPage() {
  const { currentCompany, stores } = useDashboard();
  const selectedCompanyId = currentCompany?.id;
  const queryClient = useQueryClient();
  const { canCreate, canDelete, isAdmin } = usePermissions('setores');
  // A conferência de vínculos lê collaborators, cuja RLS exige acesso ao módulo
  // Colaboradores. Sem ele a contagem viria zerada e liberaria a exclusão.
  const {
    canView: canViewCollaborators,
    isLoading: isCollaboratorPermissionLoading,
  } = usePermissions('colaboradores');
  const canSync = (canCreate || isAdmin) && !AGENDA_SYNC_DISABLED;
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [deletingTeam, setDeletingTeam] = useState<Team | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSyncConfirmOpen, setIsSyncConfirmOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    store_id: '',
  });

  const { data: teams = [], isLoading } = useQuery({
    queryKey: ['teams', selectedCompanyId],
    queryFn: async () => {
      if (!selectedCompanyId) return [];
      const { data, error } = await supabase
        .from('teams')
        .select('*, stores(store_name)')
        .eq('company_id', selectedCompanyId)
        .order('name');
      if (error) throw error;
      return data as Team[];
    },
    enabled: !!selectedCompanyId,
  });

  const filteredTeams = teams.filter((t) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      t.name.toLowerCase().includes(q) ||
      (t.description || '').toLowerCase().includes(q) ||
      (t.stores?.store_name || '').toLowerCase().includes(q)
    );
  });

  // Mutations vão via edge function core-resource-mutate (PUSH → agenda → local).
  const teamMutation = useCoreResourceMutation('teams');

  const handleTeamCreate = (data: typeof formData) => {
    teamMutation.mutate(
      {
        action: 'create',
        data: {
          name: data.name,
          description: data.description || null,
          store_id: data.store_id || null,
        },
      },
      { onSuccess: () => handleCloseDialog() },
    );
  };

  const handleTeamUpdate = (id: string, data: typeof formData) => {
    teamMutation.mutate(
      {
        action: 'update',
        id,
        data: {
          name: data.name,
          description: data.description || null,
          store_id: data.store_id || null,
        },
      },
      { onSuccess: () => handleCloseDialog() },
    );
  };

  // Com a agenda desligada, a exclusão pede syncToRemote:false e fica só no DNA,
  // mesmo que o secret AGENDA_SYNC_DISABLED falte no servidor. Sem isso, um
  // setor com external_id seria apagado também em api.softcom.cloud.
  const handleTeamDelete = (id: string) => {
    teamMutation.mutate({ action: 'delete', id, syncToRemote: !AGENDA_SYNC_DISABLED });
  };

  // collaborators/positions/job_openings.team_id são ON DELETE SET NULL: o
  // banco não barra, então o diálogo confere os vínculos antes de liberar.
  const deleteImpact = useTeamDeleteImpact(
    deletingTeam?.id ?? null,
    canViewCollaborators,
  );
  const isCheckingDeleteImpact =
    isCollaboratorPermissionLoading ||
    (canViewCollaborators && deleteImpact.isPending);
  const deleteBlockedReason = (() => {
    if (!deletingTeam || isCheckingDeleteImpact) return null;
    if (!canViewCollaborators) {
      return 'Pra excluir, você precisa de acesso a Colaboradores. É assim que a gente confere quem está no setor.';
    }
    if (deleteImpact.isError) {
      return 'Não deu pra conferir quem está neste setor. Fecha e tenta de novo?';
    }
    const blocking = deleteImpact.data?.blockingCollaborators ?? 0;
    if (blocking > 0) {
      return `Ainda tem ${describeBlockingCollaborators(blocking)} em "${deletingTeam.name}". Troca o setor deles e tenta de novo.`;
    }
    return null;
  })();
  const deleteDetachedText =
    deleteImpact.data && !deleteBlockedReason
      ? describeDetached(deleteImpact.data)
      : null;
  const canConfirmDelete =
    !!deletingTeam &&
    !isCheckingDeleteImpact &&
    !deleteBlockedReason &&
    !!deleteImpact.data &&
    !teamMutation.isPending;

  const confirmTeamDelete = () => {
    if (!deletingTeam || !canConfirmDelete) return;
    handleTeamDelete(deletingTeam.id);
    setDeletingTeam(null);
  };

  const handleOpenDialog = (team?: Team) => {
    if (team) {
      setEditingTeam(team);
      setFormData({
        name: team.name,
        description: team.description || '',
        store_id: team.store_id || '',
      });
    } else {
      setEditingTeam(null);
      setFormData({ name: '', description: '', store_id: '' });
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingTeam(null);
    setFormData({ name: '', description: '', store_id: '' });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast.error('Informe o nome do setor');
      return;
    }

    if (editingTeam) {
      handleTeamUpdate(editingTeam.id, formData);
    } else {
      handleTeamCreate(formData);
    }
  };

  const handleSync = async () => {
    if (!selectedCompanyId) return;
    setIsSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('sync-teams', {
        body: { companyId: selectedCompanyId },
      });
      if (error) throw error;
      const errMsg = (data as { error?: string } | null)?.error;
      if (errMsg) throw new Error(errMsg);
      const r = data as {
        inserted: number;
        updated: number;
        deactivated: number;
        fetched: number;
      };
      const parts = [
        `${r.inserted} novo(s)`,
        `${r.updated} atualizado(s)`,
      ];
      if (r.deactivated > 0) parts.push(`${r.deactivated} desativado(s)`);
      toast.success(`Sincronização concluída: ${parts.join(', ')}.`);
      queryClient.invalidateQueries({ queryKey: ['teams'] });
    } catch (err) {
      toast.error('Não foi possível sincronizar agora: ' + (err as Error).message);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <PermissionGuard module="setores">
      <div className="space-y-6 page-content">
        <div className="flex items-center justify-between animate-fade-in">
          <div>
            <p className="text-muted-foreground">
              Gerencie os setores/departamentos da empresa
            </p>
          </div>

          <div className="flex items-center gap-2">
            {canSync && (
              <>
                <Button
                  variant="outline"
                  onClick={() => setIsSyncConfirmOpen(true)}
                  disabled={isSyncing || !selectedCompanyId}
                  title="Importa setores da agenda (sincronize Empresas primeiro pra vincular à filial correta)"
                >
                  <ArrowsClockwise className={`mr-2 h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
                  {isSyncing ? 'Sincronizando...' : 'Sincronizar'}
                </Button>

                <AlertDialog open={isSyncConfirmOpen} onOpenChange={setIsSyncConfirmOpen}>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Sincronizar setores com a agenda?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Vou importar os setores que estão em <strong>api.softcom.cloud</strong> e marcar como inativos os que sumirem de lá. Setores criados manualmente aqui não são tocados. Pode continuar?
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={handleSync}>Sincronizar agora</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button onClick={() => handleOpenDialog()}>
                  <Plus className="mr-2 h-4 w-4" />
                  Novo Setor
                </Button>
              </DialogTrigger>
            <DialogContent>
              <form onSubmit={handleSubmit}>
                <DialogHeader>
                  <DialogTitle>
                    {editingTeam ? 'Editar Setor' : 'Novo Setor'}
                  </DialogTitle>
                  <DialogDescription>
                    {editingTeam
                      ? 'Atualize as informações do setor.'
                      : 'Preencha as informações do novo setor.'}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Nome do Setor *</Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) =>
                        setFormData({ ...formData, name: e.target.value })
                      }
                      placeholder="Ex: Administrativo"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="description">Descrição (opcional)</Label>
                    <Textarea
                      id="description"
                      value={formData.description}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          description: e.target.value,
                        })
                      }
                      placeholder="Descrição do setor..."
                      rows={3}
                    />
                  </div>
                  {stores.length > 0 && (
                    <div className="space-y-2">
                      <Label htmlFor="store_id">Empresa (opcional)</Label>
                      <Select
                        value={formData.store_id}
                        onValueChange={(value) =>
                          setFormData({
                            ...formData,
                            store_id: value === 'none' ? '' : value,
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione uma empresa" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Nenhuma</SelectItem>
                          {stores.map((store) => (
                            <SelectItem key={store.id} value={store.id}>
                              {store.store_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleCloseDialog}
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    disabled={teamMutation.isPending}
                  >
                    {editingTeam ? 'Salvar' : 'Criar'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
            </Dialog>
          </div>
        </div>

        <Card className="animate-scale-in">
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Lista de Setores
                </CardTitle>
                <CardDescription>
                  {filteredTeams.length} de {teams.length} setor(es)
                </CardDescription>
              </div>
              <div className="relative">
                <MagnifyingGlass className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por nome ou descrição..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 w-64"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <TableSkeleton columns={4} rows={4} />
            ) : filteredTeams.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                {searchQuery.trim() ? (
                  <>
                    <p>Nenhum setor encontrado</p>
                    <p className="text-sm">Tente outro termo de busca</p>
                  </>
                ) : (
                  <>
                    <p>Nenhum setor cadastrado</p>
                    <p className="text-sm">Clique em "Novo Setor" para começar</p>
                  </>
                )}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Empresa</TableHead>
                    <TableHead className="w-[100px]">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="stagger-animation">
                  {filteredTeams.map((team) => (
                    <TableRow key={team.id} className="table-row-animate">
                      <TableCell className="font-medium">{team.name}</TableCell>
                      <TableCell>{team.description || '-'}</TableCell>
                      <TableCell>{team.stores?.store_name || '-'}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              aria-label={`Ações do setor ${team.name}`}
                            >
                              <DotsThreeVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleOpenDialog(team)}>
                              <Pencil className="w-4 h-4 mr-2" />
                              Editar
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => { navigator.clipboard.writeText(team.id); toast.success("ID copiado!"); }}>
                              <Copy className="w-4 h-4 mr-2" />
                              Copiar ID
                            </DropdownMenuItem>
                            {canDelete && (
                              <>
                                <DropdownMenuSeparator />
                                {/* Com a agenda desligada, o DNA é a fonte dos setores e a
                                    exclusão é local. O diálogo confere os vínculos antes:
                                    colaborador ativo ou em admissão bloqueia. */}
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onClick={() => setDeletingTeam(team)}
                                >
                                  <Trash2 className="w-4 h-4 mr-2" />
                                  Excluir
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={!!deletingTeam} onOpenChange={(open) => !open && setDeletingTeam(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteBlockedReason ? 'Ainda não dá pra excluir' : 'Excluir setor?'}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                {isCheckingDeleteImpact ? (
                  <p>Conferindo quem está neste setor...</p>
                ) : deleteBlockedReason ? (
                  <p>{deleteBlockedReason}</p>
                ) : (
                  <p>
                    "{deletingTeam?.name}" vai sair da lista de setores. Essa ação não tem volta.
                    {AGENDA_SYNC_DISABLED && ' Não afeta a agenda.'}
                  </p>
                )}
                {deleteDetachedText && (
                  <p className="rounded-md bg-warning/10 px-3 py-2 text-warning">
                    Vão ficar sem setor: {deleteDetachedText}.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{deleteBlockedReason ? 'Voltar' : 'Cancelar'}</AlertDialogCancel>
            {!deleteBlockedReason && (
              <AlertDialogAction
                onClick={confirmTeamDelete}
                disabled={!canConfirmDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Excluir
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PermissionGuard>
  );
}
