import { hybridSearch } from '../memorySearch.js';

export const CHAT_RAG_TIMEOUT_MS = 2500;

export async function recallChatMemories(query, options = {}, search = hybridSearch) {
  let timer = null;
  const searchPromise = Promise.resolve()
    .then(() => search(query, options))
    .then(results => ({ results, timedOut: false }));
  const timeoutPromise = new Promise(resolve => {
    timer = setTimeout(() => resolve({ results: [], timedOut: true }), CHAT_RAG_TIMEOUT_MS);
  });

  try {
    return await Promise.race([searchPromise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
