const STATUS_RANK = { nok: 3, a_validar: 2, ok: 1, no_aplica: 0 };

function count(criteria) {
  const n = (s) => criteria.filter((c) => c.status === s).length;
  return { total: criteria.length - n('no_aplica'), ok: n('ok'), nok: n('nok'), a_validar: n('a_validar'), no_aplica: n('no_aplica') };
}

/**
 * Agrega los score-compliance.json de varios jobs (uno por canal: home_banking, app_ios,
 * app_android) en un reporte consolidado (SPEC §6.1/§8.2, decisión D5). No toca el filesystem
 * ni el Job Store — recibe los score docs ya cargados, así queda testeable sin I/O.
 *
 * Sin veredicto ni porcentaje ponderado (spec 2026-09-30): cada canal muestra su conteo
 * OK / NOK / a validar, y el global combina criterio por criterio con el peor caso entre canales
 * (NOK si falla en alguno; si no, a validar si está pendiente en alguno; OK si está OK donde
 * aplica; no aplica solo si no aplica en ninguno).
 */
export function consolidateJobs(channelReports) {
  if (!Array.isArray(channelReports) || channelReports.length === 0) {
    throw new Error('consolidateJobs requiere al menos un reporte de canal');
  }
  for (const { jobId, score } of channelReports) {
    if (!score?.wcag_section?.by_criterion) {
      throw new Error(`El reporte del job ${jobId} no trae la Sección 1 (conteo OK/NOK/a validar): fue generado con una versión anterior del agente. Volvé a correr ese canal.`);
    }
  }

  const channels = channelReports.map(({ jobId, channel, score }) => ({
    job_id: jobId,
    channel,
    ...count(score.wcag_section.by_criterion.filter((c) => c.in_scope === 'onti')),
    total_urls_evaluated: score.summary?.total_urls_evaluated ?? 0
  }));

  const worst = new Map();
  for (const { score } of channelReports) {
    for (const c of score.wcag_section.by_criterion.filter((x) => x.in_scope === 'onti')) {
      const current = worst.get(c.wcag_criterion);
      if (!current || STATUS_RANK[c.status] > STATUS_RANK[current.status]) worst.set(c.wcag_criterion, c);
    }
  }
  const combined = [...worst.values()];

  return {
    generated_at: new Date().toISOString(),
    channels,
    global: {
      ...count(combined),
      channels_total: channels.length,
      channels_con_nok: channels.filter((c) => c.nok > 0).length,
      total_urls_evaluated: channels.reduce((sum, c) => sum + c.total_urls_evaluated, 0)
    }
  };
}
