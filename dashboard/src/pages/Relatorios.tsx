import { useState } from 'react';
import {
  Button, Select, Space, Table, Typography, Tag, DatePicker,
  Statistic, Card, Row, Col, Tabs, Divider, Spin, Empty,
} from 'antd';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type {
  DeliveryRestaurant, RestaurantReport, DelivererReport,
  RestaurantReportOrder, DelivererReportOrder,
  SummaryReport, SummaryReportRestaurant, SummaryReportDeliverer,
} from '../lib/types';
import dayjs from 'dayjs';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

const eur = (v: number | null | undefined) =>
  v != null ? `€${Number(v).toFixed(2)}` : '—';

// ── Relatório Geral (Summary) ────────────────────────────────────────────────

function SummaryTab() {
  const [range, setRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>([
    dayjs().subtract(29, 'day').startOf('day'),
    dayjs().endOf('day'),
  ]);
  const [enabled, setEnabled] = useState(true);

  const params = {
    from: range ? range[0].format('YYYY-MM-DD') : '',
    to: range ? range[1].format('YYYY-MM-DD') : '',
  };

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['report-summary', params],
    queryFn: () => api.getSummaryReport(params),
    enabled,
  });

  const restaurantCols = [
    { title: 'Restaurante', dataIndex: 'restaurantName', key: 'name', ellipsis: true },
    { title: 'Pedidos', dataIndex: 'orderCount', key: 'cnt', width: 70, align: 'right' as const },
    { title: 'Valor total', dataIndex: 'totalOrderValue', key: 'val', width: 100, align: 'right' as const,
      render: (v: number) => eur(v) },
    { title: 'Entregas LT', dataIndex: 'totalDeliveryFees', key: 'fees', width: 100, align: 'right' as const,
      render: (v: number) => <Text strong style={{ color: '#1677ff' }}>{eur(v)}</Text> },
    { title: 'Acertos', dataIndex: 'totalSettlements', key: 'sett', width: 90, align: 'right' as const,
      render: (v: number) => eur(v) },
    { title: 'A receber', dataIndex: 'outstandingDebt', key: 'debt', width: 95, align: 'right' as const,
      render: (v: number) => v > 0
        ? <Tag color="red">{eur(v)}</Tag>
        : <Tag color="green">{eur(v)}</Tag> },
    { title: 'Lucro rest.', dataIndex: 'totalRestaurantProfit', key: 'profit', width: 100, align: 'right' as const,
      render: (v: number) => eur(v) },
  ];

  const delivererCols = [
    { title: 'Entregador', dataIndex: 'delivererName', key: 'name', ellipsis: true },
    { title: 'Entregas', dataIndex: 'orderCount', key: 'cnt', width: 70, align: 'right' as const },
    { title: 'Comissão total', dataIndex: 'totalCommission', key: 'comm', width: 115, align: 'right' as const,
      render: (v: number) => <Text strong style={{ color: '#52c41a' }}>{eur(v)}</Text> },
    { title: 'Acertos', dataIndex: 'totalSettlements', key: 'sett', width: 90, align: 'right' as const,
      render: (v: number) => eur(v) },
    { title: 'A pagar', dataIndex: 'outstandingCredit', key: 'credit', width: 90, align: 'right' as const,
      render: (v: number) => v > 0
        ? <Tag color="orange">{eur(v)}</Tag>
        : <Tag color="green">{eur(v)}</Tag> },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }} wrap>
        <RangePicker
          value={range}
          onChange={v => { setRange(v as [dayjs.Dayjs, dayjs.Dayjs] | null); setEnabled(false); }}
          format="DD/MM/YYYY"
        />
        <Button type="primary" onClick={() => { setEnabled(true); refetch(); }}>
          Atualizar
        </Button>
      </Space>

      {isLoading && <Spin style={{ display: 'block', margin: '40px auto' }} />}

      {data && (
        <>
          {/* KPIs gerais */}
          <Row gutter={12} style={{ marginBottom: 20 }}>
            <Col span={4}>
              <Card size="small">
                <Statistic title="Pedidos" value={data.totals.orderCount} />
              </Card>
            </Col>
            <Col span={5}>
              <Card size="small">
                <Statistic title="Valor total" value={data.totals.totalOrderValue} prefix="€" precision={2} />
              </Card>
            </Col>
            <Col span={5}>
              <Card size="small">
                <Statistic title="Entregas LT" value={data.totals.totalDeliveryFees} prefix="€" precision={2}
                  valueStyle={{ color: '#1677ff', fontWeight: 700 }} />
              </Card>
            </Col>
            <Col span={5}>
              <Card size="small">
                <Statistic title="Acertos recebidos" value={data.totals.totalSettlementsReceived} prefix="€" precision={2}
                  valueStyle={{ color: '#52c41a' }} />
              </Card>
            </Col>
            <Col span={5}>
              <Card size="small">
                <Statistic title="A receber (rest.)" value={data.totals.outstandingFromRestaurants} prefix="€" precision={2}
                  valueStyle={{ color: '#f5222d', fontWeight: 700 }} />
              </Card>
            </Col>
          </Row>

          <Divider orientation="left">Por Restaurante</Divider>
          <Table
            rowKey="restaurantId"
            dataSource={data.restaurants as SummaryReportRestaurant[]}
            columns={restaurantCols}
            size="small"
            pagination={false}
            summary={rows => {
              const totalFees = rows.reduce((s, r) => s + r.totalDeliveryFees, 0);
              const totalDebt = rows.reduce((s, r) => s + r.outstandingDebt, 0);
              return (
                <Table.Summary.Row style={{ fontWeight: 700 }}>
                  <Table.Summary.Cell index={0}>Total</Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right">{rows.reduce((s, r) => s + r.orderCount, 0)}</Table.Summary.Cell>
                  <Table.Summary.Cell index={2} align="right">{eur(rows.reduce((s, r) => s + r.totalOrderValue, 0))}</Table.Summary.Cell>
                  <Table.Summary.Cell index={3} align="right"><Text style={{ color: '#1677ff', fontWeight: 700 }}>{eur(totalFees)}</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={4} align="right">{eur(rows.reduce((s, r) => s + r.totalSettlements, 0))}</Table.Summary.Cell>
                  <Table.Summary.Cell index={5} align="right"><Text style={{ color: '#f5222d', fontWeight: 700 }}>{eur(totalDebt)}</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={6} align="right">{eur(rows.reduce((s, r) => s + r.totalRestaurantProfit, 0))}</Table.Summary.Cell>
                </Table.Summary.Row>
              );
            }}
          />

          <Divider orientation="left" style={{ marginTop: 24 }}>Por Entregador</Divider>
          <Table
            rowKey="delivererJid"
            dataSource={data.deliverers as SummaryReportDeliverer[]}
            columns={delivererCols}
            size="small"
            pagination={false}
            summary={rows => {
              const totalComm = rows.reduce((s, r) => s + r.totalCommission, 0);
              const totalCredit = rows.reduce((s, r) => s + r.outstandingCredit, 0);
              return (
                <Table.Summary.Row style={{ fontWeight: 700 }}>
                  <Table.Summary.Cell index={0}>Total</Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right">{rows.reduce((s, r) => s + r.orderCount, 0)}</Table.Summary.Cell>
                  <Table.Summary.Cell index={2} align="right"><Text style={{ color: '#52c41a', fontWeight: 700 }}>{eur(totalComm)}</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={3} align="right">{eur(rows.reduce((s, r) => s + r.totalSettlements, 0))}</Table.Summary.Cell>
                  <Table.Summary.Cell index={4} align="right"><Text style={{ color: '#f5222d', fontWeight: 700 }}>{eur(totalCredit)}</Text></Table.Summary.Cell>
                </Table.Summary.Row>
              );
            }}
          />
        </>
      )}
    </div>
  );
}

