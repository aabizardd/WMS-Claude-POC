import { useEffect, useState, type FormEvent } from 'react';
import axios from 'axios';
import api from '../lib/api';
import Modal from './Modal';
import FormField, { requiredErrors } from './form/FormField';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../context/ConfirmContext';
import { useSort } from '../hooks/useSort';
import SortableTh from './SortableTh';
import type { Paginated } from '../types';

const LIMIT = 10;

// Minimal code+name+active master CRUD (Area Types / Aisles / Shelves).
export interface MasterConfig {
  title: string;
  subtitle: string;
  endpoint: string; // e.g. "/area-types"
  permission: string; // e.g. "area-types"
  codeKey: string; // e.g. "areaTypeCode"
  nameKey: string; // e.g. "areaTypeName"
  codeLabel: string;
  nameLabel: string;
  addLabel: string;
}

type Item = Record<string, unknown> & {
  id: string;
  isActive: boolean;
  _count?: { bins: number };
};

export default function SimpleMasterPage({ config }: { config: MasterConfig }) {
  const { has } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const canCreate = has(`${config.permission}:create`);
  const canUpdate = has(`${config.permission}:update`);
  const canDelete = has(`${config.permission}:delete`);

  const [data, setData] = useState<Paginated<Item> | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const { sort, toggle, params } = useSort();
  const onSort = (col: string) => {
    setPage(1);
    toggle(col);
  };
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const items = data?.rows ?? [];
  const totalPage = data?.total_page ?? 0;

  async function load() {
    setLoading(true);
    const r = await api.get<Paginated<Item>>(config.endpoint, {
      params: { page, limit: LIMIT, search: search || undefined, ...params() },
    });
    setData(r.data);
    setLoading(false);
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.endpoint, page, search, sort.sortBy, sort.order]);

  function openCreate() {
    setEditing(null);
    setCode('');
    setName('');
    setIsActive(true);
    setError('');
    setFieldErrors({});
    setModalOpen(true);
  }
  function openEdit(it: Item) {
    setEditing(it);
    setCode(String(it[config.codeKey] ?? ''));
    setName(String(it[config.nameKey] ?? ''));
    setIsActive(it.isActive);
    setError('');
    setFieldErrors({});
    setModalOpen(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const errs = requiredErrors([
      ['code', code, `${config.codeLabel} is required`],
      ['name', name, `${config.nameLabel} is required`],
    ]);
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setSaving(true);
    const payload = {
      [config.codeKey]: code,
      [config.nameKey]: name,
      isActive,
    };
    try {
      if (editing) await api.put(`${config.endpoint}/${editing.id}`, payload);
      else await api.post(config.endpoint, payload);
      setModalOpen(false);
      toast.success(editing ? 'Saved' : 'Created');
      await load();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg = err.response?.data?.message;
        setError(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Save failed');
      } else setError('Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(it: Item) {
    const ok = await confirm({
      title: `Delete ${config.title}?`,
      description: `"${String(it[config.nameKey] ?? '')}" will be permanently deleted.`,
      type: 'danger',
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`${config.endpoint}/${it.id}`);
      toast.success('Deleted');
      await load();
    } catch (err) {
      if (axios.isAxiosError(err))
        toast.error(err.response?.data?.message ?? 'Delete failed');
      else toast.error('Delete failed');
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">
            {config.title}
          </h1>
          <p className="mt-1 text-sm text-slate-500">{config.subtitle}</p>
        </div>
        {canCreate && (
          <button className="btn-primary" onClick={openCreate}>
            {config.addLabel}
          </button>
        )}
      </div>

      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setPage(1);
          setSearch(searchInput.trim());
        }}
        className="flex gap-2"
      >
        <input
          className="input max-w-xs"
          placeholder={`Search ${config.codeLabel.toLowerCase()} / ${config.nameLabel.toLowerCase()}…`}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <button type="submit" className="btn-secondary">
          Search
        </button>
        {search && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setSearchInput('');
              setSearch('');
              setPage(1);
            }}
          >
            Clear
          </button>
        )}
      </form>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <SortableTh label={config.codeLabel} col="code" sort={sort} onSort={onSort} />
                <SortableTh label={config.nameLabel} col="name" sort={sort} onSort={onSort} />
                <SortableTh label="Bins" col="bins" sort={sort} onSort={onSort} />
                <SortableTh label="Status" col="status" sort={sort} onSort={onSort} />
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-slate-400">
                    No data found.
                  </td>
                </tr>
              ) : (
                items.map((it) => (
                  <tr key={it.id} className="hover:bg-slate-50">
                    <td className="px-6 py-3 font-medium text-slate-800">
                      {String(it[config.codeKey] ?? '')}
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {String(it[config.nameKey] ?? '')}
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {it._count?.bins ?? 0}
                    </td>
                    <td className="px-6 py-3">
                      {it.isActive ? (
                        <span className="text-xs font-medium text-emerald-600">
                          Active
                        </span>
                      ) : (
                        <span className="text-xs font-medium text-slate-400">
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex justify-end gap-2">
                        {canUpdate && (
                          <button
                            onClick={() => openEdit(it)}
                            className="rounded-md px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50"
                          >
                            Edit
                          </button>
                        )}
                        {canDelete && (
                          <button
                            onClick={() => handleDelete(it)}
                            className="rounded-md px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                          >
                            Delete
                          </button>
                        )}
                        {!canUpdate && !canDelete && (
                          <span className="text-xs text-slate-300">—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPage > 1 && (
          <div className="flex items-center justify-between border-t border-slate-200 px-6 py-3 text-sm">
            <span className="text-slate-500">
              Page {page} of {totalPage}
            </span>
            <div className="flex gap-2">
              <button
                className="btn-secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Prev
              </button>
              <button
                className="btn-secondary"
                disabled={page >= totalPage}
                onClick={() => setPage((p) => Math.min(totalPage, p + 1))}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      <Modal
        open={modalOpen}
        title={editing ? `Edit ${config.title}` : config.addLabel}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label={config.codeLabel} required error={fieldErrors.code}>
              <input
                className="input"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  setFieldErrors((p) => ({ ...p, code: '' }));
                }}
              />
            </FormField>
            <FormField label={config.nameLabel} required error={fieldErrors.name}>
              <input
                className="input"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setFieldErrors((p) => ({ ...p, name: '' }));
                }}
              />
            </FormField>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            Active
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setModalOpen(false)}
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
