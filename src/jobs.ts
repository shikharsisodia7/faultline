/**
 * Background jobs, run by AppJobRoom (worker.ts).
 *
 *  - `ingest-source`: normalize an uploaded evidence file, correlate, persist.
 *  - `import-demo`:   generate a synthetic demo incident with the simulator and
 *                     ingest it through the same pipeline (used by "Copy to my
 *                     workspace").
 *
 * Jobs are enqueued only by authorized server actions (src/actions), and the
 * handler re-checks the enqueuer's workspace role because payloads are data.
 */
import type { Job, JobContext } from 'deepspace/worker'
import type { Env } from '../worker'
import { runIngestion } from './server/ingest'

export async function runJob(job: Job, ctx: JobContext, env: Env): Promise<unknown> {
  switch (job.type) {
    case 'ingest-source':
    case 'import-demo':
      return runIngestion(job, ctx, env)
    default:
      throw new Error(`Unknown job type: ${job.type}`)
  }
}
