import { Typography } from 'antd';
import { RestaurantsTab, DeliveryStatusBanner } from './Delivery';

const { Title } = Typography;

export default function Restaurantes() {
  return (
    <div>
      <Title level={3} style={{ marginTop: 0 }}>🍽️ Restaurantes</Title>
      <DeliveryStatusBanner />
      <RestaurantsTab />
    </div>
  );
}
