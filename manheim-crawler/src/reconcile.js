// src/reconcile.js
export function reconcile(enqueuedUrls, storedUrls) {
  const stored = new Set(storedUrls);
  const missing = [...new Set(enqueuedUrls)].filter((u) => !stored.has(u));
  return {
    expected: new Set(enqueuedUrls).size,
    stored: stored.size,
    missing,
    ok: missing.length === 0,
  };
}
