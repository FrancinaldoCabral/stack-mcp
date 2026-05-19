import { useState } from 'react';
import {
  Button, Table, Input, Select, Space, Popconfirm,
  Typography, message, Tag, Modal, Form,
} from 'antd';
import { EditOutlined, DeleteOutlined, SearchOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Business, Customer } from '../lib/types';
import dayjs from 'dayjs';

const { Title, Text } = Typography;
const { TextArea } = Input;

export default function Customers() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [bizFilter, setBizFilter] = useState('');
  const [page, setPage] = useState(0);
  const [form] = Form.useForm();
  const [editing, setEditing] = useState<Customer | null>(null);

  const params: Record<string, string> = { page: String(page), limit: '50' };
  if (search) params.search = search;
  if (bizFilter) params.businessId = bizFilter;

  const { data, isLoading } = useQuery({
    queryKey: ['customers', params],
    queryFn: () => api.getCustomers(params),
  });

  const { data: businesses = [] } = useQuery({ queryKey: ['businesses'], queryFn: api.getBusinesses });

  const save = useMutation({
    mutationFn: (vals: Partial<Customer>) => api.updateCustomer(editing!._id, vals),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['customers'] }); setEditing(null); message.success('Salvo!'); },
    onError: (e: Error) => message.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteCustomer(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['customers'] }); message.success('Removido.'); },
    onError: (e: Error) => message.error(e.message),
  });

  const bizMap = Object.fromEntries((businesses as Business[]).map(b => [b._id, b.name]));

  const cols = [
    { title: 'Telefone', dataIndex: 'phone', key: 'phone', render: (p: string) => <code>{p}</code> },
    { title: 'Nome', dataIndex: 'name', key: 'name', render: (n: string) => n || <Text type="secondary">—</Text> },
    { title: 'Negócio', dataIndex: 'businessId', key: 'biz', render: (id: string) => bizMap[id] || <Tag>{id}</Tag> },
    { title: 'Conversas', dataIndex: 'conversation_count', key: 'cnt', render: (n: number) => n ?? 0 },
    { title: 'Último acesso', dataIndex: 'last_seen', key: 'ls', render: (d: string) => d ? dayjs(d).format('DD/MM/YY HH:mm') : '—' },
    {
      title: 'Ações', key: 'actions',
      render: (_: unknown, c: Customer) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => { form.setFieldsValue({ name: c.name, notes: c.profile?.notes }); setEditing(c); }}>
            Editar
          </Button>
          <Popconfirm title="Remover cliente?" onConfirm={() => remove.mutate(c._id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>Remover</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>Clientes</Title>
      </div>

      <Space style={{ marginBottom: 16 }} wrap>
        <Input
          prefix={<SearchOutlined />}
          placeholder="Buscar nome ou telefone"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(0); }}
          style={{ width: 220 }}
          allowClear
        />
        <Select
          placeholder="Filtrar por negócio"
          value={bizFilter || undefined}
          onChange={v => { setBizFilter(v ?? ''); setPage(0); }}
          allowClear
          style={{ width: 200 }}
          options={(businesses as Business[]).map(b => ({ value: b._id, label: b.name }))}
        />
      </Space>

      <Table
        rowKey="_id"
        dataSource={data?.data ?? []}
        columns={cols}
        loading={isLoading}
        pagination={{ total: data?.total, pageSize: 50, current: page + 1, onChange: p => setPage(p - 1), showTotal: t => `${t} clientes` }}
      />

      <Modal
        title="Editar cliente"
        open={!!editing}
        onOk={() => form.validateFields().then(vals => save.mutate({ name: vals.name, profile: { notes: vals.notes } }))}
        onCancel={() => setEditing(null)}
        confirmLoading={save.isPending}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="name" label="Nome">
            <Input placeholder="Nome do cliente" />
          </Form.Item>
          <Form.Item name="notes" label="Notas internas">
            <TextArea rows={3} placeholder="Observações sobre o cliente..." />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
