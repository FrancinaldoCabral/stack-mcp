import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Businesses from './pages/Businesses';
import Customers from './pages/Customers';
import Conversations from './pages/Conversations';
import Analytics from './pages/Analytics';
import KnowledgeBase from './pages/KnowledgeBase';

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/businesses" element={<Businesses />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/conversations" element={<Conversations />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/knowledge" element={<KnowledgeBase />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