// ── Relatório do Restaurante ─────────────────────────────────────────────────

function RestaurantReportTab() {
  const [restaurantId, setRestaurantId] = useState('');
  const [range, setRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>([
    dayjs().subtract(6, 'day').startOf('day'),
    dayjs().endOf('day'),
  ]);
  const [enabled, setEnabled] = useState(false);

  const { data: restaurants = [] } = useQuery({
    queryKey: ['delivery-restaurants'],
    queryFn: api.getDeliveryRestaurants,
  });

  const params: Record<string, string> = {
    restaurantId,
    from: range ? range[0].format('YYYY-MM-DD') : '',
    to: range ? range[1].format('YYYY-MM-DD') : '',
  };

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['report-restaurant', params],
    queryFn: () => api.getRestaurantReport(params),
    enabled: enabled && !!restaurantId,
  });

  const handleSearch = () => {
    if (!restaurantId) return;
    setEnabled(true);
    refetch();
  };

  const chartData = data ? [
    {
      name: data.restaurant.name,
      'Valor pedidos': data.summary.totalOrderValue,
      'Entregas Livraison': data.summary.totalDeliveryFees,
      'Lucro Restaurante': data.summary.totalRestaurantProfit,
    },
  ] : [];

  const cols = [
    { title: 'Data', dataIndex: 'date', key: 'date', width: 70 },
    { title: 'Horário', dataIndex: 'time', key: 'time', width: 70 },
    { title: 'Endereço', dataIndex: 'clientAddress', key: 'addr', ellipsis: true },
    { title: 'Comuna', dataIndex: 'commune', key: 'commune', width: 100 },
    { title: 'KM', dataIndex: 'distanceKm', key: 'km', width: 65,
      render: (v: number | null) => v != null ? `${v} km` : '—' },
    { title: 'Pedido', dataIndex: 'orderValue', key: 'val', width: 90, align: 'right' as const,
      render: (v: number) => <Text strong>{eur(v)}</Text> },
    { title: 'Taxa Base', dataIndex: 'deliveryFee', key: 'fee', width: 90, align: 'right' as const,
      render: (v: number) => (
        <Text strong style={{ color: '#1677ff', background: '#e6f4ff', padding: '2px 6px', borderRadius: 4 }}>
          {eur(v)}
        </Text>
      ) },
    { title: 'Comida', dataIndex: 'foodValue', key: 'food', width: 90, align: 'right' as const,
      render: (v: number) => eur(v) },
    { title: 'Valor acerto', dataIndex: 'settlementAmount', key: 'sett', width: 100, align: 'right' as const,
      render: (v: number | null) => v != null ? eur(v) : '' },
    { title: 'Entregador', dataIndex: 'delivererName', key: 'dlv', width: 100 },
  ];

  return (
    <div>
      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          placeholder="Selecione o restaurante"
          style={{ width: 240 }}
          value={restaurantId || undefined}
          onChange={v => { setRestaurantId(v ?? ''); setEnabled(false); }}
          options={(restaurants as DeliveryRestaurant[]).map(r => ({ value: r._id, label: r.name }))}
          showSearch
          filterOption={(inp, opt) => String(opt?.label ?? '').toLowerCase().includes(inp.toLowerCase())}
        />
        <RangePicker
          value={range}
          onChange={v => setRange(v as [dayjs.Dayjs, dayjs.Dayjs] | null)}
          format="DD/MM/YYYY"
        />
        <Button type="primary" onClick={handleSearch} disabled={!restaurantId}>
          Gerar Relatório
        </Button>
      </Space>

      {isLoading && <Spin style={{ display: 'block', margin: '40px auto' }} />}

      {!isLoading && !data && enabled && (
        <Empty description="Nenhum pedido encontrado no período" />
      )}

      {data && (
        <>
          {/* Cabeçalho */}
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <Title level={3} style={{ marginBottom: 4 }}>{data.restaurant.name.toUpperCase()}</Title>
            {data.restaurant.address && (
              <Text type="secondary">{data.restaurant.address}</Text>
            )}
          </div>

          {/* Período */}
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <table style={{ margin: '0 auto', borderCollapse: 'collapse' }}>
              <tbody>
                <tr>
                  <td style={{ border: '1px solid #d9d9d9', padding: '6px 16px', fontWeight: 600 }}>Data</td>
                  <td style={{ border: '1px solid #d9d9d9', padding: '6px 16px' }}>{data.period.from.split('-').reverse().join('/')}</td>
                  <td style={{ border: '1px solid #d9d9d9', padding: '6px 16px' }}>{data.period.to.split('-').reverse().join('/')}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Resumo */}
          <Row gutter={12} style={{ marginBottom: 16 }}>
            <Col span={8}>
              <Card size="small" style={{ background: '#f0f0f0' }}>
                <Statistic
                  title="Valor Total Entregas Livraison"
                  value={data.summary.totalDeliveryFees}
                  prefix="€"
                  precision={2}
                  valueStyle={{ fontSize: 22, fontWeight: 700 }}
                />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small" style={{ background: '#f0f0f0' }}>
                <Statistic
                  title="Acertos"
                  value={data.summary.totalSettlementsReceived}
                  prefix="€"
                  precision={2}
                  valueStyle={{ fontSize: 22, fontWeight: 700 }}
                />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small" style={{ background: '#e6e6e6' }}>
                <Statistic
                  title="Total Débitos Entregas Livraison"
                  value={data.summary.outstandingDebt}
                  prefix="€"
                  precision={2}
                  valueStyle={{ fontSize: 22, fontWeight: 700 }}
                />
              </Card>
            </Col>
          </Row>
          <Row gutter={12} style={{ marginBottom: 24 }}>
            <Col span={12}>
              <Card size="small">
                <Statistic title="Total Valor Pedidos" value={data.summary.totalOrderValue} prefix="€" precision={2} />
              </Card>
            </Col>
            <Col span={12}>
              <Card size="small">
                <Statistic title="Total Lucro Restaurante" value={data.summary.totalRestaurantProfit} prefix="€" precision={2} />
              </Card>
            </Col>
          </Row>

          {/* Gráfico */}
          <div style={{ height: 280, marginBottom: 24 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 20, left: 20, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis tickFormatter={v => `€${v}`} />
                <Tooltip formatter={(v: number) => [`€${v.toFixed(2)}`]} />
                <Legend />
                <Bar dataKey="Valor pedidos" fill="#1677ff" radius={[4, 4, 0, 0]}>
                  {chartData.map((_, i) => <Cell key={i} fill="#1677ff" />)}
                </Bar>
                <Bar dataKey="Entregas Livraison" fill="#f5222d" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Lucro Restaurante" fill="#faad14" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <Divider />

          {/* Tabela detalhada */}
          <Table
            rowKey="_id"
            dataSource={data.orders as RestaurantReportOrder[]}
            columns={cols}
            size="small"
            pagination={false}
            scroll={{ x: 900 }}
            summary={pageData => {
              const total = pageData.reduce((s, r) => s + (r.orderValue || 0), 0);
              const totalFee = pageData.reduce((s, r) => s + (r.deliveryFee || 0), 0);
              const totalFood = pageData.reduce((s, r) => s + (r.foodValue || 0), 0);
              return (
                <Table.Summary.Row style={{ fontWeight: 700 }}>
                  <Table.Summary.Cell index={0} colSpan={5}>Total ({pageData.length} pedidos)</Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right">{eur(total)}</Table.Summary.Cell>
                  <Table.Summary.Cell index={2} align="right">{eur(totalFee)}</Table.Summary.Cell>
                  <Table.Summary.Cell index={3} align="right">{eur(totalFood)}</Table.Summary.Cell>
                  <Table.Summary.Cell index={4} />
                  <Table.Summary.Cell index={5} />
                </Table.Summary.Row>
              );
            }}
          />
        </>
      )}
    </div>
  );
}

