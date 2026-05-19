import { useState, useEffect, useRef } from 'react';
import {
  Button, Table, Modal, Form, Input, Select, Space,
  Popconfirm, Tag, Typography, message, Tooltip, Badge, Spin, Result,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, LinkOutlined, ToolOutlined, QrcodeOutlined, MailOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Business } from '../lib/types';

const { Title } = Typography;
const { TextArea } = Input;

export default function Businesses() {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({ queryKey: ['businesses'], queryFn: api.getBusinesses });
  const [form] = Form.useForm();
  const [provisionForm] = Form.useForm();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Business | null>(null);
  const [provisionOpen, setProvisionOpen] = useState(false);
  const [provisionTarget, setProvisionTarget] = useState<Business | null>(null);
  const [creating, setCreating] = useState(false); // true = creating new (shows instanceName field)

  // QR modal state
  const [qrOpen, setQrOpen] = useState(false);
  const [qrBusiness, setQrBusiness] = useState<Business | null>(null);
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrConnected, setQrConnected] = useState(false);
  const qrRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const qrStatusRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Send link modal state
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkBusiness, setLinkBusiness] = useState<Business | null>(null);
  const [linkForm] = Form.useForm();
  const [linkResult, setLinkResult] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (values: Partial<Business>) =>
      editing ? api.updateBusiness(editing._id, values) : api.createBusiness(values),
    onSuccess: async (created, values) => {
      qc.invalidateQueries({ queryKey: ['businesses'] });
      setOpen(false);
      // If creating with an instanceName, auto-provision then open QR
      if (!editing && (values as { instanceName?: string }).instanceName) {
        const instanceName = (values as { instanceName?: string }).instanceName!;
        const bizId = (created as Business)._id;
        try {
          await api.provisionBusiness(bizId, { instanceName });
          qc.invalidateQueries({ queryKey: ['businesses'] });
          message.success('Negócio criado e provisionado! Escaneie o QR para conectar.');
          // Fetch the fresh business and open QR
          const fresh = await api.getBusiness(bizId);
          openQrModal(fresh);
        } catch (e: unknown) {
          message.warning('Negócio criado, mas falha ao provisionar: ' + (e as Error).message);
        }
      } else {
        message.success('Salvo!');
      }
    },
    onError: (e: Error) => message.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteBusiness(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['businesses'] }); message.success('Removido.'); },
    onError: (e: Error) => message.error(e.message),
  });

  const provision = useMutation({
    mutationFn: ({ id, instanceName }: { id: string; instanceName: string }) =>
      api.provisionBusiness(id, { instanceName }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['businesses'] });
      setProvisionOpen(false);
      message.success('Provisionado!');
      // Open QR modal for the provisioned business
      const biz = data.find(b => b._id === vars.id);
      if (biz) openQrModal({ ...biz, instances: [vars.instanceName] });
    },
    onError: (e: Error) => message.error(e.message),
  });

  const sendLink = useMutation({
    mutationFn: ({ id, email }: { id: string; email: string }) => api.sendQrLink(id, email),
    onSuccess: (data) => { setLinkResult(data.connectUrl); message.success('E-mail enviado!'); },
    onError: (e: Error) => message.error(e.message),
  });

  // QR helpers
  const fetchQr = async (id: string) => {
    setQrLoading(true);
    setQrBase64(null);
    try {
      const d = await api.getBusinessQr(id);
      setQrBase64(d.base64);
    } catch { message.error('Não foi possível obter o QR code'); }
    setQrLoading(false);
  };

  const startQrPolling = (id: string) => {
    if (qrStatusRef.current) clearInterval(qrStatusRef.current);
    qrStatusRef.current = setInterval(async () => {
      try {
        const d = await api.getBusinessQrStatus(id);
        if (d.status === 'open') {
          setQrConnected(true);
          clearInterval(qrStatusRef.current!);
          clearInterval(qrRefreshRef.current!);
        }
      } catch { /* ignore */ }
    }, 5000);
    if (qrRefreshRef.current) clearInterval(qrRefreshRef.current);
    qrRefreshRef.current = setInterval(() => fetchQr(id), 30_000);
  };

  const openQrModal = (b: Business) => {
    setQrBusiness(b);
    setQrConnected(false);
    setQrBase64(null);
    setQrOpen(true);
    fetchQr(b._id);
    startQrPolling(b._id);
  };

  const closeQrModal = () => {
    setQrOpen(false);
    if (qrRefreshRef.current) clearInterval(qrRefreshRef.current);
    if (qrStatusRef.current) clearInterval(qrStatusRef.current);
  };

  useEffect(() => () => {
    if (qrRefreshRef.current) clearInterval(qrRefreshRef.current);
    if (qrStatusRef.current) clearInterval(qrStatusRef.current);
  }, []);

  const openLinkModal = (b: Business) => {
    setLinkBusiness(b);
    setLinkResult(null);
    linkForm.resetFields();
    setLinkOpen(true);
  };

  const openCreate = () => { form.resetFields(); setEditing(null); setCreating(true); setOpen(true); };
  const openEdit = (b: Business) => {
    form.setFieldsValue({ ...b, instances: b.instances?.join(', ') });
    setEditing(b);
    setCreating(false);
    setOpen(true);
  };
  const openProvision = (b: Business) => {
    provisionForm.resetFields();
    setProvisionTarget(b);
    setProvisionOpen(true);
  };

  const handleSubmit = () => {
    form.validateFields().then(vals => {
      const { instanceName, ...rest } = vals as { instanceName?: string; [k: string]: unknown };
      const payload = {
        ...rest,
        instances: instanceName ? [instanceName] : String(rest.instances ?? '').split(',').map((s: string) => s.trim()).filter(Boolean),
        instanceName, // pass through so onSuccess can read it
      };
      save.mutate(payload);
    });
  };

  const handleProvision = () => {
    provisionForm.validateFields().then(vals => {
      if (!provisionTarget) return;
      provision.mutate({ id: provisionTarget._id, instanceName: vals.instanceName });
    });
  };

  const cols = [
    { title: 'Nome', dataIndex: 'name', key: 'name' },
    { title: 'Instâncias', dataIndex: 'instances', key: 'instances',
      render: (insts: string[]) => insts?.map(i => <Tag key={i}>{i}</Tag>) },
    { title: 'Assistente', dataIndex: 'assistantName', key: 'assistantName' },
    { title: 'Modelo', key: 'model', render: (_: unknown, b: Business) => <code style={{ fontSize: 11 }}>{b.settings?.model ?? '-'}</code> },
    { title: 'Chatwoot', key: 'chatwoot',
      render: (_: unknown, b: Business) => b.chatwootInboxId
        ? <Tooltip title={`Inbox ID: ${b.chatwootInboxId}`}><Badge status="success" text="Provisionado" /></Tooltip>
        : <Badge status="default" text="Não provisionado" />,
    },
    {
      title: 'Ações', key: 'actions',
      render: (_: unknown, b: Business) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(b)}>Editar</Button>
          {b.chatwootInboxId
            ? <>
                <Button size="small" icon={<QrcodeOutlined />} onClick={() => openQrModal(b)}>Conectar</Button>
                <Button size="small" icon={<MailOutlined />} onClick={() => openLinkModal(b)}>Enviar link</Button>
                <Tooltip title={`Inbox ${b.chatwootInboxId}`}>
                  <Button size="small" icon={<LinkOutlined />}
                    href="https://chatwoot.vendly.chat" target="_blank">Chatwoot</Button>
                </Tooltip>
              </>
            : <Button size="small" icon={<ToolOutlined />} onClick={() => openProvision(b)}>Provisionar</Button>
          }
          <Popconfirm title="Remover negócio?" onConfirm={() => remove.mutate(b._id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>Remover</Button>
          </Popconfirm>
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

      <Table rowKey="_id" dataSource={data} columns={cols} loading={isLoading} pagination={{ pageSize: 20 }} />

      <Modal
        title={editing ? 'Editar negócio' : 'Novo negócio'}
        open={open}
        onOk={handleSubmit}
        onCancel={() => setOpen(false)}
        confirmLoading={save.isPending}
        okText={creating ? 'Criar e Provisionar' : 'Salvar'}
        width={600}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="name" label="Nome" rules={[{ required: true }]}>
            <Input placeholder="Ex: Loja da Maria" />
          </Form.Item>
          {creating && (
            <Form.Item
              name="instanceName"
              label="Nome da instância WhatsApp"
              rules={[
                { required: true, message: 'Informe o nome da instância' },
                { pattern: /^[a-z0-9-]+$/, message: 'Use apenas letras minúsculas, números e hífen' },
              ]}
              extra="Identificador único da instância Evolution. Ex: loja-maria"
            >
              <Input placeholder="loja-maria" />
            </Form.Item>
          )}
          {!creating && (
            <Form.Item name="instances" label="Instâncias Evolution (separadas por vírgula)">
              <Input placeholder="Ex: loja-maria, loja-maria-vendas" />
            </Form.Item>
          )}
          <Form.Item name="assistantName" label="Nome do assistente">
            <Input placeholder="Assistente" />
          </Form.Item>
          <Form.Item name={['settings', 'model']} label="Modelo LLM">
            <Select options={[
              { value: 'google/gemini-2.5-flash-preview', label: 'Gemini 2.5 Flash (recomendado)' },
              { value: 'google/gemini-2.0-flash-lite-001', label: 'Gemini 2.0 Flash Lite' },
              { value: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B (gratuito)' },
            ]} defaultValue="google/gemini-2.5-flash-preview" />
          </Form.Item>
          <Form.Item name="systemPrompt" label="System Prompt">
            <TextArea rows={4} placeholder="Descreva o papel e personalidade do assistente..." />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`Provisionar: ${provisionTarget?.name ?? ''}`}
        open={provisionOpen}
        onOk={handleProvision}
        onCancel={() => setProvisionOpen(false)}
        confirmLoading={provision.isPending}
        okText="Provisionar"
        width={480}
      >
        <p style={{ marginBottom: 16, color: '#666' }}>
          Cria a instância Evolution e o inbox Chatwoot automaticamente, já integrados.
        </p>
        <Form form={provisionForm} layout="vertical">
          <Form.Item
            name="instanceName"
            label="Nome da instância Evolution"
            rules={[
              { required: true, message: 'Informe o nome da instância' },
              { pattern: /^[a-z0-9-]+$/, message: 'Use apenas letras minúsculas, números e hífen' },
            ]}
          >
            <Input placeholder="Ex: loja-maria" />
          </Form.Item>
        </Form>
      </Modal>

      {/* QR Code modal — admin escaneia diretamente */}
      <Modal
        title={`Conectar WhatsApp — ${qrBusiness?.name ?? ''}`}
        open={qrOpen}
        onCancel={closeQrModal}
        footer={qrConnected ? null : [
          <Button key="refresh" onClick={() => qrBusiness && fetchQr(qrBusiness._id)} loading={qrLoading}>
            ↻ Atualizar QR
          </Button>,
          <Button key="close" onClick={closeQrModal}>Fechar</Button>,
        ]}
        width={400}
      >
        {qrConnected ? (
          <Result status="success" title="WhatsApp conectado!" subTitle="A instância está ativa e pronta para receber mensagens." />
        ) : (
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: 280, height: 280, margin: '0 auto 16px', background: '#f9f9f9', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #f0f0f0' }}>
              {qrLoading ? <Spin size="large" /> : qrBase64
                ? <img src={qrBase64} alt="QR Code" style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 10 }} />
                : <span style={{ color: '#bbb', fontSize: 13 }}>QR indisponível</span>
              }
            </div>
            <p style={{ color: '#666', fontSize: 13, marginBottom: 8 }}>
              Abra o WhatsApp → <strong>Configurações → Dispositivos conectados → Conectar dispositivo</strong>
            </p>
            <p style={{ color: '#999', fontSize: 12 }}>QR atualiza automaticamente a cada 30s</p>
          </div>
        )}
      </Modal>

      {/* Enviar link modal — gera link seguro e envia por e-mail */}
      <Modal
        title={`Enviar link de conexão — ${linkBusiness?.name ?? ''}`}
        open={linkOpen}
        onCancel={() => { setLinkOpen(false); setLinkResult(null); }}
        footer={linkResult ? [<Button key="close" type="primary" onClick={() => { setLinkOpen(false); setLinkResult(null); }}>Fechar</Button>] : null}
        width={480}
      >
        {linkResult ? (
          <div>
            <Result status="success" title="E-mail enviado!" subTitle="O link de conexão foi enviado para o destinatário." />
            <p style={{ fontSize: 12, color: '#999', wordBreak: 'break-all', textAlign: 'center' }}>
              Link (válido 24h): <a href={linkResult} target="_blank" rel="noreferrer">{linkResult}</a>
            </p>
          </div>
        ) : (
          <>
            <p style={{ marginBottom: 16, color: '#666' }}>
              Gera um link seguro com QR code e envia por e-mail. O link expira em <strong>24 horas</strong>.
            </p>
            <Form form={linkForm} layout="vertical" onFinish={vals => linkBusiness && sendLink.mutate({ id: linkBusiness._id, email: vals.email })}>
              <Form.Item name="email" label="E-mail do destinatário" rules={[{ required: true, type: 'email', message: 'E-mail inválido' }]}>
                <Input placeholder="cliente@exemplo.com" />
              </Form.Item>
              <Form.Item style={{ marginBottom: 0 }}>
                <Button type="primary" htmlType="submit" loading={sendLink.isPending} block>
                  Enviar link por e-mail
                </Button>
              </Form.Item>
            </Form>
          </>
        )}
      </Modal>
    </>
  );
}
