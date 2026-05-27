import { useState, useMemo } from 'react';
import {
  Button, Table, Input, Select, Space, Popconfirm, Tabs,
  Typography, message, Tag, Modal, Form, Switch, InputNumber,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, CheckOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type {
  DeliveryRestaurant, DeliveryOrder, DeliverySettlement,
  Business, Persona,
} from '../lib/types';
import { JidSelect } from '../components/JidSelect';
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

  const { data: businesses = [] } = useQuery({
    queryKey: ['businesses'],
    queryFn: api.getBusinesses,
  });

  // businessId selecionado no form → instância para JidSelect
  const [selectedBizId, setSelectedBizId] = useState<string | undefined>();
  const selectedBiz = (businesses as Business[]).find(b => b._id === selectedBizId);
  const formInstance = selectedBiz?.instances?.[0] ?? '';

  const openAdd = () => {
    form.resetFields();
    setSelectedBizId(undefined);
    setAdding(true);
  };
  const openEdit = (r: DeliveryRestaurant) => {
    setSelectedBizId(r.businessId ?? undefined);
    form.setFieldsValue({
      name: r.name,
      businessId: r.businessId ?? undefined,
      commandJid: r.commandJid ?? r.commandGroupJid,
      commandIsGroup: r.commandIsGroup ?? (r.commandGroupJid?.endsWith('@g.us') ?? true),
      delivererGroupJid: r.delivererGroupJid,
      active: r.active,
    });
    setEditing(r);
  };
  const closeModal = () => {
    setAdding(false); setEditing(null); form.resetFields(); setSelectedBizId(undefined);
  };

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
    {
      title: 'Negócio', dataIndex: 'businessId', key: 'biz',
      render: (id: string | null) => {
        if (!id) return <Text type="secondary">—</Text>;
        const b = (businesses as Business[]).find(x => x._id === id);
        return b ? b.name : <code style={{ fontSize: 11 }}>{id}</code>;
      },
    },
    {
      title: 'Comandos (JID)', dataIndex: 'commandJid', key: 'cmdJid',
      render: (v: string, r: DeliveryRestaurant) => {
        const jid = v || r.commandGroupJid;
        const isGroup = r.commandIsGroup ?? jid?.endsWith('@g.us');
        return <span style={{ fontSize: 11 }}>{isGroup ? '👥' : '👤'} <code>{jid}</code></span>;
      },
    },
    {
      title: 'Entregadores (JID)', dataIndex: 'delivererGroupJid', key: 'dlvJid',
      render: (v: string) => <span style={{ fontSize: 11 }}>👥 <code>{v}</code></span>,
    },
    {
      title: 'Ativo', dataIndex: 'active', key: 'active',
      render: (v: boolean, r: DeliveryRestaurant) => (
        <Switch
          checked={v}
          size="small"
          onChange={checked => api.updateDeliveryRestaurant(r._id, { active: checked })
            .then(() => qc.invalidateQueries({ queryKey: ['delivery-restaurants'] }))
            .catch(e => message.error(String(e)))}
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
        <Text type="secondary">Vincule cada restaurante a um negócio e selecione os JIDs (grupo de comandos pode ser um contato individual).</Text>
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
        width={620}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="Nome do Restaurante" rules={[{ required: true }]}>
            <Input placeholder="Ex: Tsuki Ramen" />
          </Form.Item>
          <Form.Item
            name="businessId"
            label="Negócio (instância WhatsApp da LivraisonTotale)"
            rules={[{ required: true, message: 'Selecione o negócio dono da instância' }]}
            extra="Os JIDs abaixo são lidos da primeira instância deste negócio."
          >
            <Select
              placeholder="Selecione o negócio..."
              options={(businesses as Business[]).map(b => ({
                value: b._id,
                label: `${b.name} ${b.instances?.length ? `(${b.instances.join(', ')})` : '(sem instâncias)'}`,
              }))}
              onChange={v => setSelectedBizId(v)}
              showSearch
              filterOption={(input, option) => String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
            />
          </Form.Item>

          <Form.Item
            name="commandJid"
            label="Destino de Comandos (grupo OU contato individual)"
            rules={[{ required: true, message: 'Selecione o destino' }]}
            extra="Pode ser um grupo do restaurante ou o WhatsApp pessoal do dono."
          >
            <JidSelect
              businessId={selectedBizId ?? ''}
              instance={formInstance}
              type="any"
              placeholder={formInstance ? 'Buscar grupo ou contato...' : 'Selecione um negócio primeiro'}
              onChange={(jid, opt) => {
                form.setFieldsValue({ commandJid: jid, commandIsGroup: !!opt?.isGroup });
              }}
            />
          </Form.Item>
          <Form.Item name="commandIsGroup" hidden><Input /></Form.Item>

          <Form.Item
            name="delivererGroupJid"
            label="Grupo de Entregadores"
            rules={[{ required: true, message: 'Selecione o grupo dos entregadores' }]}
          >
            <JidSelect
              businessId={selectedBizId ?? ''}
              instance={formInstance}
              type="group"
              placeholder={formInstance ? 'Buscar grupo...' : 'Selecione um negócio primeiro'}
              onChange={jid => form.setFieldsValue({ delivererGroupJid: jid })}
            />
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
  const [editing, setEditing] = useState<DeliverySettlement | null>(null);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm();

  const params: Record<string, string> = { days };
  if (delivererSearch) params.delivererJid = delivererSearch;
  if (status) params.status = status;

  const { data, isLoading } = useQuery({
    queryKey: ['delivery-settlements', params],
    queryFn: () => api.getDeliverySettlements(params),
  });

  const { data: restaurants = [] } = useQuery({
    queryKey: ['delivery-restaurants'],
    queryFn: api.getDeliveryRestaurants,
  });

  const settlements: DeliverySettlement[] = data?.data ?? [];

  const markPaid = useMutation({
    mutationFn: (id: string) => api.updateDeliverySettlement(id, { status: 'liquidado' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['delivery-settlements'] }); message.success('Marcado como liquidado.'); },
    onError: (e: Error) => message.error(e.message),
  });

  const saveEdit = useMutation({
    mutationFn: (vals: Partial<DeliverySettlement>) =>
      editing ? api.updateDeliverySettlement(editing._id, vals) : api.createDeliverySettlement(vals),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['delivery-settlements'] });
      setEditing(null); setCreating(false); form.resetFields();
      message.success('Salvo!');
    },
    onError: (e: Error) => message.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteDeliverySettlement(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['delivery-settlements'] }); message.success('Removido.'); },
    onError: (e: Error) => message.error(e.message),
  });

  const openCreate = () => {
    form.resetFields();
    form.setFieldsValue({ type: 'debito', status: 'pendente' });
    setCreating(true);
  };
  const openEdit = (s: DeliverySettlement) => {
    form.setFieldsValue({
      delivererJid: s.delivererJid,
      delivererName: s.delivererName,
      restaurantId: s.restaurantId ?? undefined,
      orderRef: s.orderRef ?? '',
      type: s.type,
      amount: s.amount,
      description: s.description ?? '',
      status: s.status,
    });
    setEditing(s);
  };
  const closeModal = () => { setEditing(null); setCreating(false); form.resetFields(); };

  const submit = () => form.validateFields().then(vals => {
    // restaurantName = label do restaurante selecionado (se houver)
    const r = (restaurants as DeliveryRestaurant[]).find(x => x._id === vals.restaurantId);
    if (r) vals.restaurantName = r.name;
    saveEdit.mutate(vals);
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
      title: 'Ações', key: 'action', width: 200,
      render: (_: unknown, r: DeliverySettlement) => (
        <Space size="small">
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
          {r.status === 'pendente' && (
            <Popconfirm title="Marcar como liquidado?" onConfirm={() => markPaid.mutate(r._id)} okText="Sim" cancelText="Não">
              <Button size="small" icon={<CheckOutlined />} type="primary" ghost>Liquidar</Button>
            </Popconfirm>
          )}
          <Popconfirm title="Remover este lançamento?" onConfirm={() => remove.mutate(r._id)} okText="Sim" cancelText="Não">
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
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
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Novo Lançamento</Button>
      </Space>

      <Table
        rowKey="_id"
        dataSource={settlements}
        columns={cols}
        loading={isLoading}
        size="small"
        pagination={{ pageSize: 50 }}
      />

      <Modal
        title={editing ? 'Editar Lançamento' : 'Novo Lançamento'}
        open={!!editing || creating}
        onOk={submit}
        onCancel={closeModal}
        okText="Salvar"
        confirmLoading={saveEdit.isPending}
        width={560}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="delivererName" label="Nome do Entregador" rules={[{ required: true }]}>
            <Input placeholder="Ex: João" />
          </Form.Item>
          <Form.Item
            name="delivererJid"
            label="WhatsApp do Entregador (JID ou telefone)"
            rules={[{ required: true }]}
          >
            <Input placeholder="55119xxxxxxx@s.whatsapp.net ou 55119xxxxxxx" />
          </Form.Item>
          <Form.Item name="restaurantId" label="Restaurante (opcional)">
            <Select
              allowClear
              placeholder="Selecione..."
              options={(restaurants as DeliveryRestaurant[]).map(r => ({ value: r._id, label: r.name }))}
              showSearch
              filterOption={(input, option) => String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
            />
          </Form.Item>
          <Form.Item name="orderRef" label="Ref. Pedido (opcional)">
            <Input placeholder="LT-XXXXXX" />
          </Form.Item>
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="type" label="Tipo" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Select options={[
                { value: 'debito', label: 'Débito (entregador deve à LT)' },
                { value: 'credito', label: 'Crédito (LT deve ao entregador)' },
              ]} />
            </Form.Item>
            <Form.Item name="amount" label="Valor (R$)" rules={[{ required: true }]} style={{ flex: 1, marginLeft: 12 }}>
              <InputNumber min={0} step={0.01} style={{ width: '100%' }} />
            </Form.Item>
          </Space.Compact>
          <Form.Item name="description" label="Descrição">
            <Input.TextArea rows={2} />
          </Form.Item>
          {editing && (
            <Form.Item name="status" label="Status" rules={[{ required: true }]}>
              <Select options={[
                { value: 'pendente', label: 'Pendente' },
                { value: 'liquidado', label: 'Liquidado' },
              ]} />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
}

// ── Personas ──────────────────────────────────────────────────────────────────

function PersonasTab() {
  const qc = useQueryClient();
  const [businessId, setBusinessId] = useState<string | undefined>();
  const [editing, setEditing] = useState<Persona | null>(null);
  const [adding, setAdding] = useState(false);
  const [form] = Form.useForm();

  const { data: businesses = [] } = useQuery({
    queryKey: ['businesses'],
    queryFn: api.getBusinesses,
  });

  const { data: personasData, isLoading } = useQuery({
    queryKey: ['personas', businessId],
    queryFn: () => api.getPersonas(businessId!),
    enabled: !!businessId,
  });

  const personas: Persona[] = useMemo(() => personasData?.personas ?? [], [personasData]);

  const save = useMutation({
    mutationFn: (next: Persona[]) => api.updatePersonas(businessId!, next),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['personas', businessId] }); message.success('Salvo!'); setEditing(null); setAdding(false); form.resetFields(); },
    onError: (e: Error) => message.error(e.message),
  });

  const submit = () => form.validateFields().then((vals: Persona & { toolsCsv?: string }) => {
    const tools = (vals.toolsCsv ?? '').split(',').map(s => s.trim()).filter(Boolean);
    const next: Persona = { key: vals.key, label: vals.label, systemPrompt: vals.systemPrompt, tools };
    let updated: Persona[];
    if (editing) {
      updated = personas.map(p => p.key === editing.key ? next : p);
    } else {
      if (personas.some(p => p.key === next.key)) {
        message.error('Já existe uma persona com essa chave');
        return;
      }
      updated = [...personas, next];
    }
    save.mutate(updated);
  });

  const remove = (key: string) => save.mutate(personas.filter(p => p.key !== key));

  const openAdd = () => {
    form.resetFields();
    form.setFieldsValue({ key: '', label: '', systemPrompt: '', toolsCsv: '' });
    setAdding(true);
  };
  const openEdit = (p: Persona) => {
    form.setFieldsValue({ key: p.key, label: p.label, systemPrompt: p.systemPrompt, toolsCsv: p.tools.join(', ') });
    setEditing(p);
  };
  const closeModal = () => { setEditing(null); setAdding(false); form.resetFields(); };

  const cols = [
    { title: 'Chave', dataIndex: 'key', key: 'key', render: (v: string) => <code>{v}</code> },
    { title: 'Label', dataIndex: 'label', key: 'label' },
    {
      title: 'System Prompt', dataIndex: 'systemPrompt', key: 'sp', ellipsis: true,
      render: (v: string) => <Text type="secondary">{v.slice(0, 120)}{v.length > 120 ? '…' : ''}</Text>,
    },
    {
      title: 'Tools', dataIndex: 'tools', key: 'tools',
      render: (t: string[]) => t.length ? t.map(x => <Tag key={x}>{x}</Tag>) : <Text type="secondary">—</Text>,
    },
    {
      title: 'Ações', key: 'actions',
      render: (_: unknown, p: Persona) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(p)} />
          <Popconfirm title="Remover persona?" onConfirm={() => remove(p.key)} okText="Sim" cancelText="Não">
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Text strong>Negócio:</Text>
        <Select
          placeholder="Selecione um negócio..."
          style={{ width: 320 }}
          value={businessId}
          onChange={setBusinessId}
          options={(businesses as Business[]).map(b => ({ value: b._id, label: b.name }))}
          showSearch
          filterOption={(input, option) => String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
        />
        {businessId && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>Nova Persona</Button>
        )}
      </Space>

      {businessId ? (
        <>
          <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
            Personas são prompts/tools que sobrescrevem o agente padrão quando uma mensagem chega de um JID com rota configurada (cf. delivery_*). A chave <code>restaurant</code> é usada por grupos/contatos de comandos; <code>deliverer</code>, por grupos de entregadores.
          </Text>
          <Table
            rowKey="key"
            dataSource={personas}
            columns={cols}
            loading={isLoading}
            size="small"
            pagination={false}
          />
        </>
      ) : (
        <Text type="secondary">Selecione um negócio para gerenciar suas personas.</Text>
      )}

      <Modal
        title={editing ? 'Editar Persona' : 'Nova Persona'}
        open={!!editing || adding}
        onOk={submit}
        onCancel={closeModal}
        okText="Salvar"
        confirmLoading={save.isPending}
        width={680}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item
            name="key"
            label="Chave (slug)"
            rules={[{ required: true, pattern: /^[a-z0-9_-]+$/, message: 'use a-z, 0-9, _ ou -' }]}
            extra="Ex: restaurant, deliverer, support"
          >
            <Input disabled={!!editing} placeholder="restaurant" />
          </Form.Item>
          <Form.Item name="label" label="Label" rules={[{ required: true }]}>
            <Input placeholder="Restaurante (grupo de comandos)" />
          </Form.Item>
          <Form.Item
            name="systemPrompt"
            label="System Prompt"
            rules={[{ required: true }]}
            extra="Substitui o prompt do agente padrão quando esta persona é resolvida."
          >
            <Input.TextArea rows={8} placeholder="Você é o canal de comunicação entre a LivraisonTotale e o restaurante..." />
          </Form.Item>
          <Form.Item
            name="toolsCsv"
            label="Tools permitidas (CSV, opcional)"
            extra="Lista separada por vírgula. Deixe em branco para usar todas as tools do agente padrão."
          >
            <Input placeholder="delivery_update_order_status, delivery_post_to_command_group" />
          </Form.Item>
        </Form>
      </Modal>
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
          { key: 'personas',    label: 'Personas',      children: <PersonasTab /> },
        ]}
      />
    </div>
  );
}
