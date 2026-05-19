import { Card, Col, Row, Statistic, Spin, Typography } from 'antd';
import { MessageOutlined, UserOutlined, ShopOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

const { Title } = Typography;

export default function Dashboard() {
  const { data, isLoading } = useQuery({ queryKey: ['analytics'], queryFn: () => api.getAnalytics({ days: '7' }) });

  if (isLoading) return <Spin size="large" style={{ display: 'block', margin: '60px auto' }} />;

  const s = data?.summary;

  return (
    <>
      <Title level={3} style={{ marginTop: 0 }}>Dashboard</Title>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="Negócios" value={s?.totalBusinesses ?? 0} prefix={<ShopOutlined />} valueStyle={{ color: '#1677ff' }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="Clientes" value={s?.totalCustomers ?? 0} prefix={<UserOutlined />} valueStyle={{ color: '#52c41a' }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="Conversas Totais" value={s?.totalConversations ?? 0} prefix={<MessageOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title={`Conversas (${s?.period ?? '7d'})`}
              value={s?.recentConversations ?? 0}
              prefix={<ThunderboltOutlined />}
              valueStyle={{ color: '#fa8c16' }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} md={12}>
          <Card title="Novos clientes (7d)">
            <Statistic value={s?.recentCustomers ?? 0} suffix="clientes novos" />
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="Uso de modelos">
            {data?.modelUsage?.length
              ? data.modelUsage.map(m => (
                  <div key={m._id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{m._id || '(sem modelo)'}</span>
                    <strong>{m.count}</strong>
                  </div>
                ))
              : <Typography.Text type="secondary">Sem dados ainda.</Typography.Text>}
          </Card>
        </Col>
      </Row>
    </>
  );
}
