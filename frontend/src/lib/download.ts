import api from './api';

/**
 * GETs a file from the API (with the session's auth and site headers) and
 * saves it under the name the server gives in Content-Disposition.
 */
export async function downloadFile(path: string, params: Record<string, unknown>, fallbackName: string) {
  const res = await api.get<Blob>(path, { params, responseType: 'blob' });
  const disposition = String(res.headers['content-disposition'] ?? '');
  const name = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
