import axios from 'axios';

export const TOKEN_KEY = 'wms_token';
export const ACTIVE_WAREHOUSE_KEY = 'wms_active_warehouse';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '/api',
});

// Attach JWT + active warehouse (admin selector) to every request.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  const activeWarehouse = localStorage.getItem(ACTIVE_WAREHOUSE_KEY);
  // '__all__' means the admin chose "All sites" — send no override (see all).
  if (activeWarehouse && activeWarehouse !== '__all__') {
    config.headers['X-Warehouse-Id'] = activeWarehouse;
  }
  return config;
});

// On 401, clear the token and bounce to login
api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  },
);

export default api;
