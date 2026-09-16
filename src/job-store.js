function assertJobExists(job, jobId) {
  if (!job) {
    throw new Error(`Job no encontrado: ${jobId}`);
  }
}

export class JobStore {
  constructor() {
    this.jobs = new Map();
  }

  createJob(config) {
    const job = {
      job_id: config.job_id,
      status: 'pending',
      phase: 'INIT',
      progress: { urls_total: 0, urls_scanned: 0, urls_failed: 0, urls_enriched: 0, percentage: 0 },
      current_action: null,
      iterations: 0,
      started_at: new Date().toISOString(),
      estimated_completion: null,
      reports: [],
      stop_reason: null,
      logs: [],
      config
    };
    this.jobs.set(job.job_id, job);
    return job;
  }

  getJob(jobId) {
    return this.jobs.get(jobId);
  }

  updateJob(jobId, patch) {
    const job = this.jobs.get(jobId);
    assertJobExists(job, jobId);
    const updated = { ...job, ...patch };
    if (patch.progress) {
      updated.progress = { ...job.progress, ...patch.progress };
    }
    this.jobs.set(jobId, updated);
    return updated;
  }

  appendLog(jobId, { level, message }) {
    const job = this.jobs.get(jobId);
    assertJobExists(job, jobId);
    job.logs.push({ timestamp: new Date().toISOString(), level, message });
    return job;
  }

  listJobs() {
    return Array.from(this.jobs.values());
  }
}
