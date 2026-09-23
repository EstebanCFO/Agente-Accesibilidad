import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPromptBroker } from './demo-prompt-broker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const STEP_LABELS = [
  'Descubrir', 'Escanear', 'Clasificar contra ONTI/BCRA',
  'Revisión visual con IA', 'Revisión de UX con IA', 'Generar el dashboard ejecutivo'
];

export function createDemoServer() {
  const app = express();
  app.use(express.json());
  const broker = createPromptBroker();
  const sseClients = new Set();

  function pushEvent(type, data) {
    const frame = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of sseClients) res.write(frame);
  }

  app.get('/panel', (req, res) => {
    res.sendFile(path.join(__dirname, 'demo-panel.html'));
  });

  app.get('/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    res.write('\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
  });

  app.post('/answer', (req, res) => {
    const { id, value } = req.body ?? {};
    const ok = broker.answer(id, value);
    res.status(ok ? 200 : 409).json({ ok });
  });

  async function askPanel(spec) {
    const { id, promise } = broker.ask();
    pushEvent('prompt', { id, ...spec });
    return promise;
  }

  function pushStep(activeStepNumber) {
    const steps = STEP_LABELS.map((label, i) => ({
      label,
      state: i < activeStepNumber - 1 ? 'done' : i === activeStepNumber - 1 ? 'active' : 'pending'
    }));
    pushEvent('step', { steps });
  }

  function pushLog(message) {
    pushEvent('log', { message });
  }

  function cancelPending(reason) {
    broker.cancelPending(reason);
  }

  return { app, askPanel, pushStep, pushLog, cancelPending };
}
