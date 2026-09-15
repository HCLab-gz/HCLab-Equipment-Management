import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter, Routes, Route, Link } from 'react-router-dom';
import { Provider } from './lib/store';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Catalog } from './pages/Catalog';
import { Login, Register, RulesPage } from './pages/Auth';
import { EquipmentDetail } from './pages/EquipmentDetail';
import { Records } from './pages/Records';
import { Membership } from './pages/Membership';
import { Admin } from './pages/Admin';
import { PasswordReset } from './pages/PasswordReset';
import './styles.css';
function App() {
  return (
    <Provider>
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="equipment" element={<Catalog />} />
            <Route path="equipment/:id" element={<EquipmentDetail />} />
            <Route path="login" element={<Login />} />
            <Route path="reset-password" element={<PasswordReset />} />
            <Route path="register" element={<Register />} />
            <Route path="rules" element={<RulesPage />} />
            <Route path="records" element={<Records />} />
            <Route path="admin" element={<Admin />} />
            <Route path="membership" element={<Membership />} />
            <Route
              path="*"
              element={
                <div className="empty">
                  <h1>页面不存在</h1>
                  <Link to="/equipment">查看设备目录</Link>
                </div>
              }
            />
          </Route>
        </Routes>
      </HashRouter>
    </Provider>
  );
}
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
