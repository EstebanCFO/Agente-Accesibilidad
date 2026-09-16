import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRouter } from './routes.js';

export function createApp({ jobStore, agentLoopFactory }) {
  const app = express();
  app.use(express.json());
  app.use('/api', createRouter({ jobStore, agentLoopFactory }));
  return app;
}

async function bootstrap() {
  const dotenv = await import('dotenv');
  dotenv.config();
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const { JobStore } = await import('../job-store.js');
  const { createToolRegistry } = await import('../tools/tool-registry.js');
  const { AgentLoop } = await import('../agent-loop.js');

  const jobStore = new JobStore();
  const toolRegistry = createToolRegistry({ jobStore });
  const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const app = createApp({
    jobStore,
    agentLoopFactory: (config) => new AgentLoop({
      anthropicClient,
      toolRegistry,
      jobStore,
      maxIterations: config.agent.max_iterations,
      model: config.agent.model
    })
  });

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`f1-compliance-agent escuchando en puerto ${port}`);
  });
}

const isMainModule = Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMainModule) {
  bootstrap();
}
