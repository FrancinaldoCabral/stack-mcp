import { Card, Col, Row, Statistic, Spin, Typography, Badge, Space, Alert } from 'antd';
import {
  ShopOutlined, WifiOutlined, RobotOutlined,
  CheckCircleOutlined, ClockCircleOutlined, MessageOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Business } from '../lib/types';

const { Title, Text } = Typography;

export default function Dashboard() {
  const { data: businesses = [], isLoading } = useQuery<Business[]>({
    queryKey: ['businesses'],
    queryFn: api.getBusinesses,
    refetchInterval: 30_000,
  });

  if (isLoading) return <Spin size="large" style={{ display: 'block', margin: '60px auto' }} />;

  const totalInstances = businesses.reduce((acc, b) => acc + (b.instances?.length ?? 0), 0);
  const totalAgents = businesses.reduce((acc, b) => acc + (b.agents?.length ?? 0), 0);

  return (
    <>
      <Title level={3} style={{ marginTop: 0 }}>Visão Geral</Title>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic title="Negócios ativos" value={businesses.length} prefix={<ShopOutlined />} valueStyle={{ color: '#1677ff' }} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic title="Números WhatsApp" value={totalInstances} prefix={<WifiOutlined />} valueStyle={{ color: '#52c41a' }} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic title="Agentes IA" value={totalAgents} prefix={<RobotOutlined />} valueStyle={{ color: '#722ed1' }} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24}>
          <Card title={<Space><WifiOutlined /> Instâncias</Space>}>
            {businesses.length === 0 ? (
              <Text type="secondary">Nenhum negócio cadastrado. Vá em <strong>Negócios</strong> para criar.</Text>
            ) : (
              <Row gutter={[12, 12]}>
                {businesses.flatMap(b =>
                  (b.instances ?? []).map(inst => {
                    const agent = b.agents?.find(a => a._id === (b.instanceAgents ?? {})[inst]);
                    return (
                      <Col key={`${b._id}-${inst}`} xs={24} sm={12} md={8} lg={6}>
                        <Card size="small" style={{ borderRadius: 8 }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <Text strong style={{ fontSize: 13 }}>{b.name}</Text>
                            <Text code style={{ fontSize: 11 }}>{inst}</Text>
                            {agent ? (
                              <Badge status="success" text={<Text style={{ fontSize: 11 }}><RobotOutlined /> {agent.assistantName}</Text>} />
                            ) : (
                              <Badge status="default" text={<Text type="secondary" style={{ fontSize: 11 }}>Sem agente</Text>} />
                            )}
                          </div>
                        </Card>
                      </Col>
                    );
                  })
                )}
              </Row>
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} md={12}>
          <Card title={<Space><MessageOutlined /> Serviços</Space>}>
            <Space direction="vertical" style={{ width: '100%' }}>
              {[
                { label: 'Evolution API', host: 'evolution.vendly.chat' },
                { label: 'Chatwoot', host: 'chatwoot.vendly.chat' },
                { label: 'N8N Workflows', host: 'workflows.vendly.chat' },
                { label: 'MCP Server', host: 'online', processing: true },
              ].map(s => (
                <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}>
                  <Text>{s.label}</Text>
                  <Badge status={s.processing ? 'processing' : 'success'} text={s.host} />
                </div>
              ))}
            </Space>
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title={<Space><ClockCircleOutlined /> Atalhos</Space>}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Alert type="info" showIcon icon={<CheckCircleOutlined />}
                message="Gerenciar negócios e agentes"
                description={<Text type="secondary" style={{ fontSize: 12 }}>Acesse <strong>Negócios</strong> para configurar instâncias WhatsApp e agentes IA.</Text>}
              />
              <Alert type="warning" showIcon
                message="Limpar conversas"
                description={<Text type="secondary" style={{ fontSize: 12 }}>Acesse <strong>Manutenção</strong> para limpar histórico por contato ou tudo de uma vez.</Text>}
              />
            </Space>
          </Card>
        </Col>
      </Row>
    </>
  );
}
