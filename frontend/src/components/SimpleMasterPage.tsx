import { useState, type FormEvent } from 'react';
import axios from 'axios';
import api from '../lib/api';
import Modal from './Modal';
import FormField, { requiredErrors } from './form/FormField';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../context/ConfirmContext';
import MasterList, { type MasterColumn } from './master/MasterList';
import { Cell, StatusPill, fmtDateTime, icons } from './master/MasterKit';

// A code + name + active master with its own add / edit form (Area, Aisle,
// Shelf, Material Category / Type, UoM), listed the WMS dev way.
export interface MasterConfig {
  /** Singular noun for titles and messages, e.g. "Aisle". */
  noun: string;
  endpoint: string; // e.g. "/aisles"
  permission: string; // e.g. "aisles"
  codeKey: string; // e.g. "aisleCode"
  nameKey: string; // e.g. "aisleName"
  /** Column headings, as on WMS dev (e.g. "Aisle ID", "Aisle Name"). */
  codeLabel: string;
  nameLabel: string;
  addLabel: string; // e.g. "Add Aisle"
  codePlaceholder?: string;
  namePlaceholder?: string;
  /** Show the number of bins / materials using each row. */
  countKey?: 'bins' | 'materials';
  /** The form has a Description field. */
  withDescription?: boolean;
  /** UoM: the "Allow decimal quantities" flag. */
  withAllowsDecimal?: boolean;
}

type Item = Record<string, unknown> & {
  id: string;
  isActive: boolean;
  description?: string | null;
  allowsDecimal?: boolean;
  createdAt?: string;
  updatedAt?: string;
  _count?: { bins?: number; materials?: number };
};

interface FormState {
  code: string;
  name: string;
  description: string;
  isActive: boolean;
  allowsDecimal: boolean;
}
const EMPTY: FormState = { code: '', name: '', description: '', isActive: true, allowsDecimal: true };

export default function SimpleMasterPage({ config }: { config: MasterConfig }) {
  const { has } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const canCreate = has(`${config.permission}:create`);
  const canUpdate = has(`${config.permission}:update`);
  const canDelete = has(`${config.permission}:delete`);

  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY);
    setError('');
    setFieldErrors({});
    setModalOpen(true);
  }
  function openEdit(it: Item) {
    setEditing(it);
    setForm({
      code: String(it[config.codeKey] ?? ''),
      name: String(it[config.nameKey] ?? ''),
      description: it.description ?? '',
      isActive: it.isActive,
      allowsDecimal: it.allowsDecimal ?? true,
    });
    setError('');
    setFieldErrors({});
    setModalOpen(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const errs = requiredErrors([
      ['code', form.code, 'Code is required'],
      ['name', form.name, 'Name is required'],
    ]);
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setSaving(true);
    const payload: Record<string, unknown> = {
      [config.codeKey]: form.code,
      [config.nameKey]: form.name,
      isActive: form.isActive,
    };
    if (config.withDescription) payload.description = form.description;
    if (config.withAllowsDecimal) payload.allowsDecimal = form.allowsDecimal;
    try {
      if (editing) await api.put(`${config.endpoint}/${editing.id}`, payload);
      else await api.post(config.endpoint, payload);
      setModalOpen(false);
      toast.success(editing ? 'Saved' : 'Created');
      reload();
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
      title: `Delete ${config.noun}?`,
      description: `"${String(it[config.nameKey] ?? '')}" will be permanently deleted.`,
      type: 'danger',
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`${config.endpoint}/${it.id}`);
      toast.success('Deleted');
      reload();
    } catch (err) {
      if (axios.isAxiosError(err)) toast.error(err.response?.data?.message ?? 'Delete failed');
      else toast.error('Delete failed');
    }
  }

  const columns: MasterColumn<Item>[] = [
    { label: 'Status', sortKey: 'status', width: 120, render: (it) => <StatusPill active={it.isActive} /> },
    { label: config.codeLabel, sortKey: 'code', render: (it) => <Cell>{String(it[config.codeKey] ?? '')}</Cell> },
    { label: config.nameLabel, sortKey: 'name', render: (it) => <Cell>{String(it[config.nameKey] ?? '')}</Cell> },
  ];
  if (config.countKey) {
    const key = config.countKey;
    columns.push({
      label: key === 'bins' ? 'Bins' : 'Materials',
      sortKey: key,
      render: (it) => <Cell>{it._count?.[key] ?? 0}</Cell>,
    });
  }
  if (config.withAllowsDecimal) {
    columns.push({ label: 'Allow Decimal', render: (it) => <Cell>{it.allowsDecimal ?? true ? 'Yes' : 'No'}</Cell> });
  }
  columns.push(
    { label: 'Created At', render: (it) => <Cell>{fmtDateTime(it.createdAt)}</Cell> },
    { label: 'Last Modified At', render: (it) => <Cell>{fmtDateTime(it.updatedAt)}</Cell> },
  );

  return (
    <>
      <MasterList<Item>
        endpoint={config.endpoint}
        columns={columns}
        reloadKey={reloadKey}
        addLabel={canCreate ? config.addLabel : undefined}
        onAdd={openCreate}
        rowActions={
          canUpdate || canDelete
            ? (it) => [
                ...(canUpdate ? [{ label: 'Edit', icon: icons.pencil, onClick: () => openEdit(it) }] : []),
                ...(canDelete
                  ? [{ label: 'Delete', icon: icons.trash, onClick: () => handleDelete(it) }]
                  : []),
              ]
            : undefined
        }
      />

      <Modal
        open={modalOpen}
        title={editing ? `Edit ${config.noun}` : config.addLabel}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Code" required error={fieldErrors.code}>
              <input
                className="input"
                value={form.code}
                placeholder={config.codePlaceholder}
                onChange={(e) => {
                  setForm({ ...form, code: e.target.value });
                  setFieldErrors((p) => ({ ...p, code: '' }));
                }}
              />
            </FormField>
            <FormField label="Name" required error={fieldErrors.name}>
              <input
                className="input"
                value={form.name}
                placeholder={config.namePlaceholder}
                onChange={(e) => {
                  setForm({ ...form, name: e.target.value });
                  setFieldErrors((p) => ({ ...p, name: '' }));
                }}
              />
            </FormField>
          </div>
          {config.withDescription && (
            <div>
              <label className="label">Description</label>
              <textarea
                className="input"
                rows={2}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
          )}
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
            Active
          </label>
          {config.withAllowsDecimal && (
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                checked={form.allowsDecimal}
                onChange={(e) => setForm({ ...form, allowsDecimal: e.target.checked })}
              />
              <span>
                Allow decimal quantities
                <span className="mt-0.5 block text-xs text-slate-400">
                  Uncheck for whole-unit measures such as pcs or box. Inventory Adjustment rejects
                  decimal quantities for materials using this UoM.
                </span>
              </span>
            </label>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
