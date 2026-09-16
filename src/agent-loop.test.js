// src/agent-loop.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentLoop } from './agent-loop.js';
import { JobStore } from './job-store.js';
import { createToolRegistry } from './tools/tool-registry.js';
import { validateConfig } from './config/validate-config.js';

function setup() {
  const jobStore = new JobStore();
  const { config } = validateConfig({ job_id: 'job-1', target: { channel: 'home_banking', mode: 'url_list', urls: ['https://x.test'] } });
  jobStore.createJob(config);
  const toolRegistry = createToolRegistry({ jobStore });
  return { jobStore, toolRegistry };
}

class FakeAnthropicClient {
  constructor(responses) {
    this.responses = responses;
    this.calls = 0;
  }
  get messages() {
    return {
      create: async () => {
        const response = this.responses[Math.min(this.calls, this.responses.length - 1)];
        this.calls += 1;
        return response;
      }
    };
  }
}

test('finaliza con status completed cuando Claude no pide más tools', async () => {
  const { jobStore, toolRegistry } = setup();
  const anthropicClient = new FakeAnthropicClient([
    { content: [{ type: 'text', text: 'Listo, no hay más pasos.' }] }
  ]);
  const loop = new AgentLoop({ anthropicClient, toolRegistry, jobStore, maxIterations: 5 });
  const job = await loop.run('job-1');
  assert.equal(job.status, 'completed');
  assert.equal(job.iterations, 1);
  assert.equal(anthropicClient.calls, 1);
});

test('ejecuta un tool_use vía el tool registry y continúa el loop', async () => {
  const { jobStore, toolRegistry } = setup();
  const anthropicClient = new FakeAnthropicClient([
    { content: [{ type: 'tool_use', id: 'call_1', name: 'log_progress', input: { message: 'arrancando' } }] },
    { content: [{ type: 'text', text: 'Listo.' }] }
  ]);
  const loop = new AgentLoop({ anthropicClient, toolRegistry, jobStore, maxIterations: 5 });
  const job = await loop.run('job-1');
  assert.equal(job.status, 'completed');
  assert.equal(job.iterations, 2);
  assert.equal(job.logs.length, 1);
  assert.equal(job.logs[0].message, 'arrancando');
});

test('se detiene con status blocked cuando request_clarification bloquea el job', async () => {
  const { jobStore, toolRegistry } = setup();
  const anthropicClient = new FakeAnthropicClient([
    { content: [{ type: 'tool_use', id: 'call_1', name: 'request_clarification', input: { question: '¿Hay MFA?' } }] },
    { content: [{ type: 'text', text: 'no debería llegar acá' }] }
  ]);
  const loop = new AgentLoop({ anthropicClient, toolRegistry, jobStore, maxIterations: 5 });
  const job = await loop.run('job-1');
  assert.equal(job.status, 'blocked');
  assert.equal(anthropicClient.calls, 1);
});

test('se detiene con status failed y stop_reason max_iterations_reached al agotar iteraciones', async () => {
  const { jobStore, toolRegistry } = setup();
  const anthropicClient = new FakeAnthropicClient([
    { content: [{ type: 'tool_use', id: 'call_1', name: 'log_progress', input: { message: 'sigo' } }] }
  ]);
  const loop = new AgentLoop({ anthropicClient, toolRegistry, jobStore, maxIterations: 1 });
  const job = await loop.run('job-1');
  assert.equal(job.status, 'failed');
  assert.equal(job.stop_reason, 'max_iterations_reached');
  assert.equal(anthropicClient.calls, 1);
});

test('propaga un error de tool como tool_result con is_error sin frenar el loop', async () => {
  const { jobStore, toolRegistry } = setup();
  const anthropicClient = new FakeAnthropicClient([
    { content: [{ type: 'tool_use', id: 'call_1', name: 'crawl_site', input: { root_url: 'https://x.test' } }] },
    { content: [{ type: 'text', text: 'Entendido, sigo sin crawler.' }] }
  ]);
  const loop = new AgentLoop({ anthropicClient, toolRegistry, jobStore, maxIterations: 5 });
  const job = await loop.run('job-1');
  assert.equal(job.status, 'completed');
  assert.equal(anthropicClient.calls, 2);
});
