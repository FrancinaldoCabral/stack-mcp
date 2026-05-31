import { Card, Col, Row, Typography, Statistic, Spin, List, Tag, Empty } from 'antd';
import {
  CarOutlined, CheckCircleOutlined, EuroOutlined, WalletOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { api } from '../lib/api';
import { useBusiness } from '../lib/BusinessContext';
import { DeliveryStatusBanner } from './Delivery';
import type { DeliveryOrder, DeliverySettlement } from '../lib/types';

const { Title, Text } = Typography;

const STATUS_LABEL: Record<string, { color: string; label: string }> = {
  pendente:       { color: 'orange',   label: 'Pendente' },
  atribuido:      { color: 'blue',     label: 'Atribuído' },
  a_caminho:      { color: 'geekblue', label: 'A caminho' },
  no_restaurante: { color: 'purple',   label: 'No restaurante' },
  saindo:         { color: 'cyan',     label: 'Saindo' },
  no_cliente:     { color: 'gold',     label: 'No cliente' },
  entregue:       { color: 'green',    label: 'Entregue' },
  problema:       { color: 'red',      label: 'Problema' },
};

export default function Painel() {
  const { business } = useBusiness();
  const { data: ordersResp, isLoading: loadingOrders } = useQuery({
    queryKey: ['delivery-orders', '7'],
    queryFn: () => api.getDeliveryOrders({ days: '7' }),
    refetchInterval: 30_000,
  });
  const { data: settResp, isLoading: loadingSett } = useQuery({
    queryKey: ['delivery-settlements', '30'],
    queryFn: () => api.getDeliverySettlements({ days: '30' }),
    refetchInterval: 60_000,
  });

  const orders: DeliveryOrder[] = ordersResp?.data ?? [];
  const settlements: DeliverySettlement[] = settResp?.data ?? [];

  const startOfDay = dayjs().startOf('day');
  const todayOrders = orders.filter(o => dayjs(o.createdAt).isAfter(startOfDay));
  const todayDelivered = todayOrders.filter(o => o.status === 'entregue');
  const todayValue = todayDelivered.reduce((s, o) => s + (o.value ?? 0), 0);
  const pendingSettlements = settlements.filter(s => s.status === 'pendente');
  const pendingTotal = pendingSettlements.reduce((s, x) => s + (x.amount ?? 0), 0);

  const activeOrders = todayOrders.filter(o => !['entregue', 'problema'].includes(o.status));

  return (
    <div>
      <Title level={3} style={{ marginTop: 0 }}>📊 Painel — {business.name}</Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        Visão rápida do dia. {dayjs().format('dddd, DD [de] MMMM')}
      </Text>

      <DeliveryStatusBanner />

      <Spin spinning={loadingOrders || loadingSett}>
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title="Pedidos hoje"
                value={todayOrders.length}
                prefix={<CarOutlined style={{ color: '#1677ff' }} />}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title="Entregues hoje"
                value={todayDelivered.length}
                prefix={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title="Faturamento de hoje"
                value={todayValue}
                precision={2}
                prefix={<EuroOutlined style={{ color: '#722ed1' }} />}
                suffix="€"
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title="A receber dos restaurantes"
                value={pendingTotal}
                precision={2}
                prefix={<WalletOutlined style={{ color: '#fa8c16' }} />}
                suffix="€"
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {pendingSettlements.length} acerto(s) pendente(s) — <Link to="/acertos">ver</Link>
              </Text>
            </Card>
          </Col>
        </Row>

        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col xs={24} lg={14}>
            <Card title="Pedidos em andamento" extra={<Link to="/pedidos">Ver todos</Link>}>
              {activeOrders.length === 0 ? (
                <Empty description="Nenhum pedido em andamento agora" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                <List
                  size="small"
                  dataSource={activeOrders.slice(0, 8)}
                  renderItem={(o) => {
                    const st = STATUS_LABEL[o.status] ?? { color: 'default', label: o.status };
                    return (
                      <List.Item>
                        <List.Item.Meta
                          title={
                            <span>
                              <Tag color={st.color}>{st.label}</Tag>
                              <Text strong>{o.restaurantName ?? '—'}</Text>
                              {o.orderNumber ? <Text type="secondary"> · #{o.orderNumber}</Text> : null}
                            </span>
                          }
                          description={
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {o.clientName ?? 'Cliente'} · {o.delivererName ?? 'sem entregador'} · {dayjs(o.createdAt).format('HH:mm')}
                            </Text>
                          }
                        />
                      </List.Item>
                    );
                  }}
                />
              )}
            </Card>
          </Col>
          <Col xs={24} lg={10}>
            <Card title="Últimas entregas concluídas" extra={<Link to="/pedidos">Histórico</Link>}>
              {todayDelivered.length === 0 ? (
                <Empty description="Nenhuma entrega concluída hoje" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                <List
                  size="small"
                  dataSource={todayDelivered.slice(0, 6)}
                  renderItem={(o) => (
                    <List.Item>
                      <List.Item.Meta
                        title={
                          <span>
                            <Text strong>{o.restaurantName ?? '—'}</Text>
                            {o.value ? <Text type="secondary"> · {o.value.toFixed(2)} €</Text> : null}
                          </span>
                        }
                        description={
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {o.delivererName ?? '—'} · {dayjs(o.createdAt).format('HH:mm')}
                          </Text>
                        }
                      />
                    </List.Item>
                  )}
                />
              )}
            </Card>
          </Col>
        </Row>
      </Spin>
    </div>
  );
}
