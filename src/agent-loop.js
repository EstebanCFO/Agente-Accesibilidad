function buildInitialPrompt(config) {
  return [
    `Sos el cerebro del Agente F1 de compliance de accesibilidad digital.`,
    `Canal: ${config.target.channel}. Modo: ${config.target.mode}.`,
    `Base normativa: ONTI Disp. 6/2019 (38 criterios WCAG 2.0 A+AA, umbral ${config.wcag.conformance_threshold}/38).`,
    `Config completa: ${JSON.stringify(config)}`,
    `Decidí la próxima herramienta a ejecutar. Nunca asumas éxito: evaluá siempre el resultado real de la herramienta anterior.`
  ].join('\n');
}

export class AgentLoop {
  constructor({ anthropicClient, toolRegistry, jobStore, maxIterations = 30, model = 'claude-sonnet-5' }) {
    this.anthropicClient = anthropicClient;
    this.toolRegistry = toolRegistry;
    this.jobStore = jobStore;
    this.maxIterations = maxIterations;
    this.model = model;
  }

  async run(jobId) {
    const initialJob = this.jobStore.getJob(jobId);
    if (!initialJob) {
      throw new Error(`Job no encontrado: ${jobId}`);
    }
    this.jobStore.updateJob(jobId, { status: 'running' });

    const messages = [{ role: 'user', content: buildInitialPrompt(initialJob.config) }];

    while (true) {
      const job = this.jobStore.getJob(jobId);
      if (job.iterations >= this.maxIterations) {
        this.jobStore.updateJob(jobId, { status: 'failed', stop_reason: 'max_iterations_reached' });
        break;
      }

      const response = await this.anthropicClient.messages.create({
        model: this.model,
        max_tokens: 1024,
        tools: this.toolRegistry.schemas,
        messages
      });

      this.jobStore.updateJob(jobId, { iterations: job.iterations + 1 });
      messages.push({ role: 'assistant', content: response.content });

      const toolUseBlocks = response.content.filter((block) => block.type === 'tool_use');

      if (toolUseBlocks.length === 0) {
        const finalJob = this.jobStore.getJob(jobId);
        if (finalJob.status !== 'blocked') {
          this.jobStore.updateJob(jobId, { status: 'completed' });
        }
        break;
      }

      const toolResults = [];
      for (const block of toolUseBlocks) {
        try {
          const result = await this.toolRegistry.execute(block.name, block.input, jobId);
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
        } catch (err) {
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ error: err.message }), is_error: true });
        }
      }
      messages.push({ role: 'user', content: toolResults });

      if (this.jobStore.getJob(jobId).status === 'blocked') {
        break;
      }
    }

    return this.jobStore.getJob(jobId);
  }
}
