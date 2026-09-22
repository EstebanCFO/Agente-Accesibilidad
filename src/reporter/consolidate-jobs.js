function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Agrega los score-compliance.json de varios jobs (uno por canal: home_banking, app_ios,
 * app_android) en un reporte consolidado (SPEC §6.1/§8.2, decisión D5). No toca el filesystem
 * ni el Job Store — recibe los score docs ya cargados, así queda testeable sin I/O.
 *
 * Peso del score global: la SPEC pide "score global ponderado" pero no dice por qué ponderar.
 * Se pondera por `total_urls_evaluated` de cada canal (un canal con más URLs evaluadas pesa
 * más en el promedio) — decisión de diseño explícita, documentada acá y en el propio reporte.
 */
export function consolidateJobs(channelReports) {
  if (!Array.isArray(channelReports) || channelReports.length === 0) {
    throw new Error('consolidateJobs requiere al menos un reporte de canal');
  }

  const channels = channelReports.map(({ jobId, channel, score }) => ({
    job_id: jobId,
    channel,
    onti_criteria_compliant: score.summary.onti_criteria_compliant,
    onti_criteria_evaluated: score.summary.onti_criteria_evaluated,
    onti_compliance_percentage: score.summary.onti_compliance_percentage,
    onti_conformance: score.summary.onti_conformance,
    total_urls_evaluated: score.summary.total_urls_evaluated
  }));

  const totalUrls = channels.reduce((sum, c) => sum + c.total_urls_evaluated, 0);
  const weightedCompliance = totalUrls === 0
    ? round2(channels.reduce((sum, c) => sum + c.onti_compliance_percentage, 0) / channels.length)
    : round2(channels.reduce((sum, c) => sum + c.onti_compliance_percentage * c.total_urls_evaluated, 0) / totalUrls);

  return {
    generated_at: new Date().toISOString(),
    channels,
    global: {
      weighted_onti_compliance_percentage: weightedCompliance,
      weighting_method: 'total_urls_evaluated',
      channels_conformant: channels.filter((c) => c.onti_conformance).length,
      channels_total: channels.length,
      total_urls_evaluated: totalUrls
    }
  };
}
