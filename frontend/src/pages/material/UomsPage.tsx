import { useEffect, useState, type FormEvent } from 'react';
import axios from 'axios';
import api from '../../lib/api';
import Modal from '../../components/Modal';
import FormField, { requiredErrors } from '../../components/form/FormField';
import type { Uom } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';

interface FormState {
  uomName: string;
  uomCode: string;
  isActive: boolean;
}

const emptyForm: FormState = { uomName: '', uomCode: '', isActive: true };

export default function UomsPage() {
  const { has } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const canCreate = has('uoms:create');
  const canUpdate = has('uoms:update');
  const canDelete = has('uoms:delete');

  const [items, setItems] = useState<Uom[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Uom | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const r = await api.get<Uom[]>('/uoms');
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
  function openEdit(it: Uom) {
    setEditing(it);
    setForm({ uomName: it.uomName, uomCode: it.uomCode, isActive: it.isActive });
    setError('');
    setFieldErrors({});
    setModalOpen(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const errs = requiredErrors([
      ['uomCode', form.uomCode, 'Code is required'],
      ['uomName', form.uomName, 'Name is required'],
    ]);
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/uoms/${editing.id}`, form);
      } else {
        await api.post('/uoms', form);
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

  async function handleDelete(it: Uom) {
    const ok = await confirm({
      title: 'Delete UOM?',
      description: `"${it.uomName}" will be permanently deleted.`,
      type: 'danger',
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/uoms/${it.id}`);
      toast.success('UOM deleted');
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
            Units of Measure
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Master data of UOM used by materials.
          </p>
        </div>
        {canCreate && (
          <button className="btn-primary" onClick={openCreate}>
            + Add UOM
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
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-6 py-10 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-10 text-center text-slate-400">
                    No UOM yet.
                  </td>
                </tr>
              ) : (
                items.map((it) => (
                  <tr key={it.id} className="hover:bg-slate-50">
                    <td className="px-6 py-3 font-medium text-slate-800">
                      {it.uomCode}
                    </td>
                    <td className="px-6 py-3 text-slate-600">{it.uomName}</td>
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
        title={editing ? 'Edit UOM' : 'Add UOM'}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Code" required error={fieldErrors.uomCode}>
              <input
                className="input"
                value={form.uomCode}
                onChange={(e) => {
                  setForm({ ...form, uomCode: e.target.value });
                  setFieldErrors((p) => ({ ...p, uomCode: '' }));
                }}
                placeholder="pcs"
              />
            </FormField>
            <FormField label="Name" required error={fieldErrors.uomName}>
              <input
                className="input"
                value={form.uomName}
                onChange={(e) => {
                  setForm({ ...form, uomName: e.target.value });
                  setFieldErrors((p) => ({ ...p, uomName: '' }));
                }}
                placeholder="Pieces"
              />
            </FormField>
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
