import { Router } from 'express';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { validateConfig, redactConfig } from '../config/validate-config.js';

const CONTENT_TYPES = {
  '.json': 'application/json',
  '.html': 'text/html; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'];

export function createRouter({ jobStore, agentLoopFactory, toolRegistry }) {
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

  router.get('/jobs/:id/reports', (req, res) => {
    const job = jobStore.getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'job_not_found' });
    }
    const reports = (job.reports || []).map((filename) => ({
      filename,
      url: `/api/jobs/${job.job_id}/reports/${encodeURIComponent(filename)}`
    }));
    return res.status(200).json({ job_id: job.job_id, reports });
  });

  router.get('/jobs/:id/reports/:file', async (req, res) => {
    const job = jobStore.getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'job_not_found' });
    }
    // Whitelist estricto contra job.reports (nombres ya conocidos, sin separadores de path)
    // en vez de confiar en req.params.file: cierra cualquier vector de path traversal.
    if (!(job.reports || []).includes(req.params.file)) {
      return res.status(404).json({ error: 'report_not_found' });
    }
    const filePath = path.join(job.config.output?.path ?? './reports', job.job_id, req.params.file);
    try {
      const content = await readFile(filePath);
      const contentType = CONTENT_TYPES[path.extname(req.params.file)] ?? 'application/octet-stream';
      return res.status(200).set('Content-Type', contentType).send(content);
    } catch {
      return res.status(404).json({ error: 'report_file_missing' });
    }
  });

  router.post('/jobs/consolidate', async (req, res) => {
    const jobIds = req.body?.job_ids;
    if (!Array.isArray(jobIds) || jobIds.length === 0) {
      return res.status(400).json({ error: 'invalid_request', details: ['job_ids es requerido y no puede estar vacío'] });
    }
    try {
      const consolidated = await toolRegistry.execute('consolidate_jobs', { job_ids: jobIds }, jobIds[0]);
      return res.status(200).json(consolidated);
    } catch (err) {
      return res.status(422).json({ error: 'consolidation_failed', details: [err.message] });
    }
  });

  router.delete('/jobs/:id', (req, res) => {
    const job = jobStore.getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'job_not_found' });
    }
    if (TERMINAL_STATUSES.includes(job.status)) {
      return res.status(409).json({ error: 'job_not_cancellable', details: [`El job ya está en estado terminal: ${job.status}`] });
    }
    jobStore.updateJob(job.job_id, { status: 'cancelled', stop_reason: 'cancelled_by_operator' });
    return res.status(200).json({ job_id: job.job_id, status: 'cancelled' });
  });

  return router;
}
