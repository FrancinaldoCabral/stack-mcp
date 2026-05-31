import { Typography } from 'antd';
import { FeeTableTab } from './Delivery';

const { Title, Text } = Typography;

export default function Precos() {
  return (
    <div>
      <Title level={3} style={{ marginTop: 0 }}>💶 Taxas de entrega</Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        Defina o valor cobrado por entrega de acordo com a distância em quilômetros.
        O atendente virtual usa essa tabela ao informar preços ao cliente.
      </Text>
      <FeeTableTab />
    </div>
  );
}
