import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import './index.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('No #root element — index.html and this entry point disagree.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
