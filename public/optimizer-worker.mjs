import { optimize } from './calculator.mjs';
self.onmessage = event => {
  try { self.postMessage({ result: optimize(event.data) }); }
  catch (error) { self.postMessage({ error: error.message }); }
};
