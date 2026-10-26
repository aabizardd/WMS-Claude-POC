import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import axios from 'axios';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import FormField, { requiredErrors } from '../../components/form/FormField';

interface Profile {
  id: number;
  name: string;
  firstName: string | null;
  lastName: string | null;
  username: string;
  email: string;
  employeeId: string | null;
  role: { name: string } | null;
  warehouse: { name: string } | null;
  department: { name: string | null } | null;
  subsidiary: { name: string | null } | null;
}

interface FormState {
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  employeeId: string;
  newPassword: string;
  confirmPassword: string;
}

const toForm = (p: Profile): FormState => ({
  firstName: p.firstName ?? '',
  lastName: p.lastName ?? '',
  username: p.username,
  email: p.email,
  employeeId: p.employeeId ?? '',
  newPassword: '',
  confirmPassword: '',
});

/**
 * The signed-in user's own profile, opened from their name at the bottom of
 * the side bar: name, username, email, employee id and password. Role,
 * warehouse and organisation are shown but stay with the User Master.
 */
export default function ProfilePage() {
  const { refresh } = useAuth();
  const toast = useToast();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [showPw, setShowPw] = useState(false);

  useEffect(() => {
    api
      .get<Profile>('/auth/profile')
      .then((r) => {
        setProfile(r.data);
        setForm(toForm(r.data));
      })
      .catch(() => setLoadError('Failed to load your profile.'));
  }, []);

  function set(patch: Partial<FormState>) {
    setForm((f) => (f ? { ...f, ...patch } : f));
    setFieldErrors((e) => {
      const next = { ...e };
      for (const k of Object.keys(patch)) delete next[k];
      return next;
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setError('');
    const errs = requiredErrors([
      ['firstName', form.firstName, 'First name is required'],
      ['username', form.username, 'Username is required'],
      ['email', form.email, 'Email is required'],
    ]);
    // A password change needs both fields, matching and at least 6 characters.
    if (form.newPassword || form.confirmPassword) {
      if (form.newPassword.length < 6) errs.newPassword = 'Password must be at least 6 characters';
      if (!form.confirmPassword) errs.confirmPassword = 'Confirm the new password';
      else if (form.newPassword !== form.confirmPassword)
        errs.confirmPassword = 'Passwords do not match';
    }
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSaving(true);
    try {
      const r = await api.put<Profile>('/auth/profile', {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        username: form.username.trim(),
        email: form.email.trim(),
        employeeId: form.employeeId.trim(),
        ...(form.newPassword
          ? { newPassword: form.newPassword, confirmPassword: form.confirmPassword }
          : {}),
      });
      setProfile(r.data);
      setForm(toForm(r.data));
      await refresh(); // the side bar shows the new name / email
      toast.success(form.newPassword ? 'Profile and password updated' : 'Profile updated');
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg = err.response?.data?.message;
        setError(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Save failed');
      } else setError('Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{loadError}</div>
    );
  }
  if (!profile || !form) {
    return <div className="p-10 text-center text-slate-400">Loading…</div>;
  }

  const initials =
    (profile.name || profile.username)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || '?';

  return (
    <div className="mt-2 space-y-5 rounded-xl bg-white p-5 shadow-md dark:bg-slate-800">
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold text-neutral-900 dark:text-white">My Profile</h1>
        <p className="mt-1 text-[13px] text-neutral-600 dark:text-slate-400">
          Manage your account details and password
        </p>
      </div>

      <div className="flex items-center gap-4 rounded-lg border border-neutral-200 p-4 dark:border-slate-700">
        <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full border border-neutral-200 bg-white text-lg font-bold text-neutral-700 shadow-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100">
          {initials}
        </div>
        <div className="min-w-0">
          <div className="truncate text-base font-semibold text-neutral-900 dark:text-white">{profile.name}</div>
          <div className="truncate text-sm text-neutral-500">{profile.email}</div>
        </div>
        <dl className="ml-auto hidden grid-cols-2 gap-x-8 gap-y-1 text-sm md:grid">
          <Info label="Role" value={profile.role?.name} />
          <Info label="Warehouse" value={profile.warehouse?.name} />
          <Info label="Department" value={profile.department?.name} />
          <Info label="Subsidiary" value={profile.subsidiary?.name} />
        </dl>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>
        )}

        <Section title="Account">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="First Name" required error={fieldErrors.firstName}>
              <input className="input" value={form.firstName} onChange={(e) => set({ firstName: e.target.value })} />
            </FormField>
            <FormField label="Last Name">
              <input className="input" value={form.lastName} onChange={(e) => set({ lastName: e.target.value })} />
            </FormField>
            <FormField label="Username" required error={fieldErrors.username}>
              <input
                className="input"
                autoComplete="username"
                value={form.username}
                onChange={(e) => set({ username: e.target.value })}
              />
            </FormField>
            <FormField label="Email" required error={fieldErrors.email}>
              <input
                type="email"
                className="input"
                autoComplete="email"
                value={form.email}
                onChange={(e) => set({ email: e.target.value })}
              />
            </FormField>
            <FormField label="Employee ID">
              <input className="input" value={form.employeeId} onChange={(e) => set({ employeeId: e.target.value })} />
            </FormField>
          </div>
        </Section>

        <Section
          title="Change Password"
          hint="Leave both fields empty to keep your current password."
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="New Password" error={fieldErrors.newPassword}>
              <input
                type={showPw ? 'text' : 'password'}
                className="input"
                autoComplete="new-password"
                value={form.newPassword}
                onChange={(e) => set({ newPassword: e.target.value })}
                placeholder="At least 6 characters"
              />
            </FormField>
            <FormField label="Confirm New Password" error={fieldErrors.confirmPassword}>
              <input
                type={showPw ? 'text' : 'password'}
                className="input"
                autoComplete="new-password"
                value={form.confirmPassword}
                onChange={(e) => set({ confirmPassword: e.target.value })}
                placeholder="Type the new password again"
              />
            </FormField>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              checked={showPw}
              onChange={(e) => setShowPw(e.target.checked)}
            />
            Show password
          </label>
        </Section>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setForm(toForm(profile));
              setFieldErrors({});
              setError('');
            }}
            disabled={saving}
          >
            Reset
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-neutral-200 p-5 dark:border-slate-700">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
      <div className="mt-4">{children}</div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex gap-2">
      <dt className="text-neutral-500">{label}:</dt>
      <dd className="font-medium text-neutral-800 dark:text-slate-200">{value || '-'}</dd>
    </div>
  );
}
