import { useState, useEffect, useRef } from 'react';
import { Button, Table, Modal, Form, Input, Space, Typography, message, Spin, Result } from 'antd';
import { PlusOutlined, EditOutlined, MessageOutlined, DeleteOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Business } from '../lib/types';

const { Title } = Typography;

export default function Businesses() {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({ queryKey: ['businesses'], queryFn: api.getBusinesses });
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
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrConnected, setQrConnected] = useState(false);
  const qrRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const qrStatusRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
      if (connectAfterRef.current) {
        openQrModal(updated as Business);
      } else {
        message.success('Número adicionado!');
      }
    },
    onError: (e: Error) => message.error(e.message),
  });

  // ── QR helpers ───────────────────────────────────────────────────────────────

  const fetchQr = async (id: string) => {
    setQrLoading(true);
    setQrBase64(null);
    try {
      const d = await api.getBusinessQr(id);
      setQrBase64(d.base64);
    } catch { /* ignore */ }
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
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(b)}>
            Editar
          </Button>
          <Button size="small" icon={<PlusOutlined />} onClick={() => openAddInstance(b)}>
            + WhatsApp
          </Button>
          {b.chatwootInboxId && (
            <Button
              size="small"
              icon={<MessageOutlined />}
              href={`https://chatwoot.vendly.chat/app/accounts/1/inbox/${b.chatwootInboxId}`}
              target="_blank"
            >
              Caixa de entrada
            </Button>
          )}
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => { setDeleteTarget(b); setDeleteInput(''); }}
          >
            Excluir
          </Button>
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
        title="Conectar WhatsApp"
        open={qrOpen}
        onCancel={closeQrModal}
        footer={qrConnected ? null : [
          <Button key="refresh" onClick={() => qrBusiness && fetchQr(qrBusiness._id)} loading={qrLoading}>
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
    </>
  );
}
