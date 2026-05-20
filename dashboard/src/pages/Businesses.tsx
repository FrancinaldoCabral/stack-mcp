import { useState, useEffect, useRef, useCallback } from 'react';
import { Button, Table, Modal, Form, Input, Space, Typography, message, Spin, Result, Badge, Tooltip } from 'antd';
import { PlusOutlined, EditOutlined, MessageOutlined, DeleteOutlined, LinkOutlined, DisconnectOutlined, WifiOutlined, CopyOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Business } from '../lib/types';

const { Title, Text } = Typography;

// ── Painel de instâncias (por negócio) ─────────────────────────────────────────

interface InstanceStatus { instanceName: string; status: string; inboxId: number | null; }

function InstancesPanel({
  business,
  refreshKey,
  onConnect,
  onSendLink,
}: {
  business: Business;
  refreshKey: number;
  onConnect: (b: Business, instanceName: string) => void;
  onSendLink: (b: Business, instanceName: string) => void;
}) {
  const [statuses, setStatuses] = useState<InstanceStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  const fetchStatuses = useCallback(async () => {
    try {
      const data = await api.getInstancesStatus(business._id);
      setStatuses(data);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [business._id]);

  useEffect(() => {
    setLoading(true);
    fetchStatuses();
    const id = setInterval(fetchStatuses, 10_000);
    return () => clearInterval(id);
  }, [fetchStatuses, refreshKey]);

  const disconnect = async (instanceName: string) => {
    setDisconnecting(instanceName);
    try {
      await api.disconnectInstance(business._id, instanceName);
      message.success(`${instanceName} desconectado`);
      fetchStatuses();
    } catch (e) { message.error((e as Error).message); }
    finally { setDisconnecting(null); }
  };

  if (!business.instances?.length) {
    return (
      <div style={{ padding: '8px 48px 12px', color: '#aaa', fontSize: 12 }}>
        Nenhuma instância WhatsApp. Use "+ WhatsApp" para adicionar.
      </div>
    );
  }

  const statusColor = (s: string): 'success' | 'warning' | 'default' => s === 'open' ? 'success' : s === 'connecting' ? 'warning' : 'default';
  const statusLabel = (s: string) => s === 'open' ? 'Conectado' : s === 'connecting' ? 'Conectando…' : 'Desconectado';

  // Fallback: usar business.instances se status ainda não chegou
  const rows: InstanceStatus[] = statuses.length > 0
    ? statuses
    : business.instances.map(name => ({ instanceName: name, status: 'unknown', inboxId: (business.instanceInboxes ?? {})[name] ?? null }));

  return (
    <div style={{ padding: '4px 48px 12px' }}>
      {loading && statuses.length === 0 ? (
        <Spin size="small" />
      ) : (
        rows.map(inst => (
          <div key={inst.instanceName} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0', borderBottom: '1px solid #f5f5f5' }}>
            <Text code style={{ fontSize: 12, minWidth: 160 }}>{inst.instanceName}</Text>
            <Badge status={statusColor(inst.status)} text={<span style={{ fontSize: 12 }}>{statusLabel(inst.status)}</span>} />
            <Space size={4}>
              {inst.status !== 'open' && (
                <>
                  <Button size="small" type="primary" ghost icon={<WifiOutlined />} onClick={() => onConnect(business, inst.instanceName)}>
                    Conectar
                  </Button>
                  <Tooltip title="Gerar link seguro para alguém conectar o número remotamente">
                    <Button size="small" icon={<LinkOutlined />} onClick={() => onSendLink(business, inst.instanceName)}>
                      Enviar link
                    </Button>
                  </Tooltip>
                </>
              )}
              {inst.status === 'open' && (
                <Button
                  size="small"
                  danger
                  ghost
                  icon={<DisconnectOutlined />}
                  loading={disconnecting === inst.instanceName}
                  onClick={() => disconnect(inst.instanceName)}
                >
                  Desconectar
                </Button>
              )}
              {inst.inboxId && (
                <Button size="small" icon={<MessageOutlined />} href={`https://chatwoot.vendly.chat/app/accounts/1/inbox/${inst.inboxId}`} target="_blank">
                  Caixa de entrada
                </Button>
              )}
            </Space>
          </div>
        ))
      )}
    </div>
  );
}

// ── Página principal ────────────────────────────────────────────────────────────

export default function Businesses() {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({ queryKey: ['businesses'], queryFn: api.getBusinesses });
  // Manter todas as linhas expandidas (inclusive novas) quando a lista atualiza
  useEffect(() => {
    setExpandedRowKeys(prev => {
      const newIds = data.map(b => b._id).filter(id => !prev.includes(id));
      return newIds.length ? [...prev, ...newIds] : prev;
    });
  }, [data]);
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Business | null>(null);

  // + WhatsApp modal
  const [addInstOpen, setAddInstOpen] = useState(false);
  const [addInstTarget, setAddInstTarget] = useState<Business | null>(null);
  const [addInstForm] = Form.useForm();
  const connectAfterRef = useRef(false);

  // Excluir
  const [deleteTarget, setDeleteTarget] = useState<Business | null>(null);
  const [deleteInput, setDeleteInput] = useState('');

  // QR modal
  const [qrOpen, setQrOpen] = useState(false);
  const [qrBusiness, setQrBusiness] = useState<Business | null>(null);
  const [qrInstanceName, setQrInstanceName] = useState<string | null>(null);
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrConnected, setQrConnected] = useState(false);
  const [instanceRefreshKeys, setInstanceRefreshKeys] = useState<Record<string, number>>({});
  const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([]);
  const qrRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const qrStatusRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Enviar link modal
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkTarget, setLinkTarget] = useState<{ business: Business; instanceName: string } | null>(null);
  const [linkEmail, setLinkEmail] = useState('');
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [linkLoading, setLinkLoading] = useState(false);

  // ── Mutations ────────────────────────────────────────────────────────────────

  const save = useMutation({
    mutationFn: (values: Partial<Business>) =>
      editing ? api.updateBusiness(editing._id, values) : api.createBusiness(values),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['businesses'] });
      setOpen(false);
      message.success(editing ? 'Salvo!' : 'Negócio criado!');
    },
    onError: (e: Error) => message.error(e.message),
  });

  const deleteBiz = useMutation({
    mutationFn: (id: string) => api.deleteBusiness(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['businesses'] });
      setDeleteTarget(null);
      message.success('Negócio removido.');
    },
    onError: (e: Error) => message.error(e.message),
  });

  const addInstance = useMutation({
    mutationFn: ({ id, instanceName }: { id: string; instanceName: string }) =>
      api.addInstance(id, { instanceName }),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ['businesses'] });
      setAddInstOpen(false);
      addInstForm.resetFields();
      const biz = updated as Business;
      if (connectAfterRef.current) {
        const instName = (biz.instances ?? []).at(-1) ?? '';
        openQrModal(biz, instName);
      } else {
        message.success('Número adicionado!');
        bumpRefreshKey(biz._id);
      }
    },
    onError: (e: Error) => message.error(e.message),
  });

  // ── QR helpers ───────────────────────────────────────────────────────────────

  const bumpRefreshKey = (bizId: string) =>
    setInstanceRefreshKeys(prev => ({ ...prev, [bizId]: (prev[bizId] ?? 0) + 1 }));

  const fetchQr = async (id: string, instanceName: string) => {
    setQrLoading(true);
    setQrBase64(null);
    try {
      const d = await api.getBusinessQr(id, instanceName);
      setQrBase64(d.base64);
    } catch { /* ignore */ }
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
          // Pequeno delay para Evolution estabilizar antes do painel re-buscar
          setTimeout(() => bumpRefreshKey(id), 1500);
        }
      } catch { /* ignore */ }
    }, 5000);
    if (qrRefreshRef.current) clearInterval(qrRefreshRef.current);
    qrRefreshRef.current = setInterval(() => fetchQr(id, instanceName), 30_000);
  };

  const openQrModal = (b: Business, instanceName: string) => {
    setQrBusiness(b);
    setQrInstanceName(instanceName);
    setQrConnected(false);
    setQrBase64(null);
    setQrOpen(true);
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

  // ── Send-link helpers ─────────────────────────────────────────────────────────

  const openSendLink = (b: Business, instanceName: string) => {
    setLinkTarget({ business: b, instanceName });
    setLinkEmail('');
    setLinkUrl(null);
    setLinkOpen(true);
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

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const openCreate = () => { form.resetFields(); setEditing(null); setOpen(true); };
  const openEdit = (b: Business) => { form.setFieldsValue(b); setEditing(b); setOpen(true); };

  const openAddInstance = (b: Business) => {
    setAddInstTarget(b);
    addInstForm.resetFields();
    setAddInstOpen(true);
  };

  const submitAddInstance = (connectAfter: boolean) => {
    addInstForm.validateFields().then(vals => {
      if (!addInstTarget) return;
      connectAfterRef.current = connectAfter;
      addInstance.mutate({ id: addInstTarget._id, instanceName: vals.instanceName });
    });
  };

  // ── Table ────────────────────────────────────────────────────────────────────

  const cols = [
    { title: 'Nome', dataIndex: 'name', key: 'name' },
    {
      title: 'Ações', key: 'actions', align: 'right' as const,
      render: (_: unknown, b: Business) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(b)}>Editar</Button>
          <Button size="small" icon={<PlusOutlined />} onClick={() => openAddInstance(b)}>+ WhatsApp</Button>
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => { setDeleteTarget(b); setDeleteInput(''); }}>Excluir</Button>
        </Space>
      ),
    },
  ];

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>Negócios</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Novo negócio</Button>
      </div>

      <Table
        rowKey="_id"
        dataSource={data}
        columns={cols}
        loading={isLoading}
        pagination={{ pageSize: 20 }}
        expandable={{
          expandedRowKeys,
          onExpand: (expanded, record) =>
            setExpandedRowKeys(prev =>
              expanded ? [...prev, record._id] : prev.filter(k => k !== record._id)
            ),
          expandedRowRender: (b) => (
            <InstancesPanel
              business={b}
              refreshKey={instanceRefreshKeys[b._id] ?? 0}
              onConnect={openQrModal}
              onSendLink={openSendLink}
            />
          ),
        }}
      />

      {/* ── Criar / Editar */}
      <Modal
        title={editing ? 'Editar negócio' : 'Novo negócio'}
        open={open}
        onOk={() => form.validateFields().then(vals => save.mutate(vals))}
        onCancel={() => setOpen(false)}
        confirmLoading={save.isPending}
        okText={editing ? 'Salvar' : 'Criar'}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item name="name" label="Nome" rules={[{ required: true }]}>
            <Input placeholder="Ex: Loja da Maria" />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── + WhatsApp */}
      <Modal
        title="+ WhatsApp"
        open={addInstOpen}
        onCancel={() => setAddInstOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setAddInstOpen(false)}>Cancelar</Button>,
          <Button key="create" loading={addInstance.isPending} onClick={() => submitAddInstance(false)}>Criar</Button>,
          <Button key="connect" type="primary" loading={addInstance.isPending} onClick={() => submitAddInstance(true)}>Criar e conectar</Button>,
        ]}
        width={400}
      >
        <Form form={addInstForm} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item
            name="instanceName"
            label="Nome da instância"
            rules={[
              { required: true, message: 'Informe o nome' },
              { pattern: /^[a-z0-9-]+$/, message: 'Use apenas letras minúsculas, números e hífen' },
            ]}
          >
            <Input placeholder="loja-maria" />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── Excluir negócio */}
      <Modal
        title="Excluir negócio"
        open={!!deleteTarget}
        onCancel={() => setDeleteTarget(null)}
        okText="Excluir"
        okButtonProps={{ danger: true, disabled: deleteInput !== deleteTarget?.name, loading: deleteBiz.isPending }}
        onOk={() => deleteTarget && deleteBiz.mutate(deleteTarget._id)}
        cancelText="Cancelar"
      >
        <p>Esta ação é irreversível. Serão removidos: instâncias WhatsApp, caixa de entrada, conversas e clientes deste negócio.</p>
        <p>Digite <strong>{deleteTarget?.name}</strong> para confirmar:</p>
        <Input
          value={deleteInput}
          onChange={e => setDeleteInput(e.target.value)}
          placeholder={deleteTarget?.name}
          onPressEnter={() => deleteInput === deleteTarget?.name && deleteTarget && deleteBiz.mutate(deleteTarget._id)}
        />
      </Modal>

      {/* ── QR Code */}
      <Modal
        title={`Conectar WhatsApp${qrInstanceName ? ` — ${qrInstanceName}` : ''}`}
        open={qrOpen}
        onCancel={closeQrModal}
        footer={qrConnected ? null : [
          <Button key="refresh" onClick={() => qrBusiness && qrInstanceName && fetchQr(qrBusiness._id, qrInstanceName)} loading={qrLoading}>
            ↻ Atualizar QR
          </Button>,
          <Button key="close" onClick={closeQrModal}>Fechar</Button>,
        ]}
        width={380}
      >
        {qrConnected ? (
          <Result status="success" title="Conectado!" />
        ) : (
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <div style={{ width: 280, height: 280, margin: '0 auto 16px', background: '#f9f9f9', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #f0f0f0' }}>
              {qrLoading
                ? <Spin size="large" />
                : qrBase64
                  ? <img src={qrBase64} alt="QR Code" style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 10 }} />
                  : <span style={{ color: '#bbb', fontSize: 13 }}>QR indisponível</span>
              }
            </div>
            <p style={{ color: '#666', fontSize: 13 }}>
              Abra o WhatsApp → <strong>Dispositivos conectados → Conectar dispositivo</strong>
            </p>
          </div>
        )}
      </Modal>

      {/* ── Enviar link de conexão */}
      <Modal
        title={`Link de conexão${linkTarget ? ` — ${linkTarget.instanceName}` : ''}`}
        open={linkOpen}
        onCancel={() => setLinkOpen(false)}
        footer={null}
        width={460}
      >
        <div style={{ marginTop: 8 }}>
          <p style={{ color: '#666', fontSize: 13, marginBottom: 16 }}>
            Gere um link seguro (válido por 24h) para que alguém conecte o número WhatsApp remotamente.
          </p>
          {linkUrl ? (
            <div style={{ marginBottom: 16 }}>
              <Input.Group compact>
                <Input value={linkUrl} readOnly style={{ width: 'calc(100% - 80px)' }} />
                <Button
                  icon={<CopyOutlined />}
                  style={{ width: 80 }}
                  onClick={() => { navigator.clipboard.writeText(linkUrl); message.success('Copiado!'); }}
                >
                  Copiar
                </Button>
              </Input.Group>
            </div>
          ) : null}
          <Input
            placeholder="Email (opcional — para enviar o link por email)"
            value={linkEmail}
            onChange={e => setLinkEmail(e.target.value)}
            style={{ marginBottom: 12 }}
          />
          <Button type="primary" loading={linkLoading} onClick={generateLink} block>
            {linkUrl ? '↻ Gerar novo link' : 'Gerar link'}
          </Button>
        </div>
      </Modal>
    </>
  );
}

