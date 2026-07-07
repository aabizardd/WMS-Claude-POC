import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import api from '../../lib/api';
import Modal from '../../components/Modal';
import SearchableSelect from '../../components/SearchableSelect';
import { useAuth } from '../../context/AuthContext';
import { useSort } from '../../hooks/useSort';
import SortableTh from '../../components/SortableTh';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import type { ComplaintRow, Paginated } from '../../types';
import { APP_MENUS } from './appMenus';

const LIMIT = 10;
const MAX_IMAGES = 2;
const MAX_BYTES = 2 * 1024 * 1024;

function statusBadge(status: string) {
  return status === 'Solved'
    ? 'bg-emerald-50 text-emerald-700'
    : 'bg-amber-50 text-amber-700';
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function ComplaintsPage() {
  const { user, has } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const isAdmin = user?.role === 'admin';
  const canCreate = has('complaints:create');

  const [data, setData] = useState<Paginated<ComplaintRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const { sort, toggle, params } = useSort();
  const onSort = (col: string) => {
    setPage(1);
    toggle(col);
  };
  const [status, setStatus] = useState('');

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [menuFeature, setMenuFeature] = useState('');
  const [title, setTitle] = useState('');
  const [email, setEmail] = useState(user?.email ?? '');
  const [description, setDescription] = useState('');
  const [evidences, setEvidences] = useState<string[]>([]);

  async function load() {
    setLoading(true);
    const r = await api.get<Paginated<ComplaintRow>>('/complaints', {
      params: {
        page,
        limit: LIMIT,
        search: search || undefined,
        status: status || undefined,
        ...params(),
      },
    });
    setData(r.data);
    setLoading(false);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, status, sort.sortBy, sort.order]);

  function openCreate() {
    setMenuFeature('');
    setTitle('');
    setEmail(user?.email ?? '');
    setDescription('');
    setEvidences([]);
    setOpen(true);
  }

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    for (const f of files) {
      if (evidences.length >= MAX_IMAGES) {
        toast.warning(`Maximum ${MAX_IMAGES} images`);
        break;
      }
      if (!f.type.startsWith('image/')) {
        toast.error('Only image files are allowed');
        continue;
      }
      if (f.size > MAX_BYTES) {
        toast.error(`"${f.name}" exceeds 2MB`);
        continue;
      }
      const url = await readAsDataUrl(f);
      setEvidences((prev) => [...prev, url].slice(0, MAX_IMAGES));
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!menuFeature || !title.trim() || !email.trim() || !description.trim()) {
      toast.error('Please fill in all required fields');
      return;
    }
    const ok = await confirm({
      title: 'Submit complaint?',
      description: 'Your complaint will be sent to the administrator.',
      type: 'info',
      confirmText: 'Submit',
    });
    if (!ok) return;
    setSaving(true);
    try {
      await api.post('/complaints', {
        menuFeature,
        title: title.trim(),
        email: email.trim(),
        description: description.trim(),
        evidences,
      });
      setOpen(false);
      toast.success('Complaint submitted');
      setPage(1);
      await load();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg = err.response?.data?.message;
        toast.error(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Submit failed');
      } else toast.error('Submit failed');
    } finally {
      setSaving(false);
    }
  }

  const totalPage = data?.total_page ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Complaint</h1>
          <p className="mt-1 text-sm text-slate-500">
            {isAdmin
              ? 'All complaints (filtered by active warehouse).'
              : 'Your submitted complaints.'}
          </p>
        </div>
        {canCreate && (
          <button className="btn-primary" onClick={openCreate}>
            New Complaint
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setSearch(searchInput.trim());
          }}
          className="flex gap-2"
        >
          <input
            className="input max-w-xs"
            placeholder="Search number / title / menu…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <button type="submit" className="btn-secondary">
            Search
          </button>
        </form>
        <SearchableSelect
          className="w-44"
          value={status}
          onChange={(v) => {
            setPage(1);
            setStatus(v);
          }}
          placeholder="All statuses"
          options={[
            { value: '', label: 'All statuses' },
            { value: 'Open', label: 'Open' },
            { value: 'Solved', label: 'Solved' },
          ]}
        />
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <SortableTh label="Number" col="complaint_number" sort={sort} onSort={onSort} />
                <SortableTh label="Menu / Feature" col="menu_feature" sort={sort} onSort={onSort} />
                <SortableTh label="Title" col="title" sort={sort} onSort={onSort} />
                {isAdmin && <SortableTh label="Reported By" col="reported_by" sort={sort} onSort={onSort} />}
                <SortableTh label="Status" col="status" sort={sort} onSort={onSort} />
                <SortableTh label="Created" col="created_at" sort={sort} onSort={onSort} />
                <th className="px-6 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={isAdmin ? 7 : 6} className="px-6 py-10 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              ) : data && data.rows.length > 0 ? (
                data.rows.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-6 py-3 font-medium text-slate-800">
                      {c.complaint_number}
                    </td>
                    <td className="px-6 py-3 text-slate-600">{c.menu_feature}</td>
                    <td className="px-6 py-3 text-slate-600">{c.title}</td>
                    {isAdmin && (
                      <td className="px-6 py-3 text-slate-600">
                        {c.reported_by ?? '—'}
                      </td>
                    )}
                    <td className="px-6 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusBadge(c.status)}`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {new Date(c.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex justify-end">
                        <Link
                          to={`/admin/complaints/${c.id}`}
                          className="rounded-md px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50"
                        >
                          Detail
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={isAdmin ? 7 : 6} className="px-6 py-10 text-center text-slate-400">
                    No complaints yet.
                  </td>
                </tr>
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
              <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Prev
              </button>
              <button className="btn-secondary" disabled={page >= totalPage} onClick={() => setPage((p) => Math.min(totalPage, p + 1))}>
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      <Modal open={open} title="New Complaint" onClose={() => (saving ? null : setOpen(false))}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Menu / Feature <span className="text-red-500">*</span>
            </label>
            <SearchableSelect
              value={menuFeature}
              onChange={setMenuFeature}
              options={APP_MENUS}
              placeholder="Select menu / feature"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Title <span className="text-red-500">*</span>
            </label>
            <input className="input w-full" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Email <span className="text-red-500">*</span>
            </label>
            <input className="input w-full" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Description <span className="text-red-500">*</span>
            </label>
            <textarea
              className="input w-full"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Evidence (max {MAX_IMAGES} images, ≤2MB each)
            </label>
            <div className="flex flex-wrap gap-3">
              {evidences.map((src, i) => (
                <div key={i} className="relative">
                  <img src={src} alt={`evidence ${i + 1}`} className="h-20 w-20 rounded-lg border border-slate-200 object-cover" />
                  <button
                    type="button"
                    onClick={() => setEvidences((prev) => prev.filter((_, j) => j !== i))}
                    className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-rose-600 text-white"
                    aria-label="Remove"
                  >
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                      <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
              {evidences.length < MAX_IMAGES && (
                <label className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 text-slate-400 hover:border-brand-400 hover:text-brand-500">
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  <span className="text-[10px]">Add</span>
                  <input type="file" accept="image/*" multiple className="hidden" onChange={onFiles} />
                </label>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Submitting…' : 'Submit'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
