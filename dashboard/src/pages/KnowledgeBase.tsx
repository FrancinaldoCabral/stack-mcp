import { useState } from 'react';
import {
  Button, Table, Modal, Form, Input, Select, Space,
  Popconfirm, Tag, Typography, message,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Business, KnowledgePoint } from '../lib/types';
import dayjs from 'dayjs';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

const CATEGORIES = [
  { value: 'business_info', label: 'Informações do negócio' },
  { value: 'product', label: 'Produto / Serviço' },
  { value: 'faq', label: 'FAQ' },
  { value: 'objective_flow', label: 'Fluxo de objetivo' },
  { value: 'customer_profile', label: 'Perfil de cliente' },
  { value: 'general', label: 'Geral' },
];

export default function KnowledgeBase() {
  const qc = useQueryClient();
  const [bizFilter, setBizFilter] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<KnowledgePoint | null>(null);
  const [preview, setPreview] = useState<KnowledgePoint | null>(null);

  const params: Record<string, string> = {};
  if (bizFilter) params.businessId = bizFilter;
  if (catFilter) params.category = catFilter;

  const { data, isLoading } = useQuery({
    queryKey: ['knowledge', params],
    queryFn: () => api.getKnowledge(params),
  });

  const { data: businesses = [] } = useQuery({ queryKey: ['businesses'], queryFn: api.getBusinesses });

  const create = useMutation({
    mutationFn: (vals: { title: string; text: string; category: string; businessId: string }) =>
      api.createKnowledge(vals),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['knowledge'] }); setOpen(false); message.success('Item criado!'); },
    onError: (e: Error) => message.error(e.message),
  });

  const update = useMutation({
    mutationFn: (vals: { title?: string; text?: string; category?: string }) =>
      api.updateKnowledge(editing!.id, vals),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['knowledge'] }); setOpen(false); message.success('Atualizado!'); },
    onError: (e: Error) => message.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.deleteKnowledge(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['knowledge'] }); message.success('Removido.'); },
    onError: (e: Error) => message.error(e.message),
  });

  const openCreate = () => {
    form.resetFields();
    form.setFieldValue('businessId', bizFilter || undefined);
    setEditing(null);
    setOpen(true);
  };

  const openEdit = (kp: KnowledgePoint) => {
    form.setFieldsValue({ title: kp.payload.title, text: kp.payload.text, category: kp.payload.category, businessId: kp.payload.businessId });
    setEditing(kp);
    setOpen(true);
  };

  const handleSubmit = () => {
    form.validateFields().then(vals => {
      if (editing) update.mutate(vals);
      else create.mutate(vals);
    });
  };

  const bizMap = Object.fromEntries((businesses as Business[]).map(b => [b._id, b.name]));
  const catMap = Object.fromEntries(CATEGORIES.map(c => [c.value, c.label]));

  const cols = [
    { title: 'Título', dataIndex: ['payload', 'title'], key: 'title', width: 200 },
    {
      title: 'Conteúdo', dataIndex: ['payload', 'text'], key: 'text',
      render: (t: string) => <Text style={{ fontSize: 12 }}>{t.length > 120 ? t.slice(0, 120) + '…' : t}</Text>,
    },
    { title: 'Categoria', dataIndex: ['payload', 'category'], key: 'cat',
      render: (c: string) => <Tag>{catMap[c] ?? c}</Tag> },
    { title: 'Negócio', dataIndex: ['payload', 'businessId'], key: 'biz',
      render: (id: string) => bizMap[id] || id },
    { title: 'Criado', dataIndex: ['payload', 'createdAt'], key: 'created',
      render: (d: string) => d ? dayjs(d).format('DD/MM/YY') : '—' },
    {
      title: 'Ações', key: 'actions',
      render: (_: unknown, kp: KnowledgePoint) => (
        <Space>
          <Button size="small" onClick={() => setPreview(kp)}>Ver</Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(kp)}>Editar</Button>
          <Popconfirm title="Remover item?" onConfirm={() => remove.mutate(kp.id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>Remover</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>Base de Conhecimento</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Novo item</Button>
      </div>

      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          placeholder="Filtrar por negócio"
          value={bizFilter || undefined}
          onChange={v => setBizFilter(v ?? '')}
          allowClear
          style={{ width: 200 }}
          options={(businesses as Business[]).map(b => ({ value: b._id, label: b.name }))}
        />
        <Select
          placeholder="Filtrar por categoria"
          value={catFilter || undefined}
          onChange={v => setCatFilter(v ?? '')}
          allowClear
          style={{ width: 220 }}
          options={CATEGORIES}
        />
      </Space>

      <Table
        rowKey="id"
        dataSource={data?.data ?? []}
        columns={cols}
        loading={isLoading}
        pagination={{ pageSize: 20 }}
      />

      <Modal
        title={editing ? 'Editar item' : 'Novo item de conhecimento'}
        open={open}
        onOk={handleSubmit}
        onCancel={() => setOpen(false)}
        confirmLoading={create.isPending || update.isPending}
        width={600}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="businessId" label="Negócio" rules={[{ required: true }]}>
            <Select options={(businesses as Business[]).map(b => ({ value: b._id, label: b.name }))} disabled={!!editing} />
          </Form.Item>
          <Form.Item name="title" label="Título" rules={[{ required: true }]}>
            <Input placeholder="Ex: Horário de funcionamento" />
          </Form.Item>
          <Form.Item name="category" label="Categoria">
            <Select options={CATEGORIES} defaultValue="general" />
          </Form.Item>
          <Form.Item name="text" label="Conteúdo" rules={[{ required: true }]}>
            <TextArea rows={5} placeholder="Texto que será indexado e buscado pelo agente..." />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={preview?.payload.title}
        open={!!preview}
        onCancel={() => setPreview(null)}
        footer={null}
      >
        {preview && (
          <>
            <Tag style={{ marginBottom: 8 }}>{catMap[preview.payload.category] ?? preview.payload.category}</Tag>
            <Paragraph style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{preview.payload.text}</Paragraph>
          </>
        )}
      </Modal>
    </>
  );
}
