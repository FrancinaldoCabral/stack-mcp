import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import { BusinessProvider } from './lib/BusinessContext';
import Painel from './pages/Painel';
import Pedidos from './pages/Pedidos';
import Restaurantes from './pages/Restaurantes';
import Precos from './pages/Precos';
import Acertos from './pages/Acertos';
import Entregadores from './pages/Entregadores';
import Atendente from './pages/Atendente';
import Whatsapp from './pages/Whatsapp';
import Maintenance from './pages/Maintenance';

export default function App() {
  return (
    <BrowserRouter>
      <BusinessProvider>
        <Layout>
          <Routes>
            <Route path="/" element={<Painel />} />
            <Route path="/pedidos" element={<Pedidos />} />
            <Route path="/restaurantes" element={<Restaurantes />} />
            <Route path="/precos" element={<Precos />} />
            <Route path="/entregadores" element={<Entregadores />} />
            <Route path="/acertos" element={<Acertos />} />
            <Route path="/atendente" element={<Atendente />} />
            <Route path="/whatsapp" element={<Whatsapp />} />
            <Route path="/manutencao" element={<Maintenance />} />
            {/* Compatibilidade com links antigos */}
            <Route path="/delivery" element={<Navigate to="/pedidos" replace />} />
            <Route path="/businesses" element={<Navigate to="/atendente" replace />} />
            <Route path="/maintenance" element={<Navigate to="/manutencao" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </BusinessProvider>
    </BrowserRouter>
  );
}
