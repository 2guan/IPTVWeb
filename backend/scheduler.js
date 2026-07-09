import cron from 'node-cron';
import { query, queryOne } from './db.js';
import { syncAllSubscriptions } from './sync.js';
import { syncEpg } from './epg.js';
import { runTestOnSources } from './tester.js';
import { runLlmOptimization } from './optimizer.js';

let tasks = {
  sync: null,
  test: null,
  epg: null,
  optimize: null
};

// Log helper
function logSchedule(name, expression) {
  console.log(`[Scheduler] Scheduled task [${name}] with cron expression: "${expression}"`);
}

/**
 * Stop and destroy all running cron tasks
 */
function destroyAllTasks() {
  for (const [name, task] of Object.entries(tasks)) {
    if (task) {
      task.stop();
      tasks[name] = null;
      console.log(`[Scheduler] Stopped task [${name}]`);
    }
  }
}

/**
 * Initialize and start cron tasks
 */
export function initScheduler() {
  destroyAllTasks();

  const settingsRows = query("SELECT key, value FROM settings WHERE key IN ('syncCron', 'testCron', 'epgCron', 'optimizeCron')");
  const cronSettings = Object.fromEntries(settingsRows.map(r => [r.key, r.value]));

  const syncExpression = cronSettings.syncCron || '';
  const testExpression = cronSettings.testCron || '';
  const epgExpression = cronSettings.epgCron || '';
  const optimizeExpression = cronSettings.optimizeCron || '';

  // 1. Subscription sync cron
  if (syncExpression && cron.validate(syncExpression)) {
    tasks.sync = cron.schedule(syncExpression, async () => {
      console.log('[Scheduler] Starting scheduled subscription sync...');
      try {
        await syncAllSubscriptions();
      } catch (err) {
        console.error('[Scheduler] Scheduled subscription sync failed:', err);
      }
    });
    logSchedule('sync', syncExpression);
  } else if (syncExpression) {
    console.error(`[Scheduler] Invalid cron expression for syncCron: "${syncExpression}"`);
  }

  // 2. Stream test cron
  if (testExpression && cron.validate(testExpression)) {
    tasks.test = cron.schedule(testExpression, async () => {
      console.log('[Scheduler] Starting scheduled channel speed test...');
      try {
        const sources = query('SELECT id, name, url, fail_count, frozen_until FROM sources');
        if (sources.length > 0) {
          await runTestOnSources(sources);
        }
      } catch (err) {
        console.error('[Scheduler] Scheduled channel test failed:', err);
      }
    });
    logSchedule('test', testExpression);
  } else if (testExpression) {
    console.error(`[Scheduler] Invalid cron expression for testCron: "${testExpression}"`);
  }

  // 3. EPG sync cron
  if (epgExpression && cron.validate(epgExpression)) {
    tasks.epg = cron.schedule(epgExpression, async () => {
      console.log('[Scheduler] Starting scheduled EPG sync...');
      try {
        await syncEpg();
      } catch (err) {
        console.error('[Scheduler] Scheduled EPG sync failed:', err);
      }
    });
    logSchedule('epg', epgExpression);
  } else if (epgExpression) {
    console.error(`[Scheduler] Invalid cron expression for epgCron: "${epgExpression}"`);
  }

  // 4. LLM Optimization cron (optional — only runs if configured)
  if (optimizeExpression && cron.validate(optimizeExpression)) {
    tasks.optimize = cron.schedule(optimizeExpression, async () => {
      console.log('[Scheduler] Starting scheduled LLM optimization...');
      try {
        await runLlmOptimization();
      } catch (err) {
        console.error('[Scheduler] Scheduled LLM optimization failed:', err);
      }
    });
    logSchedule('optimize', optimizeExpression);
  }
}

/**
 * Update scheduler (call this when settings are updated)
 */
export function updateScheduler() {
  console.log('[Scheduler] Reloading scheduler settings...');
  initScheduler();
}
