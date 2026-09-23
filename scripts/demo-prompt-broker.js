export function createPromptBroker() {
  let pending = null;
  let nextId = 1;

  function ask() {
    if (pending) throw new Error('Ya hay un prompt pendiente sin responder');
    const id = String(nextId++);
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    pending = { id, resolve, reject };
    return { id, promise };
  }

  function answer(id, value) {
    if (!pending || pending.id !== id) return false;
    const { resolve } = pending;
    pending = null;
    resolve(value);
    return true;
  }

  function cancelPending(reason) {
    if (!pending) return false;
    const { reject } = pending;
    pending = null;
    reject(reason instanceof Error ? reason : new Error(String(reason)));
    return true;
  }

  function hasPending() {
    return pending !== null;
  }

  return { ask, answer, cancelPending, hasPending };
}
