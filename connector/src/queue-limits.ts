// The Durable Object that keeps the queue's exact posting limits (the rules are in src/core/queue/limits.ts). There is one,
// named "queue". It handles one request at a time (blockConcurrencyWhile), so two posts can never both read the same count.
// It is exported from src/worker.ts and bound as QUEUE_LIMITS in wrangler.jsonc.

import { type LimitsPort, type LimitsStorage, type Outcome, type Reservation, type ReserveRequest, type Ticket, finish, reserve } from './core/queue/limits';

type Call = { op: 'reserve'; request: ReserveRequest } | { op: 'finish'; ticket: Ticket; outcome: Outcome; now: number };

export class QueueLimits {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const call = (await request.json()) as Call;
    const storage = this.state.storage as unknown as LimitsStorage;
    return this.state.blockConcurrencyWhile(async () => {
      if (call.op === 'reserve') return Response.json(await reserve(storage, call.request));
      if (call.op === 'finish') {
        await finish(storage, call.ticket, call.outcome, call.now);
        return Response.json({ ok: true });
      }
      return new Response('Unknown call', { status: 400 });
    });
  }
}

/** The queue service's way to the object. Throws when the object does not answer, so the service can say so plainly. */
export function limitsFor(namespace: DurableObjectNamespace): LimitsPort {
  const call = async <T>(body: Call): Promise<T> => {
    const stub = namespace.get(namespace.idFromName('queue'));
    const res = await stub.fetch('https://queue-limits/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`The queue limits answered ${res.status}`);
    return (await res.json()) as T;
  };
  return {
    reserve: (request) => call<Reservation>({ op: 'reserve', request }),
    finish: async (ticket, outcome, now) => {
      await call({ op: 'finish', ticket, outcome, now });
    },
  };
}
