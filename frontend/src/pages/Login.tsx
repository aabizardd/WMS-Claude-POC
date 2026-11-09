import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import loginBanner from '../assets/login-banner.jpg';
import loginWave from '../assets/login-wave.svg';
import logoInline from '../assets/logo-inline.png';

const inputCls =
  'w-full rounded-lg border bg-slate-100 px-3 py-2.5 text-[13px] text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2';
const inputOk = 'border-transparent focus:border-blue-500 focus:ring-blue-500/20';
const inputBad = 'border-red-400 focus:border-red-500 focus:ring-red-200';

/**
 * Sign-in, laid out as WMS dev's: the warehouse photo with "WMS — Smarter
 * Warehouse. Better Business." on the left, and on wide screens the form on a
 * white wave down the right (a centred card on smaller ones).
 */
export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const errs: Record<string, string> = {};
    if (!username.trim()) errs.username = 'Email or username is required';
    if (!password) errs.password = 'Password is required';
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setLoading(true);
    try {
      await login(username.trim(), password);
      navigate('/admin', { replace: true });
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const m = err.response?.data?.message;
        setError(m === 'Invalid credentials' ? 'Incorrect email/username or password.' : (m ?? 'Login failed'));
      } else {
        setError('Something went wrong');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-x-hidden p-4 sm:p-8 lg:items-stretch lg:justify-end lg:p-0">
      {/* Background photo, with the tagline on wide screens. */}
      <div className="pointer-events-none absolute inset-0 z-0 select-none">
        <img src={loginBanner} alt="" className="absolute inset-0 h-full w-full object-cover object-[30%_50%]" />
        <div className="absolute left-24 top-1/3 z-10 hidden max-w-[40vw] text-white lg:block">
          <span className="block text-7xl font-extrabold tracking-wider drop-shadow-[0_2px_4px_rgba(0,0,0,0.4)]">WMS</span>
          <div className="mt-5 h-1.5 w-20 rounded-full bg-[#5166AE] drop-shadow-[0_1px_2px_rgba(0,0,0,0.3)]" />
          <h2 className="mt-7 text-[34px] font-normal leading-tight tracking-wide text-slate-100/90 drop-shadow-[0_2px_4px_rgba(0,0,0,0.4)]">
            Smarter Warehouse. <br />
            <span className="font-semibold text-white">Better Business.</span>
          </h2>
        </div>
      </div>

      {/* The form: a card on small screens, the white wave on the right on wide ones. */}
      <div
        className="relative z-10 flex w-full flex-col justify-between rounded-2xl bg-white p-8 shadow-xl sm:max-w-[440px] lg:absolute lg:right-0 lg:top-0 lg:h-screen lg:w-[45vw] lg:max-w-none lg:rounded-none lg:bg-transparent lg:bg-[length:100%_100%] lg:bg-center lg:bg-no-repeat lg:pl-[7%] lg:pr-8 lg:shadow-none lg:[background-image:var(--login-wave)]"
        // Quoted: the production build inlines this small SVG as a data URI with
        // ' and spaces in it, which an unquoted url() rejects (no wave at all).
        style={{ ['--login-wave' as string]: `url("${loginWave}")` }}
      >
        <div className="hidden min-h-0 lg:block lg:h-[10vh] 2xl:h-[15vh]" />
        <div className="mx-auto my-auto w-full max-w-[350px] 2xl:max-w-[430px]">
          <div className="mb-10 text-center 2xl:mb-6">
            <h1 className="text-[22px] font-semibold text-slate-900">Welcome Back</h1>
            <p className="mt-1 text-sm text-slate-500">Sign in to your WMS account</p>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] text-red-700"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4 text-sm" noValidate>
            <label className="block" htmlFor="login-username">
              <span className="mb-1 block text-[13px] font-medium text-slate-800">Email or Username</span>
              <input
                id="login-username"
                type="text"
                autoComplete="username"
                autoFocus
                placeholder="your.email@company.com"
                className={`${inputCls} ${fieldErrors.username ? inputBad : inputOk}`}
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setFieldErrors((p) => ({ ...p, username: '' }));
                }}
                aria-invalid={!!fieldErrors.username}
              />
              {fieldErrors.username && <span className="mt-1 block text-xs text-red-600">{fieldErrors.username}</span>}
            </label>

            <label className="block" htmlFor="login-password">
              <span className="mb-1 block text-[13px] font-medium text-slate-800">Password</span>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  className={`${inputCls} pr-10 ${fieldErrors.password ? inputBad : inputOk}`}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setFieldErrors((p) => ({ ...p, password: '' }));
                  }}
                  aria-invalid={!!fieldErrors.password}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 hover:bg-slate-100"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    {showPassword ? (
                      <>
                        <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
                        <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
                        <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
                        <path d="m2 2 20 20" />
                      </>
                    ) : (
                      <>
                        <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
                        <circle cx="12" cy="12" r="3" />
                      </>
                    )}
                  </svg>
                </button>
              </div>
              {fieldErrors.password && <span className="mt-1 block text-xs text-red-600">{fieldErrors.password}</span>}
            </label>

            <button
              type="submit"
              disabled={loading}
              className="mt-1 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#5166AE] text-[13px] font-medium text-white shadow-sm transition hover:bg-[#46599b] focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:opacity-60"
            >
              {loading ? (
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
                  <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              ) : (
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m10 17 5-5-5-5" />
                  <path d="M15 12H3" />
                  <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                </svg>
              )}
              <span>{loading ? 'Signing in…' : 'Sign In'}</span>
            </button>
          </form>
        </div>

        <div className="mx-auto mt-6 flex w-full max-w-[400px] items-center justify-center lg:mt-auto">
          <div className="flex flex-col items-start">
            <p className="text-xs font-medium text-[#BDBCBC]">Powered by</p>
            <img src={logoInline} alt="Inline Technology" className="-mt-2 w-[140px]" />
          </div>
        </div>
      </div>
    </main>
  );
}
