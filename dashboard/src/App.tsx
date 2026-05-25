import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Businesses from './pages/Businesses';
import Delivery from './pages/Delivery';
import Maintenance from './pages/Maintenance';

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/businesses" element={<Businesses />} />
          <Route path="/delivery" element={<Delivery />} />
          <Route path="/maintenance" element={<Maintenance />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
