import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Button, Table, Modal, Form, Input, Space, Typography, message,
  Spin, Result, Badge, Tooltip, AutoComplete,
  Select, Popconfirm, Divider, Tag,
} from 'antd';
import {
  PlusOutlined, EditOutlined, MessageOutlined, DeleteOutlined,
  LinkOutlined, DisconnectOutlined, WifiOutlined, CopyOutlined, RobotOutlined,
  BellOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Business, Agent } from '../lib/types';

const { Title, Text } = Typography;

const POPULAR_MODELS = [
  'google/gemini-2.5-flash-lite',
  'google/gemini-2.5-flash',
  'google/gemini-2.0-flash-001',
  'openai/gpt-4.1-mini',
  'openai/gpt-4o-mini',
  'openai/gpt-4o',
  'anthropic/claude-3.5-haiku',
  'anthropic/claude-sonnet-4-5',
  'meta-llama/llama-3.3-70b-instruct',
  'deepseek/deepseek-chat-v3-0324',
].map(v => ({ value: v, label: v }));

// Seção de agentes (dentro do expanded row)

function AgentsSection({
  business, onAdd, onEdit, onDelete,
}: {
  business: Business;
  onAdd: () => void;
  onEdit: (agent: Agent) => void;
  onDelete: (agentId: string) => void;
}) {
  const agents = business.agents ?? [];
  const assignedIds = new Set(Object.values(business.instanceAgents ?? {}));
  return (
    <div style={{ padding: '10px 48px 4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <Text style={{ fontSize: 11, textTransform: 'uppercase', color: '#999', fontWeight: 600, letterSpacing: 0.5 }}>
          <RobotOutlined style={{ marginRight: 4 }} />Agentes IA
        </Text>
        <Button type="link" size="small" icon={<PlusOutlined />} style={{ padding: 0, height: 'auto', fontSize: 12 }} onClick={onAdd}>
          Novo agente
        </Button>
      </div>
      {agents.length === 0 ? (
        <div style={{ color: '#bbb', fontSize: 12, paddingBottom: 8, fontStyle: 'italic' }}>
          Nenhum agente configurado. Crie um agente para responder mensagens automaticamente.
        </div>
      ) : (
        agents.map(agent => (
          <div key={agent._id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0', borderBottom: '1px solid #f9f9f9' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Text strong style={{ fontSize: 13 }}>{agent.name}</Text>
              <Text style={{ fontSize: 12, color: '#666', marginLeft: 8 }}>({agent.assistantName})</Text>
              <Text code style={{ fontSize: 10, marginLeft: 8, color: '#888' }}>{agent.model}</Text>
              {assignedIds.has(agent._id) && (
                <Tag color="green" style={{ fontSize: 10, marginLeft: 8, lineHeight: '16px', padding: '0 4px' }}>ativo</Tag>
              )}
            </div>
            <Space size={4}>
              <Button size="small" icon={<EditOutlined />} onClick={() => onEdit(agent)}>Editar</Button>
              <Popconfirm
                title="Remover agente?"
                description="Números vinculados ficarão sem atendimento automático."
                onConfirm={() => onDelete(agent._id)}
                okText="Remover" cancelText="Cancelar" okButtonProps={{ danger: true }}
              >
                <Button size="small" danger ghost icon={<DeleteOutlined />} />
              </Popconfirm>
            </Space>
          </div>
        ))
      )}
    </div>
  );
}

// Painel de instâncias (números WhatsApp)

interface InstanceStatus { instanceName: string; status: string; inboxId: number | null; }

function InstancesPanel({
  business, refreshKey, onConnect, onSendLink, onAssignAgent,
}: {
  business: Business;
  refreshKey: number;
  onConnect: (b: Business, instanceName: string) => void;
  onSendLink: (b: Business, instanceName: string) => void;
  onAssignAgent: (instanceName: string, agentId: string | null) => void;
}) {
  const [statuses, setStatuses] = useState<InstanceStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [botLoading, setBotLoading] = useState<string | null>(null);
  const [botEnabled, setBotEnabled] = useState<Record<string, boolean>>({});

  const fetchStatuses = useCallback(async () => {
    try {
      const data = await api.getInstancesStatus(business._id);
      setStatuses(data);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [business._id]);

  // Fetch Chatwoot bot status for all instances
  const fetchBotStatuses = useCallback(async () => {
    const instances = business.instances ?? [];
    const results = await Promise.allSettled(instances.map(name => api.getChatwootStatus(business._id, name)));
    const map: Record<string, boolean> = {};
    instances.forEach((name, i) => {
      const r = results[i];
      if (r.status === 'fulfilled') map[name] = r.value.botEnabled;
    });
    setBotEnabled(map);
  }, [business._id, business.instances]);

  useEffect(() => {
    setLoading(true);
    fetchStatuses();
    fetchBotStatuses();
    const id = setInterval(fetchStatuses, 10_000);
    return () => clearInterval(id);
  }, [fetchStatuses, fetchBotStatuses, refreshKey]);

  const disconnect = async (instanceName: string) => {
    setDisconnecting(instanceName);
    try {
      await api.disconnectInstance(business._id, instanceName);
      message.success(`${instanceName} desconectado`);
      fetchStatuses();
    } catch (e) { message.error((e as Error).message); }
    finally { setDisconnecting(null); }
  };

  const toggleBot = async (instanceName: string) => {
    setBotLoading(instanceName);
    const currentlyEnabled = botEnabled[instanceName] ?? false;
    try {
      await api.setAgentBot(business._id, instanceName, !currentlyEnabled);
      setBotEnabled(prev => ({ ...prev, [instanceName]: !currentlyEnabled }));
      message.success(!currentlyEnabled ? `Bot IA ativado para ${instanceName}` : `Bot IA desativado para ${instanceName}`);
    } catch (e) { message.error((e as Error).message); }
    finally { setBotLoading(null); }
  };

  const sc = (s: string): 'success' | 'warning' | 'default' =>
    s === 'open' ? 'success' : s === 'connecting' ? 'warning' : 'default';
  const sl = (s: string) =>
    s === 'open' ? 'Conectado' : s === 'connecting' ? 'Conectando...' : 'Desconectado';

  const agents = business.agents ?? [];
  const instanceAgents = business.instanceAgents ?? {};
  const rows: InstanceStatus[] = statuses.length > 0
    ? statuses
    : (business.instances ?? []).map(name => ({ instanceName: name, status: 'unknown', inboxId: (business.instanceInboxes ?? {})[name] ?? null }));

  return (
    <div>
      <div style={{ padding: '10px 48px 4px' }}>
        <Text style={{ fontSize: 11, textTransform: 'uppercase', color: '#999', fontWeight: 600, letterSpacing: 0.5 }}>
          Números WhatsApp
        </Text>
      </div>
      {!business.instances?.length ? (
        <div style={{ padding: '4px 48px 12px', color: '#bbb', fontSize: 12, fontStyle: 'italic' }}>
          Nenhum número. Use "+ WhatsApp" para adicionar.
        </div>
      ) : (
        <div style={{ padding: '0 48px 12px' }}>
          {loading && statuses.length === 0 ? (
            <Spin size="small" style={{ marginTop: 8 }} />
          ) : (
            rows.map(inst => (
              <div key={inst.instanceName} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid #f5f5f5', flexWrap: 'wrap' }}>
                <Text code style={{ fontSize: 12, minWidth: 140 }}>{inst.instanceName}</Text>
                <Badge status={sc(inst.status)} text={<span style={{ fontSize: 12 }}>{sl(inst.status)}</span>} />
                <Select
                  size="small"
                  style={{ minWidth: 160 }}
                  value={instanceAgents[inst.instanceName] ?? null}
                  onChange={(agentId) => onAssignAgent(inst.instanceName, agentId)}
                  placeholder={agents.length ? 'Sem agente' : '— crie um agente —'}
                  allowClear
                  options={agents.map(a => ({ value: a._id, label: a.name }))}
                  disabled={agents.length === 0}
                />
                <Space size={4}>
                  {inst.status !== 'open' && (
                    <>
                      <Button size="small" type="primary" ghost icon={<WifiOutlined />} onClick={() => onConnect(business, inst.instanceName)}>Conectar</Button>
                      <Tooltip title="Link seguro para conectar remotamente">
                        <Button size="small" icon={<LinkOutlined />} onClick={() => onSendLink(business, inst.instanceName)}>Enviar link</Button>
                      </Tooltip>
                    </>
                  )}
                  {inst.status === 'open' && (
                    <Button size="small" danger ghost icon={<DisconnectOutlined />}
                      loading={disconnecting === inst.instanceName}
                      onClick={() => disconnect(inst.instanceName)}>
                      Desconectar
                    </Button>
                  )}
                  {inst.inboxId && (
                    <Button size="small" icon={<MessageOutlined />} href={`https://chatwoot.vendly.chat/app/accounts/1/inbox/${inst.inboxId}`} target="_blank">
                      Inbox
                    </Button>
                  )}
                  {inst.inboxId && (
                    <Tooltip title={botEnabled[inst.instanceName] ? 'Bot IA ativo — clique para desativar' : 'Ativar Bot IA nesta inbox'}>
                      <Button
                        size="small"
                        icon={<RobotOutlined />}
                        loading={botLoading === inst.instanceName}
                        type={botEnabled[inst.instanceName] ? 'primary' : 'default'}
                        onClick={() => toggleBot(inst.instanceName)}
                      >
                        Bot IA
                      </Button>
                    </Tooltip>
                  )}
                </Space>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// Seção de contatos de notificação de escalada

function NotifyListSection({ business }: { business: Business }) {
  const qc = useQueryClient();
  const [newPhone, setNewPhone] = useState('');
  const [adding, setAdding] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['notify-list', business._id],
    queryFn: () => api.getNotifyList(business._id),
  });

  const list = data?.escalationNotifyList ?? [];

  const add = async () => {
    const digits = newPhone.replace(/\D/g, '');
    if (!digits) return;
    setAdding(true);
    try {
      await api.addNotifyContact(business._id, digits);
      qc.invalidateQueries({ queryKey: ['notify-list', business._id] });
      setNewPhone('');
      message.success('Número adicionado');
    } catch (e) { message.error((e as Error).message); }
    finally { setAdding(false); }
  };

  const remove = async (phone: string) => {
    try {
      await api.removeNotifyContact(business._id, phone);
      qc.invalidateQueries({ queryKey: ['notify-list', business._id] });
      message.success('Número removido');
    } catch (e) { message.error((e as Error).message); }
  };

  return (
    <div style={{ padding: '10px 48px 12px' }}>
      <Text style={{ fontSize: 11, textTransform: 'uppercase', color: '#999', fontWeight: 600, letterSpacing: 0.5 }}>
        <BellOutlined style={{ marginRight: 4 }} />Notificações de Escalada (WhatsApp)
      </Text>
      <div style={{ marginTop: 8, color: '#888', fontSize: 12, marginBottom: 8 }}>
        Quando o bot escalar para humano, estes números recebem mensagem de aviso no WhatsApp.
      </div>
      {isLoading ? <Spin size="small" /> : (
        <>
          {list.length === 0 && (
            <div style={{ color: '#bbb', fontSize: 12, fontStyle: 'italic', marginBottom: 8 }}>Nenhum número cadastrado.</div>
          )}
          <Space wrap style={{ marginBottom: 8 }}>
            {list.map(phone => (
              <Tag
                key={phone}
                closable
                onClose={() => remove(phone)}
                style={{ fontSize: 13, padding: '2px 8px' }}
              >
                +{phone}
              </Tag>
            ))}
          </Space>
          <Space.Compact style={{ width: '100%', maxWidth: 340 }}>
            <Input
              placeholder="Ex: 5521999999999"
              value={newPhone}
              onChange={e => setNewPhone(e.target.value)}
              onPressEnter={add}
            />
            <Button type="primary" icon={<PlusOutlined />} loading={adding} onClick={add}>
              Adicionar
            </Button>
          </Space.Compact>
        </>
      )}
    </div>
  );
}

// Página principal

const { Title: H3 } = Typography;

export default function Businesses() {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({ queryKey: ['businesses'], queryFn: api.getBusinesses });

  const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([]);
  useEffect(() => {
    setExpandedRowKeys(prev => {
      const newIds = data.map(b => b._id).filter(id => !prev.includes(id));
      return newIds.length ? [...prev, ...newIds] : prev;
    });
  }, [data]);

  const [bizOpen, setBizOpen] = useState(false);
  const [editingBiz, setEditingBiz] = useState<Business | null>(null);
  const [bizForm] = Form.useForm();

  const [addInstOpen, setAddInstOpen] = useState(false);
  const [addInstTarget, setAddInstTarget] = useState<Business | null>(null);
  const [addInstForm] = Form.useForm();
  const connectAfterRef = useRef(false);

  const [deleteTarget, setDeleteTarget] = useState<Business | null>(null);
  const [deleteInput, setDeleteInput] = useState('');

  const [qrOpen, setQrOpen] = useState(false);
  const [qrBusiness, setQrBusiness] = useState<Business | null>(null);
  const [qrInstanceName, setQrInstanceName] = useState<string | null>(null);
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrConnected, setQrConnected] = useState(false);
  const [instanceRefreshKeys, setInstanceRefreshKeys] = useState<Record<string, number>>({});
  const qrRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const qrStatusRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [linkOpen, setLinkOpen] = useState(false);
  const [linkTarget, setLinkTarget] = useState<{ business: Business; instanceName: string } | null>(null);
  const [linkEmail, setLinkEmail] = useState('');
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [linkLoading, setLinkLoading] = useState(false);

  const [agentOpen, setAgentOpen] = useState(false);
  const [agentBiz, setAgentBiz] = useState<Business | null>(null);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [agentForm] = Form.useForm();

  // Mutations

  const saveBiz = useMutation({
    mutationFn: (values: Partial<Business>) =>
      editingBiz ? api.updateBusiness(editingBiz._id, values) : api.createBusiness(values),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['businesses'] }); setBizOpen(false); message.success(editingBiz ? 'Salvo!' : 'Negócio criado!'); },
    onError: (e: Error) => message.error(e.message),
  });

  const deleteBiz = useMutation({
    mutationFn: (id: string) => api.deleteBusiness(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['businesses'] }); setDeleteTarget(null); message.success('Negócio removido.'); },
    onError: (e: Error) => message.error(e.message),
  });

  const addInstance = useMutation({
    mutationFn: ({ id, instanceName }: { id: string; instanceName: string }) => api.addInstance(id, { instanceName }),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ['businesses'] });
      setAddInstOpen(false);
      addInstForm.resetFields();
      const biz = updated as Business;
      if (connectAfterRef.current) {
        openQrModal(biz, (biz.instances ?? []).at(-1) ?? '');
      } else {
        message.success('Número adicionado!');
        bumpRefreshKey(biz._id);
      }
    },
    onError: (e: Error) => message.error(e.message),
  });

  const createAgent = useMutation({
    mutationFn: ({ bizId, data }: { bizId: string; data: Partial<Agent> }) => api.createAgent(bizId, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['businesses'] }); setAgentOpen(false); message.success('Agente criado!'); },
    onError: (e: Error) => message.error(e.message),
  });

  const updateAgent = useMutation({
    mutationFn: ({ bizId, agentId, data }: { bizId: string; agentId: string; data: Partial<Agent> }) =>
      api.updateAgent(bizId, agentId, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['businesses'] }); setAgentOpen(false); message.success('Agente salvo!'); },
    onError: (e: Error) => message.error(e.message),
  });

  const deleteAgent = useMutation({
    mutationFn: ({ bizId, agentId }: { bizId: string; agentId: string }) => api.deleteAgent(bizId, agentId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['businesses'] }); message.success('Agente removido.'); },
    onError: (e: Error) => message.error(e.message),
  });

  const assignAgent = useMutation({
    mutationFn: ({ bizId, instanceName, agentId }: { bizId: string; instanceName: string; agentId: string | null }) =>
      api.assignAgent(bizId, instanceName, agentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['businesses'] }),
    onError: (e: Error) => message.error(e.message),
  });

  // QR helpers

  const bumpRefreshKey = (bizId: string) =>
    setInstanceRefreshKeys(prev => ({ ...prev, [bizId]: (prev[bizId] ?? 0) + 1 }));

  const fetchQr = async (id: string, instanceName: string) => {
    setQrLoading(true); setQrBase64(null);
    try { const d = await api.getBusinessQr(id, instanceName); setQrBase64(d.base64); } catch { /* ignore */ }
    setQrLoading(false);
  };

  const startQrPolling = (id: string, instanceName: string) => {
    if (qrStatusRef.current) clearInterval(qrStatusRef.current);
    qrStatusRef.current = setInterval(async () => {
      try {
        const d = await api.getBusinessQrStatus(id, instanceName);
        if (d.status === 'open') {
          setQrConnected(true);
          clearInterval(qrStatusRef.current!);
          clearInterval(qrRefreshRef.current!);
          setTimeout(() => bumpRefreshKey(id), 1500);
        }
      } catch { /* ignore */ }
    }, 5000);
    if (qrRefreshRef.current) clearInterval(qrRefreshRef.current);
    qrRefreshRef.current = setInterval(() => fetchQr(id, instanceName), 30_000);
  };

  const openQrModal = (b: Business, instanceName: string) => {
    setQrBusiness(b); setQrInstanceName(instanceName); setQrConnected(false); setQrBase64(null); setQrOpen(true);
    fetchQr(b._id, instanceName);
    startQrPolling(b._id, instanceName);
  };

  const closeQrModal = () => {
    setQrOpen(false);
    if (qrRefreshRef.current) clearInterval(qrRefreshRef.current);
    if (qrStatusRef.current) clearInterval(qrStatusRef.current);
    if (qrBusiness) bumpRefreshKey(qrBusiness._id);
  };

  useEffect(() => () => {
    if (qrRefreshRef.current) clearInterval(qrRefreshRef.current);
    if (qrStatusRef.current) clearInterval(qrStatusRef.current);
  }, []);

  // Send-link helpers

  const openSendLink = (b: Business, instanceName: string) => {
    setLinkTarget({ business: b, instanceName }); setLinkEmail(''); setLinkUrl(null); setLinkOpen(true);
  };

  const generateLink = async () => {
    if (!linkTarget) return;
    setLinkLoading(true);
    try {
      const { connectUrl } = await api.sendQrLink(linkTarget.business._id, linkTarget.instanceName, linkEmail || undefined);
      setLinkUrl(connectUrl);
      if (linkEmail) message.success('Link enviado por email!');
    } catch (e) { message.error((e as Error).message); }
    finally { setLinkLoading(false); }
  };

  // Agent modal helpers

  const openAddAgent = (b: Business) => {
    setAgentBiz(b); setEditingAgent(null);
    agentForm.setFieldsValue({
      name: '', assistantName: 'Vendly', model: 'google/gemini-2.5-flash-lite',
      systemPrompt: `Você é Vendly, assistente virtual da {{nome_da_empresa}}.

## Papel
Atendo clientes pelo WhatsApp com cordialidade e agilidade, respondendo dúvidas e auxiliando em tudo que precisarem.

## O que posso ajudar
- Dúvidas sobre produtos e serviços
- Informações sobre pedidos e entregas
- Agendamentos e reservas
- Suporte e resolução de problemas

## Como me comporto
- Respondo de forma curta e direta (1 a 3 parágrafos)
- Uso linguagem natural, como numa conversa humana
- Nunca invento informações — se não sei, digo que vou verificar
- Trato cada cliente pelo nome quando disponível

## Sobre o negócio
[Descreva aqui: produtos, serviços, horários de atendimento, endereço, políticas de troca, etc.]`,
    });
    setAgentOpen(true);
  };

  const openEditAgent = (b: Business, agent: Agent) => {
    setAgentBiz(b); setEditingAgent(agent);
    agentForm.setFieldsValue(agent);
    setAgentOpen(true);
  };

  const submitAgent = () => {
    agentForm.validateFields().then(vals => {
      if (!agentBiz) return;
      if (editingAgent) {
        updateAgent.mutate({ bizId: agentBiz._id, agentId: editingAgent._id, data: vals });
      } else {
        createAgent.mutate({ bizId: agentBiz._id, data: vals });
      }
    });
  };

  // Table

  const cols = [
    { title: 'Nome', dataIndex: 'name', key: 'name' },
    {
      title: 'Acoes', key: 'actions', align: 'right' as const,
      render: (_: unknown, b: Business) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => { bizForm.setFieldsValue({ name: b.name }); setEditingBiz(b); setBizOpen(true); }}>Editar</Button>
          <Button size="small" icon={<PlusOutlined />} onClick={() => { setAddInstTarget(b); addInstForm.resetFields(); setAddInstOpen(true); }}>+ WhatsApp</Button>
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => { setDeleteTarget(b); setDeleteInput(''); }}>Excluir</Button>
        </Space>
      ),
    },
  ];

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <H3 level={3} style={{ margin: 0 }}>Negocios</H3>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { bizForm.resetFields(); setEditingBiz(null); setBizOpen(true); }}>Novo negocio</Button>
      </div>

      <Table
        rowKey="_id" dataSource={data} columns={cols} loading={isLoading} pagination={{ pageSize: 20 }}
        expandable={{
          expandedRowKeys,
          onExpand: (expanded, record) =>
            setExpandedRowKeys(prev => expanded ? [...prev, record._id] : prev.filter(k => k !== record._id)),
          expandedRowRender: (b) => (
            <div style={{ background: '#fafafa', borderRadius: 6, margin: '4px 0' }}>
              <AgentsSection
                business={b}
                onAdd={() => openAddAgent(b)}
                onEdit={(agent) => openEditAgent(b, agent)}
                onDelete={(agentId) => deleteAgent.mutate({ bizId: b._id, agentId })}
              />
              <Divider style={{ margin: '8px 0' }} />
              <InstancesPanel
                business={b}
                refreshKey={instanceRefreshKeys[b._id] ?? 0}
                onConnect={openQrModal}
                onSendLink={openSendLink}
                onAssignAgent={(instanceName, agentId) => assignAgent.mutate({ bizId: b._id, instanceName, agentId })}
              />
              <Divider style={{ margin: '8px 0' }} />
              <NotifyListSection business={b} />
            </div>
          ),
        }}
      />

      {/* Criar / Editar negocio */}
      <Modal
        title={editingBiz ? 'Editar negocio' : 'Novo negocio'}
        open={bizOpen} onOk={() => bizForm.validateFields().then(vals => saveBiz.mutate(vals))}
        onCancel={() => setBizOpen(false)} confirmLoading={saveBiz.isPending}
        okText={editingBiz ? 'Salvar' : 'Criar'}
      >
        <Form form={bizForm} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item name="name" label="Nome do negocio" rules={[{ required: true }]}>
            <Input placeholder="Ex: Loja da Maria" />
          </Form.Item>
        </Form>
      </Modal>

      {/* + WhatsApp */}
      <Modal
        title="Adicionar numero WhatsApp"
        open={addInstOpen} onCancel={() => setAddInstOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setAddInstOpen(false)}>Cancelar</Button>,
          <Button key="create" loading={addInstance.isPending} onClick={() => {
            addInstForm.validateFields().then(vals => { if (!addInstTarget) return; connectAfterRef.current = false; addInstance.mutate({ id: addInstTarget._id, instanceName: vals.instanceName }); });
          }}>Criar</Button>,
          <Button key="connect" type="primary" loading={addInstance.isPending} onClick={() => {
            addInstForm.validateFields().then(vals => { if (!addInstTarget) return; connectAfterRef.current = true; addInstance.mutate({ id: addInstTarget._id, instanceName: vals.instanceName }); });
          }}>Criar e conectar</Button>,
        ]}
        width={420}
      >
        <Form form={addInstForm} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item name="instanceName" label="Identificador da instancia"
            help="Apenas letras minusculas, numeros e hifen (ex: loja-maria)"
            rules={[{ required: true }, { pattern: /^[a-z0-9-]+$/, message: 'Apenas letras minusculas, numeros e hifen' }]}
          >
            <Input placeholder="loja-maria" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Agente (criar / editar) */}
      <Modal
        title={editingAgent ? `Editar agente` : 'Novo agente'}
        open={agentOpen} onOk={submitAgent} onCancel={() => setAgentOpen(false)}
        confirmLoading={createAgent.isPending || updateAgent.isPending}
        okText={editingAgent ? 'Salvar' : 'Criar agente'} width={620} destroyOnClose
      >
        <Form form={agentForm} layout="vertical" style={{ marginTop: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <Form.Item name="name" label="Nome do agente" rules={[{ required: true }]}>
              <Input placeholder="Ex: Suporte, Vendas, Agendamentos" />
            </Form.Item>
            <Form.Item name="assistantName" label="Nome do assistente" rules={[{ required: true }]}>
              <Input placeholder="Ex: Ana, Carlos, Bot" />
            </Form.Item>
          </div>
          <Form.Item
            name="model" label="Modelo de IA" rules={[{ required: true }]}
            help={<span>Digite ou selecione. Ver todos em <a href="https://openrouter.ai/models" target="_blank" rel="noreferrer">openrouter.ai/models</a></span>}
          >
            <AutoComplete
              options={POPULAR_MODELS}
              filterOption={(input, option) => (option?.value ?? '').toLowerCase().includes(input.toLowerCase())}
              placeholder="google/gemini-2.5-flash-lite"
            />
          </Form.Item>
          <Form.Item name="systemPrompt" label="Prompt do sistema">
            <Input.TextArea rows={10} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Excluir negocio */}
      <Modal
        title="Excluir negocio" open={!!deleteTarget} onCancel={() => setDeleteTarget(null)}
        okText="Excluir" okButtonProps={{ danger: true, disabled: deleteInput !== deleteTarget?.name, loading: deleteBiz.isPending }}
        onOk={() => deleteTarget && deleteBiz.mutate(deleteTarget._id)} cancelText="Cancelar"
      >
        <p>Esta acao e irreversivel. Serao removidos: instancias WhatsApp, caixa de entrada, conversas e clientes.</p>
        <p>Digite <strong>{deleteTarget?.name}</strong> para confirmar:</p>
        <Input value={deleteInput} onChange={e => setDeleteInput(e.target.value)} placeholder={deleteTarget?.name}
          onPressEnter={() => deleteInput === deleteTarget?.name && deleteTarget && deleteBiz.mutate(deleteTarget._id)} />
      </Modal>

      {/* QR Code */}
      <Modal
        title={`Conectar WhatsApp${qrInstanceName ? ` - ${qrInstanceName}` : ''}`}
        open={qrOpen} onCancel={closeQrModal}
        footer={qrConnected ? null : [
          <Button key="refresh" onClick={() => qrBusiness && qrInstanceName && fetchQr(qrBusiness._id, qrInstanceName)} loading={qrLoading}>Atualizar QR</Button>,
          <Button key="close" onClick={closeQrModal}>Fechar</Button>,
        ]} width={380}
      >
        {qrConnected ? (
          <Result status="success" title="Conectado!" />
        ) : (
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <div style={{ width: 280, height: 280, margin: '0 auto 16px', background: '#f9f9f9', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #f0f0f0' }}>
              {qrLoading ? <Spin size="large" /> : qrBase64
                ? <img src={qrBase64} alt="QR Code" style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 10 }} />
                : <span style={{ color: '#bbb', fontSize: 13 }}>QR indisponivel</span>}
            </div>
            <p style={{ color: '#666', fontSize: 13 }}>Abra o WhatsApp <strong>Dispositivos conectados Conectar dispositivo</strong></p>
          </div>
        )}
      </Modal>

      {/* Enviar link de conexao */}
      <Modal title={`Link de conexao${linkTarget ? ` - ${linkTarget.instanceName}` : ''}`}
        open={linkOpen} onCancel={() => setLinkOpen(false)} footer={null} width={460}
      >
        <div style={{ marginTop: 8 }}>
          <p style={{ color: '#666', fontSize: 13, marginBottom: 16 }}>Gere um link seguro (valido por 24h) para conectar o numero remotamente.</p>
          {linkUrl && (
            <div style={{ marginBottom: 16 }}>
              <Input.Group compact>
                <Input value={linkUrl} readOnly style={{ width: 'calc(100% - 80px)' }} />
                <Button icon={<CopyOutlined />} style={{ width: 80 }}
                  onClick={() => { navigator.clipboard.writeText(linkUrl); message.success('Copiado!'); }}>Copiar</Button>
              </Input.Group>
            </div>
          )}
          <Input placeholder="Email (opcional)" value={linkEmail} onChange={e => setLinkEmail(e.target.value)} style={{ marginBottom: 12 }} />
          <Button type="primary" loading={linkLoading} onClick={generateLink} block>
            {linkUrl ? 'Gerar novo link' : 'Gerar link'}
          </Button>
        </div>
      </Modal>
    </>
  );
}
