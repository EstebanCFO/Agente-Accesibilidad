import { Router } from 'express';
import { validateConfig, redactConfig } from '../config/validate-config.js';

export function createRouter({ jobStore, agentLoopFactory }) {
  const router = Router();

  router.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  router.post('/jobs', (req, res) => {
    const { valid, errors, config } = validateConfig(req.body);
    if (!valid) {
      return res.status(400).json({ error: 'invalid_config', details: errors });
    }
    let job;
    try {
      job = jobStore.createJob(redactConfig(config));
    } catch (err) {
      return res.status(409).json({ error: 'job_already_exists', details: [err.message] });
    }
    const agentLoop = agentLoopFactory(config);
    agentLoop.run(job.job_id).catch((err) => {
      jobStore.updateJob(job.job_id, { status: 'failed', stop_reason: err.message });
    });
    return res.status(201).json({ job_id: job.job_id, status: job.status });
  });

  router.get('/jobs/:id', (req, res) => {
    const job = jobStore.getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'job_not_found' });
    }
    return res.status(200).json({
      job_id: job.job_id,
      status: job.status,
      phase: job.phase,
      progress: job.progress,
      current_action: job.current_action,
      iterations: job.iterations,
      started_at: job.started_at,
      estimated_completion: job.estimated_completion,
      reports: job.reports
    });
  });

  return router;
}
