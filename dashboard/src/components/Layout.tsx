import React, { useState } from 'react';
import { Layout as AntLayout, Menu, Button, Input, Modal, Typography } from 'antd';
import {
  DashboardOutlined,
  ShopOutlined,
  UserOutlined,
  MessageOutlined,
  BarChartOutlined,
  RobotOutlined,
  BookOutlined,
  KeyOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import { getApiKey, setApiKey } from '../lib/api';

const { Header, Sider, Content } = AntLayout;
const { Text } = Typography;

const menuItems = [
  { key: '/', icon: <DashboardOutlined />, label: 'Dashboard' },
  { key: '/businesses', icon: <ShopOutlined />, label: 'Negócios' },
  { key: '/customers', icon: <UserOutlined />, label: 'Clientes' },
  { key: '/conversations', icon: <MessageOutlined />, label: 'Conversas' },
  { key: '/analytics', icon: <BarChartOutlined />, label: 'Analytics' },
  { key: '/knowledge', icon: <BookOutlined />, label: 'Base de Conhecimento' },
  { key: '/agents', icon: <RobotOutlined />, label: 'Config. Agente' },
];

interface Props { children: React.ReactNode }

export default function Layout({ children }: Props) {
  const nav = useNavigate();
  const loc = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [keyModalOpen, setKeyModalOpen] = useState(!getApiKey());
  const [keyInput, setKeyInput] = useState('');

  const saveKey = () => { setApiKey(keyInput); setKeyModalOpen(false); };

  return (
    <AntLayout style={{ minHeight: '100vh' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        trigger={null}
        width={220}
        style={{ background: '#001529' }}
      >
        <div style={{ color: '#fff', padding: collapsed ? '16px 8px' : '16px', fontSize: collapsed ? 14 : 18, fontWeight: 700, letterSpacing: 1, textAlign: 'center', borderBottom: '1px solid #ffffff20' }}>
          {collapsed ? 'V' : '💬 Vendly'}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[loc.pathname]}
          items={menuItems}
          onClick={({ key }) => nav(key)}
        />
      </Sider>

      <AntLayout>
        <Header style={{ padding: '0 16px', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 1px 4px #0001' }}>
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed(!collapsed)}
          />
          <Button size="small" icon={<KeyOutlined />} onClick={() => setKeyModalOpen(true)}>
            API Key
          </Button>
        </Header>

        <Content style={{ margin: 24, background: '#f5f5f5', borderRadius: 8, padding: 24, minHeight: 360 }}>
          {children}
        </Content>
      </AntLayout>

      <Modal
        title="API Key de Administrador"
        open={keyModalOpen}
        onOk={saveKey}
        onCancel={() => setKeyModalOpen(false)}
        okText="Salvar"
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          Insira a chave <code>ADMIN_API_KEY</code> configurada no servidor.
        </Text>
        <Input.Password
          value={keyInput}
          onChange={e => setKeyInput(e.target.value)}
          placeholder="vendly-admin-dev"
          onPressEnter={saveKey}
        />
      </Modal>
    </AntLayout>
  );
}
