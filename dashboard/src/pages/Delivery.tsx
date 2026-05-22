import { useState } from 'react';
import {
  Button, Table, Input, Select, Space, Popconfirm, Tabs,
  Typography, message, Tag, Modal, Form, Switch,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, CheckOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { DeliveryRestaurant, DeliveryOrder, DeliverySettlement } from '../lib/types';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

const ORDER_STATUS: Record<string, { color: string; label: string }> = {
  pendente:       { color: 'orange',   label: 'Pendente' },
  atribuido:      { color: 'blue',     label: 'Atribuído' },
  a_caminho:      { color: 'geekblue', label: 'A Caminho' },
  no_restaurante: { color: 'purple',   label: 'No Restaurante' },
  saindo:         { color: 'cyan',     label: 'Saindo' },
  no_cliente:     { color: 'gold',     label: 'No Cliente' },
  entregue:       { color: 'green',    label: 'Entregue' },
  problema:       { color: 'red',      label: 'Problema' },
};

const SETTLEMENT_STATUS: Record<string, { color: string; label: string }> = {
  pendente:  { color: 'orange', label: 'Pendente' },
  liquidado: { color: 'green',  label: 'Liquidado' },
};

const DAYS_OPTIONS = [
  { value: '7',  label: 'Últimos 7 dias' },
  { value: '14', label: 'Últimos 14 dias' },
  { value: '30', label: 'Últimos 30 dias' },
  { value: '90', label: 'Últimos 90 dias' },
];

// ── Restaurantes ──────────────────────────────────────────────────────────────

function RestaurantsTab() {
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [editing, setEditing] = useState<DeliveryRestaurant | null>(null);
  const [adding, setAdding] = useState(false);

  const { data: restaurants = [], isLoading } = useQuery({
    queryKey: ['delivery-restaurants'],
    queryFn: api.getDeliveryRestaurants,
  });

  const openAdd = () => { form.resetFields(); setAdding(true); };
  const openEdit = (r: DeliveryRestaurant) => {
    form.setFieldsValue({
      name: r.name, instance: r.instance,
      commandGroupJid: r.commandGroupJid,
      delivererGroupJid: r.delivererGroupJid,
      active: r.active,
    });
    setEditing(r);
  };
  const closeModal = () => { setAdding(false); setEditing(null); form.resetFields(); };

  const create = useMutation({
    mutationFn: (vals: Partial<DeliveryRestaurant>) => api.createDeliveryRestaurant(vals),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['delivery-restaurants'] }); closeModal(); message.success('Restaurante criado!'); },
    onError: (e: Error) => message.error(e.message),
  });

  const update = useMutation({
    mutationFn: (vals: Partial<DeliveryRestaurant>) => api.updateDeliveryRestaurant(editing!._id, vals),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['delivery-restaurants'] }); closeModal(); message.success('Salvo!'); },
    onError: (e: Error) => message.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteDeliveryRestaurant(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['delivery-restaurants'] }); message.success('Removido.'); },
    onError: (e: Error) => message.error(e.message),
  });

  const submit = () => form.validateFields().then(vals => editing ? update.mutate(vals) : create.mutate(vals));

  const cols = [
    { title: 'Nome', dataIndex: 'name', key: 'name', sorter: (a: DeliveryRestaurant, b: DeliveryRestaurant) => a.name.localeCompare(b.name) },
    { title: 'Instância', dataIndex: 'instance', key: 'instance', render: (v: string) => v || <Text type="secondary">—</Text> },
    {
      title: 'JID Grupo Comandos', dataIndex: 'commandGroupJid', key: 'cmdJid',
      render: (v: string) => <code style={{ fontSize: 11 }}>{v}</code>,
    },
    {
      title: 'JID Grupo Entregadores', dataIndex: 'delivererGroupJid', key: 'dlvJid',
      render: (v: string) => <code style={{ fontSize: 11 }}>{v}</code>,
    },
    {
      title: 'Ativo', dataIndex: 'active', key: 'active',
      render: (v: boolean, r: DeliveryRestaurant) => (
        <Switch
          checked={v}
          size="small"
          onChange={checked => update.mutate({ ...r, active: checked })}
        />
      ),
    },
    {
      title: 'Ações', key: 'actions',
      render: (_: unknown, r: DeliveryRestaurant) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>Editar</Button>
          <Popconfirm title="Remover restaurante?" onConfirm={() => remove.mutate(r._id)} okText="Sim" cancelText="Não">
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text type="secondary">Registre cada restaurante com os JIDs dos seus grupos no WhatsApp.</Text>
        <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>Adicionar Restaurante</Button>
      </div>

      <Table
        rowKey="_id"
        dataSource={restaurants as DeliveryRestaurant[]}
        columns={cols}
        loading={isLoading}
        size="small"
        pagination={false}
      />

      <Modal
        title={editing ? 'Editar Restaurante' : 'Novo Restaurante'}
        open={adding || !!editing}
        onOk={submit}
        onCancel={closeModal}
        okText="Salvar"
        confirmLoading={create.isPending || update.isPending}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="Nome do Restaurante" rules={[{ required: true }]}>
            <Input placeholder="Ex: Tsuki Ramen" />
          </Form.Item>
          <Form.Item name="instance" label="Instância WhatsApp">
            <Input placeholder="Ex: suporte-redatudo" />
          </Form.Item>
          <Form.Item
            name="commandGroupJid"
            label="JID do Grupo de Comandos"
            rules={[{ required: true }]}
            extra="Cole o JID do grupo onde o restaurante posta pedidos. Ex: 120363xxxxxx@g.us"
          >
            <Input placeholder="120363xxxxxx@g.us" />
          </Form.Item>
          <Form.Item
            name="delivererGroupJid"
            label="JID do Grupo de Entregadores"
            rules={[{ required: true }]}
            extra="Cole o JID do grupo dos entregadores deste restaurante."
          >
            <Input placeholder="120363yyyyyy@g.us" />
          </Form.Item>
          {editing && (
            <Form.Item name="active" label="Ativo" valuePropName="checked">
              <Switch />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
}

// ── Pedidos ───────────────────────────────────────────────────────────────────

function OrdersTab() {
  const [restaurantId, setRestaurantId] = useState('');
  const [status, setStatus] = useState('');
  const [days, setDays] = useState('30');

  const { data: restaurants = [] } = useQuery({
    queryKey: ['delivery-restaurants'],
    queryFn: api.getDeliveryRestaurants,
  });

  const params: Record<string, string> = { days };
  if (restaurantId) params.restaurantId = restaurantId;
  if (status) params.status = status;

  const { data, isLoading } = useQuery({
    queryKey: ['delivery-orders', params],
    queryFn: () => api.getDeliveryOrders(params),
  });

  const orders: DeliveryOrder[] = data?.data ?? [];

  const cols = [
    {
      title: '#', dataIndex: 'orderNumber', key: 'num', width: 60,
      render: (n: number) => n ? <strong>#{n}</strong> : <Text type="secondary">—</Text>,
    },
    { title: 'Restaurante', dataIndex: 'restaurantName', key: 'rst' },
    { title: 'Cliente', dataIndex: 'clientName', key: 'cli', render: (v: string) => v || <Text type="secondary">—</Text> },
    { title: 'Endereço', dataIndex: 'clientAddress', key: 'addr', render: (v: string) => v || <Text type="secondary">—</Text> },
    { title: 'Itens', dataIndex: 'items', key: 'items', ellipsis: true, render: (v: string) => v || <Text type="secondary">—</Text> },
    {
      title: 'Valor', dataIndex: 'value', key: 'val',
      render: (v: number) => v != null ? `R$ ${Number(v).toFixed(2)}` : <Text type="secondary">—</Text>,
    },
    { title: 'Entregador', dataIndex: 'delivererName', key: 'dlv', render: (v: string) => v || <Text type="secondary">—</Text> },
    {
      title: 'Status', dataIndex: 'status', key: 'status',
      render: (s: string) => {
        const cfg = ORDER_STATUS[s] ?? { color: 'default', label: s };
        return <Tag color={cfg.color}>{cfg.label}</Tag>;
      },
    },
    {
      title: 'Acerto', dataIndex: 'settlement', key: 'settlement',
      render: (s: string) => {
        if (!s || s === 'pendente') return <Tag color="orange">Pendente</Tag>;
        if (s === 'acertado') return <Tag color="green">Acertado</Tag>;
        return <Tag color="red">Sem Acertar</Tag>;
      },
    },
    {
      title: 'Data', dataIndex: 'createdAt', key: 'date',
      render: (d: string) => d ? dayjs(d).format('DD/MM HH:mm') : '—',
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          placeholder="Todos restaurantes"
          allowClear
          style={{ width: 200 }}
          value={restaurantId || undefined}
          onChange={v => setRestaurantId(v ?? '')}
          options={(restaurants as DeliveryRestaurant[]).map(r => ({ value: r._id, label: r.name }))}
        />
        <Select
          placeholder="Todos status"
          allowClear
          style={{ width: 160 }}
          value={status || undefined}
          onChange={v => setStatus(v ?? '')}
          options={Object.entries(ORDER_STATUS).map(([k, v]) => ({ value: k, label: v.label }))}
        />
        <Select
          value={days}
          onChange={setDays}
          style={{ width: 160 }}
          options={DAYS_OPTIONS}
        />
        <Text type="secondary">{data?.total ?? 0} pedidos</Text>
      </Space>

      <Table
        rowKey="_id"
        dataSource={orders}
        columns={cols}
        loading={isLoading}
        size="small"
        scroll={{ x: 900 }}
        pagination={{ pageSize: 50 }}
      />
    </div>
  );
}

// ── Acertos ───────────────────────────────────────────────────────────────────

function SettlementsTab() {
  const qc = useQueryClient();
  const [delivererSearch, setDelivererSearch] = useState('');
  const [status, setStatus] = useState('');
  const [days, setDays] = useState('30');

  const params: Record<string, string> = { days };
  if (delivererSearch) params.delivererJid = delivererSearch;
  if (status) params.status = status;

  const { data, isLoading } = useQuery({
    queryKey: ['delivery-settlements', params],
    queryFn: () => api.getDeliverySettlements(params),
  });

  const settlements: DeliverySettlement[] = data?.data ?? [];

  const markPaid = useMutation({
    mutationFn: (id: string) => api.updateDeliverySettlement(id, { status: 'liquidado' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['delivery-settlements'] }); message.success('Marcado como liquidado.'); },
    onError: (e: Error) => message.error(e.message),
  });

  // Resumo: saldo pendente por entregador
  const pendingByDeliverer = settlements
    .filter(s => s.status === 'pendente')
    .reduce<Record<string, { name: string; balance: number }>>(
      (acc, s) => {
        const key = s.delivererJid;
        if (!acc[key]) acc[key] = { name: s.delivererName, balance: 0 };
        acc[key].balance += s.type === 'debito' ? -s.amount : s.amount;
        return acc;
      },
      {}
    );

  const summaryRows = Object.entries(pendingByDeliverer)
    .filter(([, v]) => v.balance !== 0)
    .sort((a, b) => a[1].name.localeCompare(b[1].name));

  const cols = [
    {
      title: 'Data', dataIndex: 'date', key: 'date', width: 120,
      render: (d: string) => d ? dayjs(d).format('DD/MM/YY HH:mm') : '—',
    },
    { title: 'Entregador', dataIndex: 'delivererName', key: 'dlv' },
    { title: 'Restaurante', dataIndex: 'restaurantName', key: 'rst', render: (v: string) => v || <Text type="secondary">—</Text> },
    { title: 'Pedido', dataIndex: 'orderRef', key: 'orderRef', render: (v: string) => v ? <code>#{v}</code> : <Text type="secondary">—</Text> },
    { title: 'Descrição', dataIndex: 'description', key: 'desc', ellipsis: true },
    {
      title: 'Tipo', dataIndex: 'type', key: 'type', width: 90,
      render: (t: string) => t === 'debito'
        ? <Tag color="red">Débito</Tag>
        : <Tag color="green">Crédito</Tag>,
    },
    {
      title: 'Valor', dataIndex: 'amount', key: 'amount', width: 100,
      render: (v: number, r: DeliverySettlement) => (
        <span style={{ color: r.type === 'debito' ? '#cf1322' : '#389e0d', fontWeight: 600 }}>
          R$ {Number(v).toFixed(2)}
        </span>
      ),
    },
    {
      title: 'Status', dataIndex: 'status', key: 'status', width: 110,
      render: (s: string) => {
        const cfg = SETTLEMENT_STATUS[s] ?? { color: 'default', label: s };
        return <Tag color={cfg.color}>{cfg.label}</Tag>;
      },
    },
    {
      title: 'Ação', key: 'action', width: 110,
      render: (_: unknown, r: DeliverySettlement) =>
        r.status === 'pendente' ? (
          <Popconfirm title="Marcar como liquidado?" onConfirm={() => markPaid.mutate(r._id)} okText="Sim" cancelText="Não">
            <Button size="small" icon={<CheckOutlined />} type="primary" ghost>Liquidar</Button>
          </Popconfirm>
        ) : null,
    },
  ];

  return (
    <div>
      {summaryRows.length > 0 && (
        <div style={{ background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 6, padding: '10px 16px', marginBottom: 16 }}>
          <Text strong>Saldos pendentes: </Text>
          <Space wrap style={{ marginTop: 4 }}>
            {summaryRows.map(([jid, { name, balance }]) => (
              <Tag key={jid} color={balance > 0 ? 'green' : 'red'}>
                {name}: {balance > 0 ? '+' : ''}R$ {balance.toFixed(2)}
              </Tag>
            ))}
          </Space>
        </div>
      )}

      <Space style={{ marginBottom: 16 }} wrap>
        <Input
          placeholder="Buscar entregador..."
          allowClear
          style={{ width: 200 }}
          value={delivererSearch}
          onChange={e => setDelivererSearch(e.target.value)}
        />
        <Select
          placeholder="Todos status"
          allowClear
          style={{ width: 140 }}
          value={status || undefined}
          onChange={v => setStatus(v ?? '')}
          options={[
            { value: 'pendente',  label: 'Pendente' },
            { value: 'liquidado', label: 'Liquidado' },
          ]}
        />
        <Select
          value={days}
          onChange={setDays}
          style={{ width: 160 }}
          options={DAYS_OPTIONS}
        />
        <Text type="secondary">{data?.total ?? 0} registros</Text>
      </Space>

      <Table
        rowKey="_id"
        dataSource={settlements}
        columns={cols}
        loading={isLoading}
        size="small"
        pagination={{ pageSize: 50 }}
      />
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────

export default function Delivery() {
  return (
    <div>
      <Title level={3}>🛵 Delivery</Title>
      <Tabs
        defaultActiveKey="restaurants"
        items={[
          { key: 'restaurants', label: 'Restaurantes',  children: <RestaurantsTab /> },
          { key: 'orders',      label: 'Pedidos',       children: <OrdersTab /> },
          { key: 'settlements', label: 'Acertos',       children: <SettlementsTab /> },
        ]}
      />
    </div>
  );
}
