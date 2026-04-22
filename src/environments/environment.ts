export const environment = {
  production: false,
  apiUrl: 'http://localhost:5001/api',
  signalR: {
    debounceMs: 500,
    pollerIntervalMs: 300000, // 5 minutes drift clearing
    ghostingWindowMs: 10000
  }
};
