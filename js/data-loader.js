/**
 * data-loader.js — fetches the dashboard's JSON files.
 *
 * This is the ONE place that knows where data comes from. To use a real API,
 * change `BASE_PATH` / `loadData` and keep the returned shapes documented in
 * README.md. The rest of the app only calls `loadData(name)`.
 */

/** Folder the sample JSON lives in (relative to index.html). */
const BASE_PATH = 'data/';

/**
 * Demo only: guarantee the loading skeleton is visible for a moment, so the
 * loading state can be seen even though local files load instantly.
 * Set to 0 when wiring a real API.
 */
export const MIN_LOADING_MS = 700;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Error with a user-friendly message and the HTTP status (0 = network). */
export class DataError extends Error {
  constructor(message, { status = 0, url = '' } = {}) {
    super(message);
    this.name = 'DataError';
    this.status = status;
    this.url = url;
  }
}

async function fetchJSON(url) {
  let response;
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch {
    // Typical when index.html is opened straight from disk (file://).
    throw new DataError('Network request failed. Serve the folder over HTTP (see README).', { url });
  }
  if (!response.ok) {
    throw new DataError(`Request failed with status ${response.status}.`, { status: response.status, url });
  }
  try {
    return await response.json();
  } catch {
    throw new DataError('The response was not valid JSON.', { status: response.status, url });
  }
}

const cache = new Map();

/**
 * Load `data/<name>.json`.
 * @param {string} name   'overview' or 'report'
 * @param {{force?: boolean}} [options]  force = bypass the in-memory cache (used by Retry)
 * @returns {Promise<object>}
 * @throws {DataError}
 */
export async function loadData(name, { force = false } = {}) {
  const url = `${BASE_PATH}${name}.json`;
  if (!force && cache.has(url)) return cache.get(url);
  const [data] = await Promise.all([fetchJSON(url), wait(MIN_LOADING_MS)]);
  cache.set(url, data);
  return data;
}
