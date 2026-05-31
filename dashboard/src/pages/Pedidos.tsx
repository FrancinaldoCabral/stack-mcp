import { Typography } from 'antd';
import { OrdersTab, DeliveryStatusBanner } from './Delivery';

const { Title } = Typography;

export default function Pedidos() {
  return (
    <div>
      <Title level={3} style={{ marginTop: 0 }}>🛵 Pedidos</Title>
      <DeliveryStatusBanner />
      <OrdersTab />
    </div>
  );
}
