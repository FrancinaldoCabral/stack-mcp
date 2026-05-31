/**
 * BusinessContext — carrega o único negócio cadastrado (modelo single-tenant).
 * Toda a interface trabalha sobre este negócio sem expor seleção ao usuário.
 */
import React, { createContext, useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Spin, Alert, Button, Space } from 'antd';
import { api } from './api';
import type { Business } from './types';

interface BusinessContextValue {
  business: Business;
  refetch: () => void;
}

const Ctx = createContext<BusinessContextValue | null>(null);

export function BusinessProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['businesses'],
    queryFn: api.getBusinesses,
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <Spin size="large" tip="Carregando..." />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 32 }}>
        <Alert
          type="error"
          showIcon
          message="Não foi possível carregar o negócio"
          description={String((error as Error).message ?? error)}
          action={<Button onClick={() => refetch()}>Tentar de novo</Button>}
        />
      </div>
    );
  }

  const list = data ?? [];
  if (list.length === 0) {
    return (
      <div style={{ padding: 32 }}>
        <Alert
          type="warning"
          showIcon
          message="Nenhum negócio cadastrado ainda"
          description={
            <Space direction="vertical">
              <span>O sistema ainda não foi configurado. Entre em contato com o suporte para criar o seu negócio.</span>
            </Space>
          }
        />
      </div>
    );
  }

  // Pega o primeiro (modelo single-tenant)
  const business = list[0];

  return <Ctx.Provider value={{ business, refetch: () => refetch() }}>{children}</Ctx.Provider>;
}

export function useBusiness(): BusinessContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useBusiness deve estar dentro de <BusinessProvider>');
  return ctx;
}
