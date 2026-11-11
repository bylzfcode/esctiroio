import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { initRuntime } from './config/bootstrap';
import { AuthProvider } from './context/AuthContext';
import { SessionProvider } from './context/SessionContext';
import { ThemeProvider } from './context/ThemeContext';
import { ToastProvider } from './context/ToastContext';
import ConfigProblemPage from './pages/ConfigProblemPage';
import './index.css';

const root = createRoot(document.getElementById('root')!);

// A configuração é validada ANTES de renderizar: sem serviços válidos não há interface "de mentira".
void initRuntime().then((runtime) => {
  root.render(
    <StrictMode>
      <ThemeProvider>
        {runtime.kind === 'invalid' ? (
          <ConfigProblemPage problems={runtime.problems} />
        ) : (
          <ToastProvider>
            <BrowserRouter>
              <AuthProvider>
                <SessionProvider>
                  <App />
                </SessionProvider>
              </AuthProvider>
            </BrowserRouter>
          </ToastProvider>
        )}
      </ThemeProvider>
    </StrictMode>,
  );
});