// ── Relatório do Entregador ──────────────────────────────────────────────────

function DelivererReportTab() {
  const [delivererJid, setDelivererJid] = useState('');
  const [range, setRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>([
    dayjs().subtract(6, 'day').startOf('day'),
    dayjs().endOf('day'),
  ]);
  const [enabled, setEnabled] = useState(false);

  const { data: deliverers = [], isLoading: dlvLoading } = useQuery({
    queryKey: ['delivery-deliverers'],
    queryFn: api.getDeliverers,
  });

  const params: Record<string, string> = {
    delivererJid,
    from: range ? range[0].format('YYYY-MM-DD') : '',
    to: range ? range[1].format('YYYY-MM-DD') : '',
  };

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['report-deliverer', params],
    queryFn: () => api.getDelivererReport(params),
    enabled: enabled && !!delivererJid,
  });

  const handleSearch = () => {
    if (!delivererJid) return;
    setEnabled(true);
    refetch();
  };

  const cols = [
    { title: 'Data', dataIndex: 'date', key: 'date', width: 70 },
    { title: 'Restaurante', dataIndex: 'restaurantName', key: 'rst', ellipsis: true },
    { title: 'Horário', dataIndex: 'time', key: 'time', width: 70 },
    { title: 'Endereço', dataIndex: 'clientAddress', key: 'addr', ellipsis: true },
    { title: 'Comuna', dataIndex: 'commune', key: 'commune', width: 100 },
    { title: 'KM', dataIndex: 'distanceKm', key: 'km', width: 65,
      render: (v: number | null) => v != null ? `${v} km` : '—' },
    { title: 'Valor acerto', dataIndex: 'settlementAmount', key: 'sett', width: 100, align: 'right' as const,
      render: (v: number | null) => v != null ? eur(v) : '' },
    {
      title: 'Comissão', dataIndex: 'commission', key: 'comm', width: 95, align: 'right' as const,
      render: (v: number) => (
        <Text strong style={{ color: '#52c41a', background: '#f6ffed', padding: '2px 6px', borderRadius: 4 }}>
          {eur(v)}
        </Text>
      ),
    },
  ];

  return (
    <div>
      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          placeholder="Selecione o entregador"
          style={{ width: 220 }}
          value={delivererJid || undefined}
          onChange={v => { setDelivererJid(v ?? ''); setEnabled(false); }}
          loading={dlvLoading}
          options={(deliverers as { jid: string; name: string }[]).map(d => ({ value: d.jid, label: d.name }))}
          showSearch
          filterOption={(inp, opt) => String(opt?.label ?? '').toLowerCase().includes(inp.toLowerCase())}
        />
        <RangePicker
          value={range}
          onChange={v => setRange(v as [dayjs.Dayjs, dayjs.Dayjs] | null)}
          format="DD/MM/YYYY"
        />
        <Button type="primary" onClick={handleSearch} disabled={!delivererJid}>
          Gerar Relatório
        </Button>
      </Space>

      {isLoading && <Spin style={{ display: 'block', margin: '40px auto' }} />}

      {!isLoading && !data && enabled && (
        <Empty description="Nenhum pedido encontrado no período" />
      )}

      {data && (
        <>
          <div style={{ marginBottom: 16 }}>
            <Title level={4} style={{ marginBottom: 8 }}>
              {data.deliverer.name} — {data.period.from.split('-').reverse().join('/')} a {data.period.to.split('-').reverse().join('/')}
            </Title>
            <Row gutter={12}>
              <Col span={8}>
                <Card size="small">
                  <Statistic title="Total Comissão" value={data.summary.totalCommission} prefix="€" precision={2}
                    valueStyle={{ color: '#52c41a', fontWeight: 700 }} />
                </Card>
              </Col>
              <Col span={8}>
                <Card size="small">
                  <Statistic title="Acertos recebidos" value={data.summary.totalSettlementsReceived} prefix="€" precision={2} />
                </Card>
              </Col>
              <Col span={8}>
                <Card size="small">
                  <Statistic title="A receber" value={data.summary.outstandingCredit} prefix="€" precision={2}
                    valueStyle={{ color: '#f5222d', fontWeight: 700 }} />
                </Card>
              </Col>
            </Row>
          </div>

          <Table
            rowKey="_id"
            dataSource={data.orders as DelivererReportOrder[]}
            columns={cols}
            size="small"
            pagination={false}
            scroll={{ x: 800 }}
            summary={pageData => {
              const totalComm = pageData.reduce((s, r) => s + (r.commission || 0), 0);
              return (
                <Table.Summary.Row style={{ fontWeight: 700 }}>
                  <Table.Summary.Cell index={0} colSpan={7}>Total ({pageData.length} entregas)</Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right">
                    <Text style={{ color: '#52c41a', fontWeight: 700 }}>{eur(totalComm)}</Text>
                  </Table.Summary.Cell>
                </Table.Summary.Row>
              );
            }}
          />

          {data.orders.length === 0 && <Tag color="orange" style={{ marginTop: 16 }}>Sem entregas no período</Tag>}
        </>
      )}
    </div>
  );
}

// ── Página principal ─────────────────────────────────────────────────────────

export default function Relatorios() {
  const items = [
    { key: 'summary', label: 'Geral', children: <SummaryTab /> },
    { key: 'restaurant', label: 'Por Restaurante', children: <RestaurantReportTab /> },
    { key: 'deliverer', label: 'Por Entregador', children: <DelivererReportTab /> },
  ];

  return (
    <div>
      <Title level={3} style={{ marginTop: 0 }}>Relatórios</Title>
      <Tabs items={items} />
    </div>
  );
}
