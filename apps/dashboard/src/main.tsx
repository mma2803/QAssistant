import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { ThemeProvider } from './components/theme-provider';
import { I18nProvider } from './i18n';
import { Toaster } from './components/ui/sonner';
import { App } from './App';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root');

createRoot(container).render(
  <React.StrictMode>
    <ThemeProvider defaultTheme="light">
      <I18nProvider>
        <BrowserRouter>
          <AuthProvider>
            <App />
            <Toaster richColors position="top-right" />
          </AuthProvider>
        </BrowserRouter>
      </I18nProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
