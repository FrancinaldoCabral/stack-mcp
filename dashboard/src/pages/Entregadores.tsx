/**
 * Entregadores — lista os entregadores conhecidos (extraídos dos pedidos)
 * com contagem e valores totais.
 */
import { useMemo } from 'react';
import { Typography, Table, Tag, Spin, Empty, Card, Select, Space } from 'antd';
import { TeamOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api';
import type { DeliveryOrder, DeliverySettlement } from '../lib/types';

const { Title, Text, Paragraph } = Typography;

const DAYS_OPTIONS = [
  { value: '7',  label: 'Últimos 7 dias' },
  { value: '14', label: 'Últimos 14 dias' },
  { value: '30', label: 'Últimos 30 dias' },
  { value: '90', label: 'Últimos 90 dias' },
];

interface DelivererStats {
  jid: string;
  name: string;
  totalOrders: number;
  delivered: number;
  activeNow: number;
  totalValue: number;
  pendingSettlement: number;
}

export default function Entregadores() {
  const [days, setDays] = useState<string>('30');

  const { data: ordersResp, isLoading: loadingOrders } = useQuery({
    queryKey: ['delivery-orders', days],
    queryFn: () => api.getDeliveryOrders({ days }),
  });
  const { data: settResp } = useQuery({
    queryKey: ['delivery-settlements', days],
    queryFn: () => api.getDeliverySettlements({ days }),
  });

  const orders: DeliveryOrder[] = ordersResp?.data ?? [];
  const settlements: DeliverySettlement[] = settResp?.data ?? [];

  const stats: DelivererStats[] = useMemo(() => {
    const map = new Map<string, DelivererStats>();
    const ACTIVE = new Set(['atribuido', 'a_caminho', 'no_restaurante', 'saindo', 'no_cliente']);
    for (const o of orders) {
      const jid = o.delivererJid ?? '';
      const name = o.delivererName ?? (jid ? jid.split('@')[0] : '— sem entregador —');
      const key = jid || `__${name}`;
      const s = map.get(key) ?? {
        jid, name, totalOrders: 0, delivered: 0, activeNow: 0, totalValue: 0, pendingSettlement: 0,
      };
      s.totalOrders += 1;
      if (o.status === 'entregue') {
        s.delivered += 1;
        s.totalValue += o.value ?? 0;
      }
      if (ACTIVE.has(o.status)) s.activeNow += 1;
      map.set(key, s);
    }
    // Soma pendências de acertos por entregador (se o tipo expor jid)
    for (const x of settlements) {
      const jid = (x as DeliverySettlement & { delivererJid?: string }).delivererJid ?? '';
      if (!jid || x.status !== 'pendente') continue;
      const s = map.get(jid);
      if (s) s.pendingSettlement += x.amount ?? 0;
    }
    return Array.from(map.values()).sort((a, b) => b.delivered - a.delivered);
  }, [orders, settlements]);

  const cols = [
    {
      title: 'Entregador', dataIndex: 'name', key: 'name',
      render: (name: string, r: DelivererStats) => (
        <Space direction="vertical" size={0}>
          <Text strong>{name}</Text>
          {r.jid && <Text type="secondary" style={{ fontSize: 11 }}>{r.jid.split('@')[0]}</Text>}
        </Space>
      ),
    },
    {
      title: 'Em andamento', dataIndex: 'activeNow', key: 'activeNow', width: 130, align: 'center' as const,
      render: (v: number) => v > 0 ? <Tag color="blue">{v}</Tag> : <Text type="secondary">—</Text>,
    },
    {
      title: 'Entregas concluídas', dataIndex: 'delivered', key: 'delivered', width: 160, align: 'center' as const,
      render: (v: number) => <Tag color="green">{v}</Tag>,
    },
    {
      title: 'Total de pedidos', dataIndex: 'totalOrders', key: 'totalOrders', width: 140, align: 'center' as const,
    },
    {
      title: 'Faturado (€)', dataIndex: 'totalValue', key: 'totalValue', width: 130, align: 'right' as const,
      render: (v: number) => v.toFixed(2),
    },
  ];

  return (
    <div>
      <Title level={3} style={{ marginTop: 0 }}>
        <TeamOutlined /> Entregadores
      </Title>
      <Paragraph type="secondary">
        Lista de entregadores que apareceram nos pedidos no período selecionado.
      </Paragraph>

      <Card
        extra={
          <Select
            size="small"
            value={days}
            onChange={setDays}
            options={DAYS_OPTIONS}
            style={{ width: 180 }}
          />
        }
        title={`${stats.length} entregador(es)`}
      >
        {loadingOrders ? (
          <Spin />
        ) : stats.length === 0 ? (
          <Empty description="Nenhum entregador no período" />
        ) : (
          <Table
            rowKey={r => r.jid || r.name}
            dataSource={stats}
            columns={cols}
            pagination={false}
            size="middle"
          />
        )}
      </Card>
    </div>
  );
}
