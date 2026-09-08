import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePermissions } from "./usePermissions";

const access = vi.hoisted(() => ({ admin: true, granted: false }));
vi.mock("@/contexts/DashboardContext", () => ({
  useDashboard: () => ({ user: { id: "user" }, currentCompany: { id: "company" } }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    isLoading: false,
    data: queryKey[0] === "is-company-admin" ? access.admin : {
      can_view: access.granted, can_create: access.granted,
      can_edit: access.granted, can_delete: access.granted,
    },
  }),
}));

beforeEach(() => { access.admin = true; access.granted = false; });

describe("permissão explícita de pagamentos", () => {
  it("não libera visualizar ou pagar apenas por ser administrador da empresa", () => {
    const { result } = renderHook(() => ({
      view: usePermissions("folha_pagamentos", true),
      execute: usePermissions("folha_pagamento_exec", true),
    }));
    expect(result.current.view.canView).toBe(false);
    expect(result.current.view.canEdit).toBe(false);
    expect(result.current.execute.canCreate).toBe(false);
    expect(result.current.execute.isAdmin).toBe(false);
  });

  it("respeita a permissão concedida pela RPC, incluindo o dono", () => {
    access.granted = true;
    const { result } = renderHook(() => usePermissions("folha_pagamento_exec", true));
    expect(result.current.canCreate).toBe(true);
  });

  it("mantém o acesso administrativo nos demais módulos", () => {
    const { result } = renderHook(() => usePermissions("colaboradores"));
    expect(result.current.canEdit).toBe(true);
    expect(result.current.isAdmin).toBe(true);
  });
});
