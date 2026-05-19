import { useState } from 'react';
import { Card, Col, Row, Select, Spin, Typography, Empty } from 'antd';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar,
} from 'recharts';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Business } from '../lib/types';

const { Title } = Typography;

const DAYS_OPTIONS = [
  { value: '7', label: '7 dias' },
  { value: '14', label: '14 dias' },
  { value: '30', label: '30 dias' },
  { value: '90', label: '90 dias' },
];

export default function Analytics() {
  const [days, setDays] = useState('7');
  const [bizFilter, setBizFilter] = useState('');

  const params: Record<string, string> = { days };
  if (bizFilter) params.businessId = bizFilter;

  const { data, isLoading } = useQuery({
    queryKey: ['analytics', params],
    queryFn: () => api.getAnalytics(params),
    staleTime: 60_000,
  });

  const { data: businesses = [] } = useQuery({ queryKey: ['businesses'], queryFn: api.getBusinesses });

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>Analytics</Title>
        <div style={{ display: 'flex', gap: 8 }}>
          <Select
            value={bizFilter || undefined}
            onChange={v => setBizFilter(v ?? '')}
            placeholder="Todos os negócios"
            allowClear
            style={{ width: 200 }}
            options={(businesses as Business[]).map(b => ({ value: b._id, label: b.name }))}
          />
          <Select value={days} onChange={setDays} options={DAYS_OPTIONS} style={{ width: 120 }} />
        </div>
      </div>

      {isLoading && <Spin size="large" style={{ display: 'block', margin: '60px auto' }} />}

      {data && (
        <Row gutter={[16, 16]}>
          <Col span={24}>
            <Card title="Conversas por dia">
              {data.dailyStats.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={data.dailyStats}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="_id" tick={{ fontSize: 12 }} />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="conversations" name="Conversas" stroke="#1677ff" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="messages" name="Mensagens" stroke="#52c41a" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : <Empty description="Sem dados no período." />}
            </Card>
          </Col>

          <Col xs={24} md={12}>
            <Card title="Top 10 clientes (por conversas)">
              {data.topCustomers.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.topCustomers} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={120}
                      tickFormatter={v => (v?.length > 16 ? v.slice(0, 14) + '…' : v) || 'Anônimo'} />
                    <Tooltip />
                    <Bar dataKey="conversation_count" name="Conversas" fill="#1677ff" />
                  </BarChart>
                </ResponsiveContainer>
              ) : <Empty description="Sem dados." />}
            </Card>
          </Col>

          <Col xs={24} md={12}>
            <Card title="Modelos utilizados">
              {data.modelUsage.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.modelUsage}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="_id" tick={{ fontSize: 10 }} tickFormatter={v => v?.split('/').pop() ?? v} />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="count" name="Conversas" fill="#fa8c16" />
                  </BarChart>
                </ResponsiveContainer>
              ) : <Empty description="Sem dados." />}
            </Card>
          </Col>
        </Row>
      )}
    </>
  );
}
