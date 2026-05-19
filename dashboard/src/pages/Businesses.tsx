import { useState } from 'react';
import {
  Button, Table, Modal, Form, Input, Select, Space,
  Popconfirm, Tag, Typography, message,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Business } from '../lib/types';

const { Title } = Typography;
const { TextArea } = Input;

export default function Businesses() {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({ queryKey: ['businesses'], queryFn: api.getBusinesses });
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Business | null>(null);

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

  const openCreate = () => { form.resetFields(); setEditing(null); setOpen(true); };
  const openEdit = (b: Business) => {
    form.setFieldsValue({ ...b, instances: b.instances?.join(', ') });
    setEditing(b);
    setOpen(true);
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

  const cols = [
    { title: 'Nome', dataIndex: 'name', key: 'name' },
    { title: 'Instâncias', dataIndex: 'instances', key: 'instances',
      render: (insts: string[]) => insts?.map(i => <Tag key={i}>{i}</Tag>) },
    { title: 'Assistente', dataIndex: 'assistantName', key: 'assistantName' },
    { title: 'Modelo', key: 'model', render: (_: unknown, b: Business) => <code style={{ fontSize: 11 }}>{b.settings?.model ?? '-'}</code> },
    {
      title: 'Ações', key: 'actions',
      render: (_: unknown, b: Business) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(b)}>Editar</Button>
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
    </>
  );
}
