import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import axios from 'axios';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import type { ComplaintDetail } from '../../types';

export default function ComplaintDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { has } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const canUpdate = has('complaints:update');

  const [c, setC] = useState<ComplaintDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    api
      .get<ComplaintDetail>(`/complaints/${id}`)
      .then((r) => setC(r.data))
      .catch(() => setLoadError('Failed to load complaint.'))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function markSolved() {
    const ok = await confirm({
      title: 'Mark as Solved?',
      description: 'This complaint will be marked as solved.',
      type: 'success',
      confirmText: 'Mark Solved',
    });
    if (!ok) return;
    setSaving(true);
    try {
      await api.patch(`/complaints/${id}/status`, { status: 'Solved' });
      toast.success('Complaint marked as solved');
      load();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg = err.response?.data?.message;
        toast.error(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Update failed');
      } else toast.error('Update failed');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-slate-400">Loading…</div>;
  }
  if (loadError || !c) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError || 'Complaint not found.'}
        </div>
        <Link to="/admin/complaints" className="btn-secondary">
          ← Back to Complaints
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Link
            to="/admin/complaints"
            className="mt-1 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Back"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-2xl font-semibold text-slate-800">{c.title}</h1>
            <p className="mt-1 text-sm text-slate-500">
              {c.complaint_number} · {c.menu_feature}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              c.status === 'Solved' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
            }`}
          >
            {c.status}
          </span>
          {canUpdate && c.status !== 'Solved' && (
            <button className="btn-primary" onClick={markSolved} disabled={saving}>
              {saving ? 'Saving…' : 'Mark as Solved'}
            </button>
          )}
        </div>
      </div>

      <div className="card p-5">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <Meta label="Menu / Feature" value={c.menu_feature} />
          <Meta label="Email" value={c.email} />
          <Meta label="Reported By" value={c.reported_by} />
          <Meta label="Warehouse" value={c.warehouse?.name} />
          <Meta label="Created" value={new Date(c.created_at).toLocaleString()} />
        </dl>
        <div className="mt-4">
          <div className="text-xs text-slate-400">Description</div>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{c.description}</p>
        </div>
      </div>

      <div className="card p-5">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Evidence
        </h3>
        {c.evidences.length === 0 ? (
          <p className="text-sm text-slate-400">No evidence attached.</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {c.evidences.map((src, i) => (
              <button key={i} type="button" onClick={() => setPreview(src)}>
                <img
                  src={src}
                  alt={`evidence ${i + 1}`}
                  className="h-28 w-28 rounded-lg border border-slate-200 object-cover transition hover:opacity-90"
                />
              </button>
            ))}
          </div>
        )}
      </div>

      {preview && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/70 p-4"
          onClick={() => setPreview(null)}
        >
          <img src={preview} alt="evidence" className="max-h-[90vh] max-w-full rounded-lg" />
        </div>
      )}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="font-medium text-slate-700">
        {value || <span className="text-slate-300">—</span>}
      </dd>
    </div>
  );
}
