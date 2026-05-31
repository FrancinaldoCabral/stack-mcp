import { Typography } from 'antd';
import { SettlementsTab } from './Delivery';

const { Title, Text } = Typography;

export default function Acertos() {
  return (
    <div>
      <Title level={3} style={{ marginTop: 0 }}>💰 Acertos com restaurantes</Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        Acompanhe o que cada restaurante deve por entrega e marque como liquidado quando receber.
      </Text>
      <SettlementsTab />
    </div>
  );
}
