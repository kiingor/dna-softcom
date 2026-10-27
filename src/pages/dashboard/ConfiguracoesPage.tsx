import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import PermissionGuard from "@/components/dashboard/PermissionGuard";
import { useDashboard } from "@/contexts/DashboardContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Buildings as Building2, CircleNotch as Loader2, FloppyDisk as Save, Users, Upload, Trash as Trash2, Image as ImageIcon, ChatCircle as MessageSquare, ShieldCheck, LockKey } from "@phosphor-icons/react";
import { toast } from "sonner";
import { UsersAccessTab } from "@/components/dashboard/UsersAccessTab";
import { SecurityTab } from "@/components/dashboard/SecurityTab";
import { useIsCompanyAdmin, usePermissions } from "@/hooks/usePermissions";
import WhatsAppConfigTab from "@/components/whatsapp/WhatsAppConfigTab";
import AuditoriaTab from "@/modules/audit/pages/AuditoriaTab";
import { MfaLoginCard } from "@/components/security/MfaLoginCard";
import { PixEnvironmentCard } from "@/modules/payroll/components/PixEnvironmentCard";
import { FeedbackSettingsTab } from "@/modules/feedback/components/FeedbackSettingsTab";

const ConfiguracoesPage = () => {
  const { currentCompany, hasAnyRole } = useDashboard();
  const queryClient = useQueryClient();
  const { isAdmin } = useIsCompanyAdmin();
  const { canView: canViewPermissoes } = usePermissions("permissoes");
  const canAccessUsersTab = isAdmin || canViewPermissoes;
  // Aba Segurança hospeda DOIS controles: o 2º fator de LOGIN (todo papel
  // administrativo pode/deve ativar) e o celular de confirmação de PAGAMENTO (só
  // quem executa pagamento). Por isso o acesso à aba abre para admin, executores
  // de pagamento e os papéis que precisam de MFA de login (admin_gc/diretoria).
  const { canCreate: canExecutePayment } = usePermissions("folha_pagamento_exec");
  const canAccessSecurityTab =
    isAdmin || canExecutePayment || hasAnyRole(["admin_gc", "diretoria"]);
  const [searchParams] = useSearchParams();
  const [isEditing, setIsEditing] = useState(false);
  const [activeTab, setActiveTab] = useState("conta");
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Handle tab from URL params
  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab && ["conta", "usuarios", "whatsapp", "auditoria", "feedback"].includes(tab)) {
      setActiveTab(tab);
    }
    // 'seguranca' só entra se a pessoa puder ver: a permissão chega assíncrona,
    // então sem essa guarda um link direto abriria a aba antes da checagem e
    // deixaria o conteúdo em branco pra quem não paga.
    if (tab === "seguranca" && canAccessSecurityTab) {
      setActiveTab(tab);
    }
  }, [searchParams, canAccessSecurityTab]);

  // Form state for company data
  const [formData, setFormData] = useState({
    company_name: "",
    cnpj: "",
    email: "",
    phone: "",
    address: "",
  });

  // Fetch company details
  const { data: company, isLoading } = useQuery({
    queryKey: ["company-settings", currentCompany?.id],
    queryFn: async () => {
      if (!currentCompany?.id) return null;
      const { data, error } = await supabase
        .from("companies")
        .select("*")
        .eq("id", currentCompany.id)
        .single();
      if (error) throw error;
      
      setFormData({
        company_name: data.company_name || "",
        cnpj: data.cnpj || "",
        email: data.email || "",
        phone: data.phone || "",
        address: data.address || "",
      });
      
      return data;
    },
    enabled: !!currentCompany?.id,
  });

  // Update company mutation
  const updateCompanyMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      if (!currentCompany?.id) throw new Error("Empresa não encontrada");
      const { error } = await supabase
        .from("companies")
        .update({
          company_name: data.company_name,
          cnpj: data.cnpj,
          email: data.email,
          phone: data.phone,
          address: data.address,
        })
        .eq("id", currentCompany.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Dados atualizados com sucesso!");
      queryClient.invalidateQueries({ queryKey: ["company-settings"] });
      setIsEditing(false);
    },
    onError: () => {
      toast.error("Erro ao atualizar dados");
    },
  });

  // Logo upload handler
  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentCompany?.id) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Selecione um arquivo de imagem (PNG, JPG)");
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      toast.error("A imagem deve ter no máximo 2MB");
      return;
    }

    setIsUploadingLogo(true);
    try {
      const ext = file.name.split(".").pop() || "png";
      const filePath = `${currentCompany.id}/logo.${ext}`;

      // Upload to storage
      const { error: uploadError } = await supabase.storage
        .from("company-logos")
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: urlData } = supabase.storage
        .from("company-logos")
        .getPublicUrl(filePath);

      // Save URL to company
      const { error: updateError } = await supabase
        .from("companies")
        .update({ logo_url: urlData.publicUrl })
        .eq("id", currentCompany.id);

      if (updateError) throw updateError;

      queryClient.invalidateQueries({ queryKey: ["company-settings"] });
      toast.success("Logomarca atualizada com sucesso!");
    } catch (error: any) {
      console.error("Error uploading logo:", error);
      toast.error("Erro ao enviar logomarca");
    } finally {
      setIsUploadingLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  };

  // Logo remove handler
  const handleRemoveLogo = async () => {
    if (!currentCompany?.id) return;

    try {
      // Remove from storage
      const { error: deleteError } = await supabase.storage
        .from("company-logos")
        .remove([`${currentCompany.id}/logo.png`, `${currentCompany.id}/logo.jpg`, `${currentCompany.id}/logo.jpeg`]);

      if (deleteError) console.error("Error deleting logo file:", deleteError);

      // Clear URL from company
      const { error: updateError } = await supabase
        .from("companies")
        .update({ logo_url: null })
        .eq("id", currentCompany.id);

      if (updateError) throw updateError;

      queryClient.invalidateQueries({ queryKey: ["company-settings"] });
      toast.success("Logomarca removida!");
    } catch (error) {
      toast.error("Erro ao remover logomarca");
    }
  };

  const handleSave = () => {
    updateCompanyMutation.mutate(formData);
  };

  const formatCNPJ = (value: string) => {
    const numbers = value.replace(/\D/g, "");
    return numbers
      .replace(/^(\d{2})(\d)/, "$1.$2")
      .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d)/, ".$1/$2")
      .replace(/(\d{4})(\d)/, "$1-$2")
      .slice(0, 18);
  };

  const formatPhone = (value: string) => {
    const numbers = value.replace(/\D/g, "");
    if (numbers.length <= 10) {
      return numbers
        .replace(/^(\d{2})(\d)/, "($1) $2")
        .replace(/(\d{4})(\d)/, "$1-$2");
    }
    return numbers
      .replace(/^(\d{2})(\d)/, "($1) $2")
      .replace(/(\d{5})(\d)/, "$1-$2")
      .slice(0, 15);
  };

  if (isLoading) {
    return (
      <PermissionGuard module="configuracoes">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </PermissionGuard>
    );
  }

  return (
    <PermissionGuard module="configuracoes">
      <div className="space-y-6">
        <div>
          <p className="text-muted-foreground">
            Gerencie os dados da sua conta
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="flex-wrap">
            <TabsTrigger value="conta" className="gap-2">
              <Building2 className="w-4 h-4" />
              Dados da Conta
            </TabsTrigger>
            {canAccessUsersTab && (
              <TabsTrigger value="usuarios" className="gap-2">
                <Users className="w-4 h-4" />
                Usuários e Acessos
              </TabsTrigger>
            )}
            <TabsTrigger value="whatsapp" className="gap-2">
              <MessageSquare className="w-4 h-4" />
              Notificações WhatsApp
            </TabsTrigger>
            <TabsTrigger value="feedback" className="gap-2">
              <MessageSquare className="w-4 h-4" />
              Feedback
            </TabsTrigger>
            {canAccessSecurityTab && (
              <TabsTrigger value="seguranca" className="gap-2">
                <LockKey className="w-4 h-4" />
                Segurança
              </TabsTrigger>
            )}
            {isAdmin && (
              <TabsTrigger value="auditoria" className="gap-2">
                <ShieldCheck className="w-4 h-4" />
                Auditoria
              </TabsTrigger>
            )}
          </TabsList>

          {/* Tab: Dados da Conta */}
          <TabsContent value="feedback"><FeedbackSettingsTab /></TabsContent>
          <TabsContent value="conta" className="space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Building2 className="w-5 h-5 text-primary" />
                    Dados Cadastrais
                  </CardTitle>
                  <CardDescription>
                    Informações da sua empresa
                  </CardDescription>
                </div>
                {!isEditing ? (
                  <Button variant="outline" onClick={() => setIsEditing(true)}>
                    Editar
                  </Button>
                ) : (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setIsEditing(false);
                        setFormData({
                          company_name: company?.company_name || "",
                          cnpj: company?.cnpj || "",
                          email: company?.email || "",
                          phone: company?.phone || "",
                          address: company?.address || "",
                        });
                      }}
                    >
                      Cancelar
                    </Button>
                    <Button
                      onClick={handleSave}
                      disabled={updateCompanyMutation.isPending}
                    >
                      {updateCompanyMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      ) : (
                        <Save className="w-4 h-4 mr-2" />
                      )}
                      Salvar
                    </Button>
                  </div>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="company_name">Nome da Empresa</Label>
                    <Input
                      id="company_name"
                      value={formData.company_name}
                      onChange={(e) =>
                        setFormData({ ...formData, company_name: e.target.value })
                      }
                      disabled={!isEditing}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cnpj">CNPJ</Label>
                    <Input
                      id="cnpj"
                      value={formData.cnpj}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          cnpj: formatCNPJ(e.target.value),
                        })
                      }
                      disabled={!isEditing}
                      placeholder="00.000.000/0000-00"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">E-mail</Label>
                    <Input
                      id="email"
                      type="email"
                      value={formData.email}
                      onChange={(e) =>
                        setFormData({ ...formData, email: e.target.value })
                      }
                      disabled={!isEditing}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">Telefone</Label>
                    <Input
                      id="phone"
                      value={formData.phone}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          phone: formatPhone(e.target.value),
                        })
                      }
                      disabled={!isEditing}
                      placeholder="(00) 00000-0000"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="address">Endereço</Label>
                  <Input
                    id="address"
                    value={formData.address}
                    onChange={(e) =>
                      setFormData({ ...formData, address: e.target.value })
                    }
                    disabled={!isEditing}
                    placeholder="Rua, número, bairro, cidade - UF"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Logomarca */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ImageIcon className="w-5 h-5 text-primary" />
                  Logomarca
                </CardTitle>
                <CardDescription>
                  A logomarca será exibida nos relatórios e recibos em PDF
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-6">
                  {/* Logo Preview */}
                  <div className="w-24 h-24 rounded-lg border-2 border-dashed border-muted-foreground/30 flex items-center justify-center overflow-hidden bg-muted/30">
                    {company?.logo_url ? (
                      <img
                        src={company.logo_url}
                        alt="Logomarca da empresa"
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <ImageIcon className="w-8 h-8 text-muted-foreground/50" />
                    )}
                  </div>

                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => logoInputRef.current?.click()}
                        disabled={isUploadingLogo}
                      >
                        {isUploadingLogo ? (
                          <Loader2 className="w-4 h-4 animate-spin mr-2" />
                        ) : (
                          <Upload className="w-4 h-4 mr-2" />
                        )}
                        {company?.logo_url ? "Alterar Logo" : "Enviar Logo"}
                      </Button>
                      {company?.logo_url && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleRemoveLogo}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Remover
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      PNG ou JPG. Tamanho máximo: 2MB.
                    </p>
                  </div>

                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/jpg"
                    className="hidden"
                    onChange={handleLogoUpload}
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tab: Usuários e Acessos */}
          {canAccessUsersTab && (
            <TabsContent value="usuarios">
              <UsersAccessTab />
            </TabsContent>
          )}

          {/* Tab: WhatsApp Notifications */}
          <TabsContent value="whatsapp">
            <WhatsAppConfigTab />
          </TabsContent>

          {/* Tab: Segurança — 2º fator de login (papéis admin) + celular de
              confirmação de pagamento (só executores de pagamento). */}
          {canAccessSecurityTab && (
            <TabsContent value="seguranca" className="space-y-6">
              <MfaLoginCard />
              {(isAdmin || canExecutePayment) && <SecurityTab />}
              {/* Ambiente do PIX (sandbox↔produção): só admin_gc / diretoria — é o
                  botão que liga pagamentos reais. */}
              {(isAdmin || hasAnyRole(["admin_gc", "diretoria"])) && <PixEnvironmentCard />}
            </TabsContent>
          )}

          {/* Tab: Auditoria (admin-only) */}
          {isAdmin && (
            <TabsContent value="auditoria">
              <AuditoriaTab />
            </TabsContent>
          )}

        </Tabs>
      </div>
    </PermissionGuard>
  );
};

export default ConfiguracoesPage;
