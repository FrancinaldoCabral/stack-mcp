import { useState } from 'react';
import {
  Table, Input, Select, Space, Typography, Tag, Drawer, Badge,
} from 'antd';
import { MessageOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Business, Conversation, Message } from '../lib/types';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

function ConvDrawer({ id, open, onClose }: { id: string; open: boolean; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['conversation', id],
    queryFn: () => api.getConversation(id),
    enabled: open && !!id,
  });

  return (
    <Drawer title="Conversa completa" open={open} onClose={onClose} width={520}>
      {isLoading && <Text>Carregando...</Text>}
      {data?.messages?.map((m: Message, i: number) => (
        <div key={i} style={{ marginBottom: 12, display: 'flex', justifyContent: m.role === 'user' ? 'flex-start' : 'flex-end' }}>
          <div style={{
            background: m.role === 'user' ? '#f0f0f0' : '#1677ff',
            color: m.role === 'user' ? '#000' : '#fff',
            borderRadius: 12,
            padding: '8px 12px',
            maxWidth: '80%',
            fontSize: 13,
            whiteSpace: 'pre-wrap',
          }}>
            {m.role === 'system' && <Badge status="warning" text="Sistema" style={{ marginBottom: 4, display: 'block' }} />}
            {typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}
          </div>
        </div>
      ))}
    </Drawer>
  );
}

export default function Conversations() {
  const [bizFilter, setBizFilter] = useState('');
  const [phone, setPhone] = useState('');
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState('');

  const params: Record<string, string> = { page: String(page), limit: '50' };
  if (bizFilter) params.businessId = bizFilter;
  if (phone) params.phone = phone;

  const { data, isLoading } = useQuery({
    queryKey: ['conversations', params],
    queryFn: () => api.getConversations(params),
  });

  const { data: businesses = [] } = useQuery({ queryKey: ['businesses'], queryFn: api.getBusinesses });
  const bizMap = Object.fromEntries((businesses as Business[]).map(b => [b._id, b.name]));

  const cols = [
    { title: 'Telefone', dataIndex: 'phone', key: 'phone', render: (p: string) => <code>{p}</code> },
    { title: 'Instância', dataIndex: 'instance', key: 'inst', render: (i: string) => <Tag>{i}</Tag> },
    { title: 'Negócio', dataIndex: 'businessId', key: 'biz', render: (id: string) => bizMap[id] || id || '—' },
    { title: 'Mensagens', dataIndex: 'message_count', key: 'cnt', render: (n: number) => n ?? 0 },
    { title: 'Modelo', dataIndex: 'model_used', key: 'model', render: (m: string) => m ? <code style={{ fontSize: 11 }}>{m}</code> : '—' },
    { title: 'Início', dataIndex: 'started_at', key: 'start', render: (d: string) => d ? dayjs(d).format('DD/MM/YY HH:mm') : '—' },
    {
      title: '', key: 'actions',
      render: (_: unknown, c: Conversation) => (
        <a onClick={() => setSelectedId(c._id)} style={{ cursor: 'pointer' }}>
          <MessageOutlined /> Ver
        </a>
      ),
    },
  ];

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>Conversas</Title>
      </div>

      <Space style={{ marginBottom: 16 }} wrap>
        <Input
          placeholder="Filtrar por telefone"
          value={phone}
          onChange={e => { setPhone(e.target.value); setPage(0); }}
          style={{ width: 180 }}
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
        pagination={{ total: data?.total, pageSize: 50, current: page + 1, onChange: p => setPage(p - 1), showTotal: t => `${t} conversas` }}
      />

      <ConvDrawer id={selectedId} open={!!selectedId} onClose={() => setSelectedId('')} />
    </>
  );
}
