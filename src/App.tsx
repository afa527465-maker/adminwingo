import React from 'react';
import { AuthProvider } from './context/AuthContext';
import { AdminPanel } from './components/AdminPanel';

export default function App() {
  return (
    <AuthProvider>
      <AdminPanel />
    </AuthProvider>
  );
}
