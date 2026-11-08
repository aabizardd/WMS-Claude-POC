import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
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
  warehouses: { warehouse: { name: string } }[];
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

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 6;

/** A rough strength for the new password: length plus character variety. */
function strengthOf(pw: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  if (!pw) return { score: 0, label: '' };
  let score = 0;
  if (pw.length >= MIN_PASSWORD) score++;
  if (pw.length >= 10) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  if (pw.length < MIN_PASSWORD) score = 1;
  const s = Math.max(1, Math.min(4, score)) as 1 | 2 | 3 | 4;
  return { score: s, label: ['', 'Weak', 'Fair', 'Good', 'Strong'][s] };
}

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

  const dirty = useMemo(() => {
    if (!profile || !form) return false;
    const base = toForm(profile);
    return (Object.keys(base) as (keyof FormState)[]).some((k) => base[k] !== form[k]);
  }, [profile, form]);

  // Leaving (reload / close tab) with unsaved edits asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function set(patch: Partial<FormState>) {
    setForm((f) => (f ? { ...f, ...patch } : f));
    setFieldErrors((e) => {
      const next = { ...e };
      for (const k of Object.keys(patch)) delete next[k];
      return next;
    });
  }

  function discard() {
    if (!profile) return;
    setForm(toForm(profile));
    setFieldErrors({});
    setError('');
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form || !dirty) return;
    setError('');
    const errs = requiredErrors([
      ['firstName', form.firstName, 'First name is required'],
      ['username', form.username, 'Username is required'],
      ['email', form.email, 'Email is required'],
    ]);
    if (!errs.email && !EMAIL.test(form.email.trim())) errs.email = 'Enter a valid email address';
    // A password change needs both fields, matching and at least 6 characters.
    if (form.newPassword || form.confirmPassword) {
      if (form.newPassword.length < MIN_PASSWORD)
        errs.newPassword = `Password must be at least ${MIN_PASSWORD} characters`;
      if (!form.confirmPassword) errs.confirmPassword = 'Confirm the new password';
      else if (form.newPassword !== form.confirmPassword) errs.confirmPassword = 'Passwords do not match';
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
        ...(form.newPassword ? { newPassword: form.newPassword, confirmPassword: form.confirmPassword } : {}),
      });
      setProfile(r.data);
      setForm(toForm(r.data));
      setShowPw(false);
      await refresh(); // the side bar shows the new name / email
      toast.success(form.newPassword ? 'Profile and password updated' : 'Profile updated');
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg = err.response?.data?.message;
        setError(Array.isArray(msg) ? msg.join(', ') : (msg ?? 'Save failed'));
      } else setError('Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{loadError}</div>;
  }
  if (!profile || !form) return <ProfileSkeleton />;

  const initials =
    (profile.name || profile.username)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || '?';
  const warehouses = profile.warehouses.map((w) => w.warehouse.name);
  const strength = strengthOf(form.newPassword);
  const confirmState =
    !form.confirmPassword ? null : form.confirmPassword === form.newPassword ? 'match' : 'mismatch';

  return (
    <form onSubmit={handleSubmit} className="mt-2 space-y-5 pb-24" noValidate>
      {/* Identity */}
      <div className="overflow-hidden rounded-xl bg-white shadow-md dark:bg-slate-800">
        <div className="h-24 bg-gradient-to-r from-[#5166AE] via-[#5A7ACD] to-[#8EA2E3]" />
        <div className="px-5 pb-5">
          <div className="-mt-10 flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
            <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-2xl border-4 border-white bg-[#EEF1FA] text-2xl font-bold text-[#5166AE] shadow-sm dark:border-slate-800 dark:bg-slate-700 dark:text-slate-100">
              {initials}
            </div>
            {/* Below the banner: the avatar overlaps it by half its height. */}
            <div className="min-w-0 flex-1 sm:pt-12">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-xl font-semibold text-neutral-900 dark:text-white">{profile.name}</h1>
                {profile.role?.name && (
                  <span className="rounded-full bg-[#5166AE]/10 px-2.5 py-0.5 text-xs font-medium capitalize text-[#5166AE] dark:bg-[#5166AE]/30 dark:text-[#c7cff0]">
                    {profile.role.name}
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-neutral-500 dark:text-slate-400">
                <span className="inline-flex items-center gap-1.5">
                  <Icon d="M4 4h16v16H4zM4 6l8 7 8-7" />
                  <span className="break-all">{profile.email}</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Icon d="M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0" />@{profile.username}
                </span>
              </div>
            </div>
          </div>

          <dl className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Fact icon="M3 21V8l9-5 9 5v13M9 21v-6h6v6" label="Warehouse">
              {warehouses.length ? (
                <div className="flex flex-wrap gap-1">
                  {warehouses.map((w) => (
                    <span
                      key={w}
                      className="rounded-md bg-white px-2 py-0.5 text-xs font-medium text-neutral-700 ring-1 ring-inset ring-neutral-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-600"
                    >
                      {w}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-neutral-400">All warehouses</span>
              )}
            </Fact>
            <Fact icon="M4 21V5a2 2 0 012-2h8l6 6v12M9 13h6M9 17h6" label="Department">
              {profile.department?.name || <span className="text-neutral-400">-</span>}
            </Fact>
            <Fact icon="M3 21h18M5 21V7l7-4 7 4v14M9 9h1M14 9h1M9 13h1M14 13h1" label="Subsidiary">
              {profile.subsidiary?.name || <span className="text-neutral-400">-</span>}
            </Fact>
          </dl>
          <p className="mt-3 flex items-center gap-1.5 text-xs text-neutral-400">
            <Icon d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            Role, warehouse and organisation are managed by an administrator in User Master.
          </p>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {/* Account */}
        <Section
          icon="M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0"
          title="Personal Information"
          hint="How you appear across WMS and how you sign in."
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="First Name" required error={fieldErrors.firstName} htmlFor="pf-first">
              <input
                id="pf-first"
                className="input"
                autoComplete="given-name"
                value={form.firstName}
                onChange={(e) => set({ firstName: e.target.value })}
              />
            </FormField>
            <FormField label="Last Name" htmlFor="pf-last">
              <input
                id="pf-last"
                className="input"
                autoComplete="family-name"
                value={form.lastName}
                onChange={(e) => set({ lastName: e.target.value })}
              />
            </FormField>
            <FormField label="Username" required error={fieldErrors.username} htmlFor="pf-username">
              <input
                id="pf-username"
                className="input"
                autoComplete="username"
                value={form.username}
                onChange={(e) => set({ username: e.target.value })}
              />
            </FormField>
            <FormField label="Email" required error={fieldErrors.email} htmlFor="pf-email">
              <input
                id="pf-email"
                type="email"
                className="input"
                autoComplete="email"
                value={form.email}
                onChange={(e) => set({ email: e.target.value })}
              />
            </FormField>
            <FormField label="Employee ID" htmlFor="pf-employee">
              <input
                id="pf-employee"
                className="input"
                value={form.employeeId}
                onChange={(e) => set({ employeeId: e.target.value })}
                placeholder="e.g. EMP-00123"
              />
            </FormField>
          </div>
        </Section>

        {/* Password */}
        <Section
          icon="M7 11V7a5 5 0 0110 0v4M5 11h14v10H5z"
          title="Change Password"
          hint="Leave both fields empty to keep your current password."
        >
          <div className="space-y-4">
            <FormField label="New Password" error={fieldErrors.newPassword} htmlFor="pf-new-pw">
              <PasswordInput
                id="pf-new-pw"
                value={form.newPassword}
                onChange={(v) => set({ newPassword: v })}
                show={showPw}
                onToggle={() => setShowPw((s) => !s)}
                placeholder={`At least ${MIN_PASSWORD} characters`}
              />
            </FormField>
            {form.newPassword && (
              <div aria-live="polite">
                <div className="flex gap-1">
                  {[1, 2, 3, 4].map((i) => (
                    <span
                      key={i}
                      className={`h-1.5 flex-1 rounded-full ${
                        i <= strength.score
                          ? ['', 'bg-red-500', 'bg-amber-500', 'bg-lime-500', 'bg-emerald-500'][strength.score]
                          : 'bg-neutral-200 dark:bg-slate-700'
                      }`}
                    />
                  ))}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-neutral-500">
                    Strength: <b className="text-neutral-700 dark:text-slate-200">{strength.label}</b>
                  </span>
                  <span className="text-neutral-400">Mix upper & lower case, numbers and symbols for a stronger password</span>
                </div>
              </div>
            )}
            <FormField label="Confirm New Password" error={fieldErrors.confirmPassword} htmlFor="pf-confirm-pw">
              <PasswordInput
                id="pf-confirm-pw"
                value={form.confirmPassword}
                onChange={(v) => set({ confirmPassword: v })}
                show={showPw}
                onToggle={() => setShowPw((s) => !s)}
                placeholder="Type the new password again"
              />
            </FormField>
            {confirmState && !fieldErrors.confirmPassword && (
              <p
                className={`-mt-2 flex items-center gap-1.5 text-xs ${
                  confirmState === 'match' ? 'text-emerald-600' : 'text-amber-600'
                }`}
                aria-live="polite"
              >
                <Icon d={confirmState === 'match' ? 'M5 13l4 4L19 7' : 'M12 9v4m0 4h.01'} />
                {confirmState === 'match' ? 'Passwords match' : 'Passwords do not match yet'}
              </p>
            )}
          </div>
        </Section>
      </div>

      {/* Save bar: only while there are unsaved edits. */}
      <div
        className={`fixed inset-x-0 bottom-4 z-30 flex justify-center px-4 transition-all duration-200 ${
          dirty ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0'
        }`}
        aria-hidden={!dirty}
      >
        <div className="flex w-full max-w-xl flex-wrap items-center gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3 shadow-lg dark:border-slate-700 dark:bg-slate-800">
          <span className="flex items-center gap-2 text-sm text-neutral-700 dark:text-slate-200">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            You have unsaved changes
          </span>
          <div className="ml-auto flex gap-2">
            <button type="button" className="btn-secondary" onClick={discard} disabled={saving} tabIndex={dirty ? 0 : -1}>
              Discard
            </button>
            <button type="submit" className="btn-primary" disabled={saving || !dirty} tabIndex={dirty ? 0 : -1}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

function Section({ icon, title, hint, children }: { icon: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl bg-white p-5 shadow-md dark:bg-slate-800">
      <div className="mb-5 flex items-start gap-3">
        <span className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[#5166AE]/10 text-[#5166AE] dark:bg-[#5166AE]/30 dark:text-[#c7cff0]">
          <Icon d={icon} />
        </span>
        <div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-white">{title}</h2>
          {hint && <p className="mt-0.5 text-xs text-neutral-500 dark:text-slate-400">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function Fact({ icon, label, children }: { icon: string; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900/40">
      <span className="mt-0.5 text-neutral-400">
        <Icon d={icon} />
      </span>
      <div className="min-w-0">
        <dt className="text-xs text-neutral-500 dark:text-slate-400">{label}</dt>
        <dd className="mt-0.5 text-sm font-medium text-neutral-800 dark:text-slate-200">{children}</dd>
      </div>
    </div>
  );
}

function PasswordInput({
  id,
  value,
  onChange,
  show,
  onToggle,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        className="input pr-10"
        autoComplete="new-password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      <button
        type="button"
        onClick={onToggle}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-neutral-400 hover:text-neutral-700 dark:hover:text-slate-200"
        aria-label={show ? 'Hide password' : 'Show password'}
        title={show ? 'Hide password' : 'Show password'}
      >
        <Icon
          d={
            show
              ? 'M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.1A9.7 9.7 0 0112 5c5 0 9 5 10 7a13 13 0 01-3.2 4.2M6.6 6.6C4.4 8 2.9 10.2 2 12c1 2 5 7 10 7a9.7 9.7 0 004.3-1'
              : 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10 3a3 3 0 100-6 3 3 0 000 6z'
          }
        />
      </button>
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="mt-2 space-y-5" aria-busy="true" aria-label="Loading your profile">
      <div className="overflow-hidden rounded-xl bg-white shadow-md dark:bg-slate-800">
        <div className="h-24 animate-pulse bg-neutral-200 dark:bg-slate-700" />
        <div className="space-y-3 p-5">
          <div className="h-5 w-48 animate-pulse rounded bg-neutral-200 dark:bg-slate-700" />
          <div className="h-4 w-72 animate-pulse rounded bg-neutral-100 dark:bg-slate-700/60" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="h-72 animate-pulse rounded-xl bg-white shadow-md dark:bg-slate-800" />
        ))}
      </div>
    </div>
  );
}
