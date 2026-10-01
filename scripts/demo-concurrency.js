/**
 * Corre tareas asíncronas con un máximo de N en simultáneo. Cada tarea se lanza apenas se
 * libera un lugar; el resultado de cada una queda en su propia promesa para que el llamador
 * pueda esperar un subconjunto (ej: solo las revisiones visuales) sin esperar al resto.
 * Nunca rechaza: los errores quedan como { ok:false, error } para que una falla no corte las demás.
 */
export function runWithConcurrency(taskFns, limit) {
  const max = Math.max(1, Math.floor(limit) || 1);
  const settlers = [];
  const promises = taskFns.map(() => new Promise((resolve) => settlers.push(resolve)));
  let next = 0;
  let running = 0;

  function launch() {
    while (running < max && next < taskFns.length) {
      const index = next++;
      running += 1;
      Promise.resolve()
        .then(() => taskFns[index]())
        .then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }))
        .then((outcome) => {
          running -= 1;
          settlers[index](outcome);
          launch();
        });
    }
  }
  launch();
  return promises;
}
