import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import './styles.css';
import { ShopPage, ProductPage } from './pages/Shop';
import { OrderPage } from './pages/Order';
import { SellerPage } from './pages/Seller';
import { AgentPage } from './pages/Agent';
import { LedgerPage } from './pages/Ledger';
import { HomePage, LivePage } from './pages/Live';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename="/app">
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/shop" element={<ShopPage />} />
        <Route path="/p/:slug" element={<ProductPage />} />
        <Route path="/orders/:id" element={<OrderPage />} />
        <Route path="/seller/:slug" element={<SellerPage />} />
        <Route path="/seller" element={<SellerPage />} />
        <Route path="/agent" element={<AgentPage />} />
        <Route path="/ledger" element={<LedgerPage />} />
        <Route path="/live" element={<LivePage />} />
        <Route path="*" element={<HomePage />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
