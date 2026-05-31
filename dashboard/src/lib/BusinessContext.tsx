/**
 * BusinessContext — carrega o único negócio cadastrado (modelo single-tenant).
 * Toda a interface trabalha sobre este negócio sem expor seleção ao usuário.
 */
import React, { createContext, useContext, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Spin, Alert, Button, Card, Input, Typography, message } from 'antd';
import { KeyOutlined } from '@ant-design/icons';
import { api, getApiKey, setApiKey } from './api';
import type { Business } from './types';

const { Title, Paragraph, Text } = Typography;

interface BusinessContextValue {
  business: Business;
  refetch: () => void;
}

const Ctx = createContext<BusinessContextValue | null>(null);

function isAuthError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err ?? '').toLowerCase();
  return msg.includes('unauthorized') || msg.includes('forbidden') || msg.includes('401') || msg.includes('403');
}

function ApiKeyGate({ onSaved, missing }: { onSaved: () => void; missing: boolean }) {
  const [value, setValue] = useState(getApiKey());
  const save = () => {
    if (!value.trim()) {
      message.warning('Informe a chave de acesso.');
      return;
    }
    setApiKey(value.trim());
    message.success('Chave salva!');
    onSaved();
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '70vh', padding: 24 }}>
      <Card style={{ maxWidth: 480, width: '100%' }}>
        <Title level={4} style={{ marginTop: 0 }}>
          <KeyOutlined /> Acesso ao painel
        </Title>
        <Paragraph type="secondary">
          {missing
            ? 'Este navegador ainda não tem a chave de acesso configurada. Cole abaixo a chave fornecida pelo suporte para entrar.'
            : 'A chave de acesso atual não é válida para este domínio. Informe a chave correta para continuar.'}
        </Paragraph>
        <Input.Password
          autoFocus
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder="Cole aqui a sua chave"
          onPressEnter={save}
          style={{ marginBottom: 12 }}
        />
        <Button type="primary" block onClick={save}>Entrar</Button>
        <Text type="secondary" style={{ display: 'block', marginTop: 12, fontSize: 12 }}>
          A chave fica salva neste navegador. Você pode alterá-la depois no botão "API Key" no topo da tela.
        </Text>
      </Card>
    </div>
  );
}

export function BusinessProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const hasKey = !!getApiKey();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['businesses'],
    queryFn: api.getBusinesses,
    refetchInterval: 60_000,
    retry: false,
    enabled: hasKey,
  });

  // Sem chave salva → pede direto
  if (!hasKey) {
    return <ApiKeyGate missing onSaved={() => { qc.invalidateQueries({ queryKey: ['businesses'] }); refetch(); }} />;
  }

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <Spin size="large" tip="Carregando..." />
      </div>
    );
  }

  // Chave inválida → mesmo gate
  if (error && isAuthError(error)) {
    return <ApiKeyGate missing={false} onSaved={() => { qc.invalidateQueries({ queryKey: ['businesses'] }); refetch(); }} />;
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
          description={'O sistema ainda não foi configurado. Entre em contato com o suporte para criar o seu negócio.'}
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
