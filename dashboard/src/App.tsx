import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Businesses from './pages/Businesses';
import Delivery from './pages/Delivery';
import Maintenance from './pages/Maintenance';

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/delivery" replace />} />
          <Route path="/businesses" element={<Businesses />} />
          <Route path="/delivery" element={<Delivery />} />
          <Route path="/maintenance" element={<Maintenance />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
