import { useState } from 'react';
import {
  Card, Input, Button, Typography, Space, Alert, Divider, Popconfirm, Spin, Tag,
} from 'antd';
import {
  ClearOutlined, UserDeleteOutlined, WarningOutlined, CheckCircleOutlined,
} from '@ant-design/icons';
import { api } from '../lib/api';

const { Title, Text, Paragraph } = Typography;

export default function Maintenance() {
  // Clear by contact
  const [phone, setPhone] = useState('');
  const [instance, setInstance] = useState('');
  const [contactLoading, setContactLoading] = useState(false);
  const [contactResult, setContactResult] = useState<string | null>(null);
  const [contactError, setContactError] = useState<string | null>(null);

  // Clear all
  const [allLoading, setAllLoading] = useState(false);
  const [allResult, setAllResult] = useState<string | null>(null);
  const [allError, setAllError] = useState<string | null>(null);

  const clearContact = async () => {
    const cleanPhone = phone.replace(/\D/g, '');
    if (!cleanPhone) return;
    setContactLoading(true);
    setContactResult(null);
    setContactError(null);
    try {
      const res = await api.clearContactConversations(cleanPhone, instance || undefined);
      setContactResult(res.detail);
    } catch (e) {
      setContactError((e as Error).message);
    } finally {
      setContactLoading(false);
    }
  };

  const clearAll = async () => {
    setAllLoading(true);
    setAllResult(null);
    setAllError(null);
    try {
      const res = await api.clearAllConversations();
      setAllResult(res.detail);
    } catch (e) {
      setAllError((e as Error).message);
    } finally {
      setAllLoading(false);
    }
  };

  return (
    <>
      <Title level={3} style={{ marginTop: 0 }}>Manutenção</Title>
      <Paragraph type="secondary">
        Limpeza de dados de conversas — Chatwoot, Redis e MongoDB. Use para reiniciar o histórico de um contato ou limpar tudo para testes.
      </Paragraph>

      {/* ── Limpar por contato ─────────────────────────────────── */}
      <Card
        title={<Space><UserDeleteOutlined /><span>Limpar conversa por contato</span></Space>}
        style={{ marginBottom: 24 }}
      >
        <Paragraph type="secondary" style={{ marginBottom: 16 }}>
          Apaga todas as mensagens do Chatwoot, chaves Redis (sessão, buffer, debounce, human_takeover) e documentos MongoDB para um número específico.
        </Paragraph>

        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Space wrap>
            <div>
              <Text style={{ display: 'block', marginBottom: 4, fontSize: 12, color: '#666' }}>
                Telefone <Tag color="red" style={{ fontSize: 10 }}>obrigatório</Tag>
              </Text>
              <Input
                style={{ width: 240 }}
                placeholder="5511999999999"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                onPressEnter={clearContact}
                disabled={contactLoading}
              />
            </div>
            <div>
              <Text style={{ display: 'block', marginBottom: 4, fontSize: 12, color: '#666' }}>
                Instância Evolution <Tag color="blue" style={{ fontSize: 10 }}>opcional</Tag>
              </Text>
              <Input
                style={{ width: 200 }}
                placeholder="ex: minha-instancia"
                value={instance}
                onChange={e => setInstance(e.target.value)}
                onPressEnter={clearContact}
                disabled={contactLoading}
              />
            </div>
          </Space>

          <Popconfirm
            title="Limpar dados do contato?"
            description={`Vai apagar TODOS os dados de ${phone || 'este contato'} no Chatwoot, Redis e MongoDB. Irreversível.`}
            onConfirm={clearContact}
            okText="Sim, limpar"
            cancelText="Cancelar"
            okButtonProps={{ danger: true }}
            disabled={!phone.replace(/\D/g, '')}
          >
            <Button
              type="primary"
              danger
              icon={contactLoading ? <Spin size="small" /> : <UserDeleteOutlined />}
              disabled={!phone.replace(/\D/g, '') || contactLoading}
            >
              Limpar contato
            </Button>
          </Popconfirm>

          {contactResult && (
            <Alert
              type="success"
              icon={<CheckCircleOutlined />}
              showIcon
              message="Limpeza concluída"
              description={<pre style={{ margin: 0, fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap' }}>{contactResult}</pre>}
            />
          )}
          {contactError && (
            <Alert type="error" showIcon message="Erro" description={contactError} />
          )}
        </Space>
      </Card>

      {/* ── Limpar tudo ────────────────────────────────────────── */}
      <Card
        title={
          <Space>
            <ClearOutlined style={{ color: '#ff4d4f' }} />
            <span style={{ color: '#ff4d4f' }}>Limpar TODAS as conversas</span>
          </Space>
        }
        style={{ borderColor: '#ffccc7' }}
      >
        <Alert
          type="warning"
          showIcon
          icon={<WarningOutlined />}
          message="Operação irreversível"
          description="Apaga TODAS as mensagens de TODAS as conversas no Chatwoot, todos os dados de sessão no Redis (sessao:*, buffer:*, debounce_ts:*, human_takeover:*) e toda a collection conversations no MongoDB."
          style={{ marginBottom: 16 }}
        />

        <Popconfirm
          title="Tem certeza? Esta ação não pode ser desfeita."
          description="Vai apagar TUDO — todas as conversas, sessões e histórico de todos os contatos."
          onConfirm={clearAll}
          okText="Sim, APAGAR TUDO"
          cancelText="Cancelar"
          okButtonProps={{ danger: true }}
        >
          <Button
            danger
            type="primary"
            size="large"
            icon={allLoading ? <Spin size="small" /> : <ClearOutlined />}
            disabled={allLoading}
          >
            Limpar todas as conversas
          </Button>
        </Popconfirm>

        {allResult && (
          <Alert
            type="success"
            showIcon
            icon={<CheckCircleOutlined />}
            message="Limpeza total concluída"
            description={<pre style={{ margin: 0, fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap' }}>{allResult}</pre>}
            style={{ marginTop: 16 }}
          />
        )}
        {allError && (
          <Alert type="error" showIcon message="Erro" description={allError} style={{ marginTop: 16 }} />
        )}
      </Card>

      <Divider />
      <Text type="secondary" style={{ fontSize: 12 }}>
        Estas operações chamam a API REST do servidor MCP diretamente — nenhuma ferramenta externa necessária.
      </Text>
    </>
  );
}
