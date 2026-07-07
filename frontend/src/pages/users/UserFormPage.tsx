import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import api from '../../lib/api';
import type {
  DepartmentOption,
  Role,
  SubsidiaryOption,
  User,
  WarehouseOption,
} from '../../types';
import { useAuth } from '../../context/AuthContext';
import SearchableSelect from '../../components/SearchableSelect';
import FormField, { requiredErrors } from '../../components/form/FormField';

interface FormState {
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  password: string;
  roleId: number | '';
  warehouseId: string;
  departmentId: string;
  subsidiaryId: string;
  isActive: boolean;
}

const emptyForm: FormState = {
  firstName: '',
  lastName: '',
  username: '',
  email: '',
  password: '',
  roleId: '',
  warehouseId: '',
  departmentId: '',
  subsidiaryId: '',
  isActive: true,
};

export default function UserFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = !id;

  const { has } = useAuth();
  const canManage = isNew ? has('users:create') : has('users:update');
  const viewOnly = !canManage;

  const [roles, setRoles] = useState<Role[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [subsidiaries, setSubsidiaries] = useState<SubsidiaryOption[]>([]);
  const [subsLoading, setSubsLoading] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    setLoading(true);
    const reqs: Promise<unknown>[] = [
      api.get<Role[]>('/roles/options'),
      api.get<WarehouseOption[]>('/warehouses/options'),
      api.get<DepartmentOption[]>('/departments/options'),
    ];
    if (!isNew) reqs.push(api.get<User>(`/users/${id}`));

    Promise.all(reqs)
      .then((res) => {
        if (!active) return;
        const roleList = (res[0] as { data: Role[] }).data;
        setRoles(roleList);
        setWarehouses((res[1] as { data: WarehouseOption[] }).data);
        setDepartments((res[2] as { data: DepartmentOption[] }).data);
        if (!isNew) {
          const u = (res[3] as { data: User }).data;
          setForm({
            firstName: u.firstName ?? '',
            lastName: u.lastName ?? '',
            username: u.username,
            email: u.email,
            password: '',
            roleId: u.roleId,
            warehouseId: u.warehouseId ?? '',
            departmentId: u.departmentId ?? '',
            subsidiaryId: u.subsidiaryId ?? '',
            isActive: u.isActive,
          });
          // Populate the subsidiary dropdown for the user's existing department.
          if (u.departmentId) loadSubsidiaries(u.departmentId);
        } else {
          setForm((f) => ({ ...f, roleId: roleList[0]?.id ?? '' }));
        }
      })
      .catch(() => active && setLoadError('Failed to load.'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [id, isNew]);

  // Load the subsidiaries that belong to a department (dependent dropdown).
  async function loadSubsidiaries(departmentId: string) {
    if (!departmentId) {
      setSubsidiaries([]);
      return;
    }
    setSubsLoading(true);
    try {
      const r = await api.get<SubsidiaryOption[]>(
        `/departments/${departmentId}/subsidiaries`,
      );
      setSubsidiaries(r.data);
    } catch {
      setSubsidiaries([]);
    } finally {
      setSubsLoading(false);
    }
  }

  // Changing department always resets the subsidiary (must be re-picked).
  function onDepartmentChange(departmentId: string) {
    set({ departmentId, subsidiaryId: '' });
    setSubsidiaries([]);
    loadSubsidiaries(departmentId);
  }

  const set = (patch: Partial<FormState>) => {
    setForm({ ...form, ...patch });
    setFieldErrors((p) => {
      const next = { ...p };
      for (const k of Object.keys(patch)) delete next[k];
      return next;
    });
  };

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    const errs = requiredErrors([
      ['firstName', form.firstName, 'First name is required'],
      ['username', form.username, 'Username is required'],
      ['email', form.email, 'Email is required'],
      ['roleId', form.roleId, 'Role is required'],
      ['warehouseId', form.warehouseId, 'Warehouse is required'],
    ]);
    if (isNew && !form.password) errs.password = 'Password is required';
    if (form.password && form.password.length < 6)
      errs.password = 'Password must be at least 6 characters';
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSaving(true);

    const base = {
      firstName: form.firstName,
      lastName: form.lastName || undefined,
      username: form.username,
      email: form.email,
      roleId: Number(form.roleId),
      warehouseId: form.warehouseId, // required
      // Optional org assignment; null clears it. Subsidiary only sent with a
      // department (enforced by the dependent dropdown + backend validation).
      departmentId: form.departmentId || null,
      subsidiaryId: form.departmentId ? form.subsidiaryId || null : null,
      isActive: form.isActive,
    };

    try {
      if (isNew) {
        await api.post('/users', { ...base, password: form.password });
      } else {
        await api.put(`/users/${id}`, {
          ...base,
          ...(form.password ? { password: form.password } : {}),
        });
      }
      navigate('/admin/users');
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg = err.response?.data?.message;
        setError(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Save failed');
      } else setError('Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-400">
        Loading…
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError}
        </div>
        <Link to="/admin/users" className="btn-secondary">
          ← Back to users
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <Link
          to="/admin/users"
          className="mt-1 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          aria-label="Back"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">
            {isNew ? 'Add User' : viewOnly ? 'User Detail' : 'Edit User'}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Profile, access role, and assigned warehouse.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
            {error}
          </div>
        )}

        <Section title="Profile">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="First Name" required error={fieldErrors.firstName}>
              <input
                className="input"
                value={form.firstName}
                onChange={(e) => set({ firstName: e.target.value })}
                disabled={viewOnly}
              />
            </Field>
            <Field label="Last Name">
              <input
                className="input"
                value={form.lastName}
                onChange={(e) => set({ lastName: e.target.value })}
                disabled={viewOnly}
              />
            </Field>
            <Field label="Username" required error={fieldErrors.username}>
              <input
                className="input"
                value={form.username}
                onChange={(e) => set({ username: e.target.value })}
                disabled={viewOnly}
              />
            </Field>
            <Field label="Email" required error={fieldErrors.email}>
              <input
                type="email"
                className="input"
                value={form.email}
                onChange={(e) => set({ email: e.target.value })}
                disabled={viewOnly}
              />
            </Field>
          </div>
        </Section>

        <Section title="Access">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Role" required error={fieldErrors.roleId}>
              <SearchableSelect
                value={form.roleId ? String(form.roleId) : ''}
                onChange={(v) => set({ roleId: Number(v) })}
                disabled={viewOnly}
                placeholder="Select role"
                options={roles.map((r) => ({ value: String(r.id), label: r.name }))}
              />
            </Field>
            <Field label="Warehouse" required error={fieldErrors.warehouseId}>
              <SearchableSelect
                value={form.warehouseId}
                onChange={(v) => set({ warehouseId: v })}
                disabled={viewOnly}
                placeholder="Select warehouse"
                searchPlaceholder="Search warehouse…"
                options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
              />
            </Field>
            <Field label="Department">
              <SearchableSelect
                value={form.departmentId}
                onChange={onDepartmentChange}
                disabled={viewOnly}
                placeholder="Select department (optional)"
                searchPlaceholder="Search department…"
                options={departments.map((d) => ({
                  value: d.id,
                  label: d.name ?? d.oracleId,
                }))}
              />
            </Field>
            <Field label="Subsidiary">
              <SearchableSelect
                value={form.subsidiaryId}
                onChange={(v) => set({ subsidiaryId: v })}
                disabled={viewOnly || !form.departmentId || subsLoading}
                placeholder={
                  !form.departmentId
                    ? 'Select a department first'
                    : subsLoading
                      ? 'Loading…'
                      : 'Select subsidiary'
                }
                searchPlaceholder="Search subsidiary…"
                options={subsidiaries.map((s) => ({
                  value: s.id,
                  label: s.fullName ? `${s.name} — ${s.fullName}` : s.name ?? s.oracleId,
                }))}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                checked={form.isActive}
                onChange={(e) => set({ isActive: e.target.checked })}
                disabled={viewOnly}
              />
              Active
            </label>
          </div>
        </Section>

        <Section title="Password">
          <Field
            label={
              isNew ? 'Password' : 'New password (leave blank to keep current)'
            }
            required={isNew}
            error={fieldErrors.password}
          >
            <input
              type="password"
              className="input sm:max-w-sm"
              value={form.password}
              onChange={(e) => set({ password: e.target.value })}
              disabled={viewOnly}
              placeholder={isNew ? '' : '••••••'}
            />
          </Field>
        </Section>

        <div className="flex justify-end gap-2">
          <Link to="/admin/users" className="btn-secondary">
            {viewOnly ? 'Back' : 'Cancel'}
          </Link>
          {canManage && (
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save user'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="card p-5">
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: ReactNode;
}) {
  return (
    <FormField label={label} required={required} error={error}>
      {children}
    </FormField>
  );
}
