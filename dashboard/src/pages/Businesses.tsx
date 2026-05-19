import { useState } from 'react';
import {
  Button, Table, Modal, Form, Input, Select, Space,
  Popconfirm, Tag, Typography, message, Tooltip, Badge,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, LinkOutlined, ToolOutlined } from '@ant-design/icons';
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

  const save = useMutation({
    mutationFn: (values: Partial<Business>) =>
      editing ? api.updateBusiness(editing._id, values) : api.createBusiness(values),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['businesses'] }); setOpen(false); message.success('Salvo!'); },
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['businesses'] });
      setProvisionOpen(false);
      message.success('Provisionado! Instância Evolution e inbox Chatwoot criados.');
    },
    onError: (e: Error) => message.error(e.message),
  });

  const openCreate = () => { form.resetFields(); setEditing(null); setOpen(true); };
  const openEdit = (b: Business) => {
    form.setFieldsValue({ ...b, instances: b.instances?.join(', ') });
    setEditing(b);
    setOpen(true);
  };
  const openProvision = (b: Business) => {
    provisionForm.resetFields();
    setProvisionTarget(b);
    setProvisionOpen(true);
  };

  const handleSubmit = () => {
    form.validateFields().then(vals => {
      const payload = {
        ...vals,
        instances: String(vals.instances ?? '').split(',').map((s: string) => s.trim()).filter(Boolean),
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
            ? <Tooltip title={`Inbox ${b.chatwootInboxId}`}>
                <Button size="small" icon={<LinkOutlined />}
                  href="https://chatwoot.vendly.chat" target="_blank">Chatwoot</Button>
              </Tooltip>
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
        width={600}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="name" label="Nome" rules={[{ required: true }]}>
            <Input placeholder="Ex: Loja da Maria" />
          </Form.Item>
          <Form.Item name="instances" label="Instâncias Evolution (separadas por vírgula)">
            <Input placeholder="Ex: loja-maria, loja-maria-vendas" />
          </Form.Item>
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
    </>
  );
}
