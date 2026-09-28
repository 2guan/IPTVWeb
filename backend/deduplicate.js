import db, { query, run } from './db.js';

function orderSourcesForRetention(a, b) {
  const aIsSubscription = a.subscription_id !== null ? 1 : 0;
  const bIsSubscription = b.subscription_id !== null ? 1 : 0;
  if (aIsSubscription !== bIsSubscription) {
    return bIsSubscription - aIsSubscription;
  }
  return a.id - b.id;
}

export function deduplicateSourcesByUrl() {
  const duplicates = query(`
    SELECT url, COUNT(*) as count
    FROM sources
    WHERE url IS NOT NULL AND TRIM(url) != ''
    GROUP BY url
    HAVING COUNT(*) > 1
  `);

  const idsToDelete = [];

  db.exec('BEGIN TRANSACTION');
  try {
    for (const duplicate of duplicates) {
      const sourcesWithUrl = query(
        'SELECT id, subscription_id FROM sources WHERE url = ?',
        duplicate.url
      );

      sourcesWithUrl.sort(orderSourcesForRetention);
      idsToDelete.push(...sourcesWithUrl.slice(1).map(source => source.id));
    }

    if (idsToDelete.length > 0) {
      const batchSize = 500;
      for (let i = 0; i < idsToDelete.length; i += batchSize) {
        const batch = idsToDelete.slice(i, i + batchSize);
        const placeholders = batch.map(() => '?').join(',');
        run(`DELETE FROM sources WHERE id IN (${placeholders})`, ...batch);
      }
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return {
    duplicateGroups: duplicates.length,
    deleted: idsToDelete.length
  };
}
