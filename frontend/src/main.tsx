import '@maxhub/max-ui/dist/styles.css';
import '@fontsource/jetbrains-mono/700.css';
import '@fontsource/jetbrains-mono/800.css';
import './shared/theme.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { session } from './api/index.ts';
import { App } from './app/App.tsx';
import { Root } from './app/Root.tsx';

const container = document.getElementById('root');
if (container === null) throw new Error('Root element is missing');

createRoot(container).render(
  <StrictMode>
    <Root>
      <App />
    </Root>
  </StrictMode>,
);

void session.start();
