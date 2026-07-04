import { useEffect, useState, type FormEvent } from 'react';
import axios from 'axios';
import api from '../../lib/api';
import Modal from '../../components/Modal';
import FormField, { requiredErrors } from '../../components/form/FormField';
import type { MaterialType } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';

interface FormState {
  materialTypeName: string;
  materialTypeCode: string;
  description: string;
  isActive: boolean;
}

const emptyForm: FormState = {
  materialTypeName: '',
  materialTypeCode: '',
  description: '',
  isActive: true,
};

export default function MaterialTypesPage() {
  const { has } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const canCreate = has('material-types:create');
  const canUpdate = has('material-types:update');
  const canDelete = has('material-types:delete');

  const [items, setItems] = useState<MaterialType[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<MaterialType | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const r = await api.get<MaterialType[]>('/material-types');
    setItems(r.data);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setError('');
    setFieldErrors({});
    setModalOpen(true);
  }
  function openEdit(it: MaterialType) {
    setEditing(it);
    setForm({
      materialTypeName: it.materialTypeName,
      materialTypeCode: it.materialTypeCode,
      description: it.description ?? '',
      isActive: it.isActive,
    });
    setError('');
    setFieldErrors({});
    setModalOpen(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const errs = requiredErrors([
      ['materialTypeCode', form.materialTypeCode, 'Code is required'],
      ['materialTypeName', form.materialTypeName, 'Name is required'],
    ]);
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/material-types/${editing.id}`, form);
      } else {
        await api.post('/material-types', form);
      }
      setModalOpen(false);
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

  async function handleDelete(it: MaterialType) {
    const ok = await confirm({
      title: 'Delete type?',
      description: `"${it.materialTypeName}" will be permanently deleted.`,
      type: 'danger',
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/material-types/${it.id}`);
      toast.success('Type deleted');
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
            Material Types
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Master data of material types.
          </p>
        </div>
        {canCreate && (
          <button className="btn-primary" onClick={openCreate}>
            + Add Type
          </button>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-6 py-3">Code</th>
                <th className="px-6 py-3">Name</th>
                <th className="px-6 py-3">Description</th>
                <th className="px-6 py-3">Materials</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-slate-400">
                    No types yet.
                  </td>
                </tr>
              ) : (
                items.map((it) => (
                  <tr key={it.id} className="hover:bg-slate-50">
                    <td className="px-6 py-3 font-medium text-slate-800">
                      {it.materialTypeCode}
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {it.materialTypeName}
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {it.description || <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {it._count?.materials ?? 0}
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
      </div>

      <Modal
        open={modalOpen}
        title={editing ? 'Edit Type' : 'Add Type'}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Code" required error={fieldErrors.materialTypeCode}>
              <input
                className="input"
                value={form.materialTypeCode}
                onChange={(e) => {
                  setForm({ ...form, materialTypeCode: e.target.value });
                  setFieldErrors((p) => ({ ...p, materialTypeCode: '' }));
                }}
                placeholder="MATTYPE-001"
              />
            </FormField>
            <FormField label="Name" required error={fieldErrors.materialTypeName}>
              <input
                className="input"
                value={form.materialTypeName}
                onChange={(e) => {
                  setForm({ ...form, materialTypeName: e.target.value });
                  setFieldErrors((p) => ({ ...p, materialTypeName: '' }));
                }}
              />
            </FormField>
          </div>
          <div>
            <label className="label">Description</label>
            <textarea
              className="input"
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
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
