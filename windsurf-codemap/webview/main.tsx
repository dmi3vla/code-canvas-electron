import { createRoot } from 'react-dom/client';
import { App } from './components/App';
import { ExtensionBridgeProvider, createVsCodeApi, isElectronStandalone, getElectronApi } from './extensionBridge';
import './components/styles.css';

const container = document.getElementById('root');
if (container) {
  const api = createVsCodeApi();
  const electronApi = isElectronStandalone() ? getElectronApi() : null;
  const root = createRoot(container);
  root.render(
    <ExtensionBridgeProvider api={api} electronApi={electronApi}>
      <App />
    </ExtensionBridgeProvider>
  );
}
