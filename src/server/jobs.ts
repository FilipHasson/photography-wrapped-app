import { EventEmitter } from "node:events";

/**
 * Long-running work (indexing a library, scanning a card) runs as a job so the
 * browser can watch it rather than hold a request open for four minutes.
 *
 * Only one job runs at a time, deliberately. Everything writes through a single
 * synchronous SQLite connection, so two jobs interleaving transactions would
 * corrupt each other's batches — and there is nothing to gain, since the work
 * is disk bound either way.
 */

export type JobKind = "index" | "scan";
export type JobStatus = "running" | "done" | "error" | "cancelled";

export interface JobProgress {
  message: string;
  done: number;
  total: number;
}

export interface Job {
  id: string;
  kind: JobKind;
  label: string;
  status: JobStatus;
  progress: JobProgress;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
  result: unknown;
}

export interface JobEvent {
  type: "job";
  job: Job;
}

type Runner = (
  report: (progress: Partial<JobProgress>) => void,
  signal: AbortSignal,
) => Promise<unknown>;

export class JobManager extends EventEmitter {
  #jobs = new Map<string, Job>();
  #active: { job: Job; controller: AbortController } | null = null;
  #nextId = 1;

  get active(): Job | null {
    return this.#active?.job ?? null;
  }

  list(): Job[] {
    return [...this.#jobs.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, 20);
  }

  get(id: string): Job | undefined {
    return this.#jobs.get(id);
  }

  /**
   * Starts a job, or throws if one is already running. Callers surface the
   * message directly, so it explains what is in the way.
   */
  start(kind: JobKind, label: string, runner: Runner): Job {
    if (this.#active) {
      throw new Error(`Busy: "${this.#active.job.label}" is still running.`);
    }

    const job: Job = {
      id: String(this.#nextId++),
      kind,
      label,
      status: "running",
      progress: { message: "Starting", done: 0, total: 0 },
      startedAt: Date.now(),
      finishedAt: null,
      error: null,
      result: null,
    };

    const controller = new AbortController();
    this.#jobs.set(job.id, job);
    this.#active = { job, controller };
    this.#publish(job);

    const report = (progress: Partial<JobProgress>) => {
      job.progress = { ...job.progress, ...progress };
      this.#publish(job);
    };

    void runner(report, controller.signal)
      .then((result) => {
        job.status = controller.signal.aborted ? "cancelled" : "done";
        job.result = result;
      })
      .catch((err: unknown) => {
        const aborted =
          controller.signal.aborted || (err instanceof Error && err.name === "AbortError");
        job.status = aborted ? "cancelled" : "error";
        job.error = aborted ? null : err instanceof Error ? err.message : String(err);
      })
      .finally(() => {
        job.finishedAt = Date.now();
        this.#active = null;
        this.#publish(job);
      });

    return job;
  }

  cancel(id: string): boolean {
    if (this.#active?.job.id !== id) return false;
    this.#active.controller.abort();
    return true;
  }

  #publish(job: Job): void {
    // Emit a copy: the job object keeps mutating, and an SSE frame should
    // capture the state at the moment it was sent.
    this.emit("job", { type: "job", job: { ...job, progress: { ...job.progress } } });
  }
}
