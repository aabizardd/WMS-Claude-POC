import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../../lib/api';
import Modal from '../../components/Modal';
import NumberInput from '../../components/NumberInput';
import type { PutawayDetail } from '../../types';
import { useAuth } from '../../context/AuthContext';
import axios from 'axios';

function statusBadge(status: string) {
  const map: Record<string, string> = {
    Open: 'bg-amber-50 text-amber-700',
    OnProgress: 'bg-blue-50 text-blue-700',
    Closed: 'bg-emerald-50 text-emerald-700',
  };
  return map[status] ?? 'bg-slate-100 text-slate-600';
}

interface BinOption {
  id: string;
  binLabel: string;
  binCode: string;
}

export default function PutawayDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { has } = useAuth();
  const canAssign = has('putaway:update');

  const [pt, setPt] = useState<PutawayDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [pickers, setPickers] = useState<{ id: number; name: string }[]>([]);
  const [pickerSelects, setPickerSelects] = useState<Record<string, string>>({});
  const [assigning, setAssigning] = useState(false);
  const [assignMsg, setAssignMsg] = useState('');
  const [assignModal, setAssignModal] = useState(false);

  const [putawayMode, setPutawayMode] = useState(false);
  const [putawayActuals, setPutawayActuals] = useState<Record<string, number>>({});
  const [putawayQuality, setPutawayQuality] = useState<Record<string, number>>({});
  const [putawayQtyIssue, setPutawayQtyIssue] = useState<Record<string, number>>({});
  const [putawayBins, setPutawayBins] = useState<Record<string, string>>({});
  const [putawayLoading, setPutawayLoading] = useState(false);
  const [putawayError, setPutawayError] = useState('');
  const [putawaySuccess, setPutawaySuccess] = useState('');
  const [confirmModal, setConfirmModal] = useState(false);

  const [bins, setBins] = useState<BinOption[]>([]);

  function hydrate(data: PutawayDetail) {
    setPt(data);
    setPickerSelects(
      Object.fromEntries(
        data.items.map((it) => [it.id, it.picker?.id ? String(it.picker.id) : '']),
      ),
    );
    setPutawayActuals(
      Object.fromEntries(data.items.map((it) => [it.id, it.actual_qty || it.planned_qty])),
    );
    setPutawayQuality(
      Object.fromEntries(data.items.map((it) => [it.id, it.quality_issue])),
    );
    setPutawayQtyIssue(
      Object.fromEntries(data.items.map((it) => [it.id, it.qty_issue])),
    );
    setPutawayBins(
      Object.fromEntries(data.items.map((it) => [it.id, it.bin_id ?? ''])),
    );
    setPutawayMode(false);
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .get<PutawayDetail>(`/putaway/${id}`)
      .then(async (r) => {
        if (!active) return;
        hydrate(r.data);
        try {
          const [pu, br] = await Promise.all([
            api.get<{ id: number; name: string }[]>('/users/pickers', {
              params: { warehouseId: r.data.warehouse_id ?? undefined },
            }),
            api.get<BinOption[]>('/bins/options', {
              params: { warehouseId: r.data.warehouse_id ?? undefined },
            }),
          ]);
          if (active) {
            setPickers(pu.data);
            setBins(br.data);
          }
        } catch {
          if (active) {
            setPickers([]);
            setBins([]);
          }
        }
      })
      .catch(() => active && setError('Failed to load putaway.'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [id]);

  const remainingMap = useMemo(() => {
    if (!pt) return {};
    return Object.fromEntries(
      pt.items.map((it) => [
        it.id,
        (it.planned_qty || 0) -
          (putawayActuals[it.id] != null ? putawayActuals[it.id] : it.actual_qty || it.planned_qty || 0) -
          (putawayQuality[it.id] ?? it.quality_issue ?? 0) -
          (putawayQtyIssue[it.id] ?? it.qty_issue ?? 0),
      ]),
    );
  }, [pt, putawayActuals, putawayQuality, putawayQtyIssue]);

  async function handleAssignPicker() {
    if (!pt) return;
    setAssignMsg('');
    setAssigning(true);
    const payload = {
      items: pt.items.map((it) => ({
        id: it.id,
        pickerId: pickerSelects[it.id] ? Number(pickerSelects[it.id]) : null,
      })),
    };
    try {
      const r = await api.put<PutawayDetail>(`/putaway/${id}/assign`, payload);
      hydrate(r.data);
      setAssignMsg('Pickers assigned successfully.');
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg = err.response?.data?.message;
        setAssignMsg(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Assign failed');
      } else setAssignMsg('Assign failed');
    } finally {
      setAssigning(false);
      setAssignModal(true);
    }
  }

  function startPutaway() {
    setPutawayMode(true);
    setPutawayError('');
    setPutawaySuccess('');
  }

  async function handleConfirmPutaway() {
    if (!pt) return;
    setPutawayError('');
    setPutawayLoading(true);
    const payload = {
      items: pt.items.map((it) => ({
        id: it.id,
        actualQty: putawayActuals[it.id] != null ? putawayActuals[it.id] : (it.actual_qty || it.planned_qty),
        qualityIssue: putawayQuality[it.id] ?? it.quality_issue,
        qtyIssue: putawayQtyIssue[it.id] ?? it.qty_issue,
        binId: putawayBins[it.id] || null,
      })),
    };
    try {
      const r = await api.put<PutawayDetail>(`/putaway/${id}/confirm`, payload);
      hydrate(r.data);
      setPutawaySuccess(`Putaway ${r.data.status === 'Closed' ? 'completed' : 'updated'} successfully.`);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg = err.response?.data?.message;
        setPutawayError(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Confirm failed');
      } else setPutawayError('Confirm failed');
    } finally {
      setPutawayLoading(false);
      setConfirmModal(true);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-400">Loading…</div>
    );
  }
  if (error || !pt) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error || 'Putaway not found.'}
        </div>
        <Link to="/admin/inbound/putaway" className="btn-secondary">← Back to Putaway</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-full space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Link to="/admin/inbound/putaway" className="mt-1 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Back">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-2xl font-semibold text-slate-800">{pt.putaway_code}</h1>
            <p className="mt-1 text-sm text-slate-500">
              {pt.gr_number ?? '—'} · {pt.warehouse_name ?? 'No warehouse'}
            </p>
          </div>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${statusBadge(pt.status)}`}>
          {pt.status === 'OnProgress' ? 'On Progress' : pt.status}
        </span>
      </div>

      <div className="card p-5">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">Info</h3>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <Meta label="Putaway Code" value={pt.putaway_code} />
          <Meta label="GR Number" value={pt.gr_number} />
          <Meta label="Warehouse" value={pt.warehouse_name} />
          <Meta label="Status" value={pt.status === 'OnProgress' ? 'On Progress' : pt.status} />
          <Meta label="Items" value={String(pt.items.length)} />
        </dl>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (putawayMode) handleConfirmPutaway();
          else handleAssignPicker();
        }}
        className="space-y-4"
      >
        <div className="card overflow-hidden">
          <div className="border-b border-slate-200 px-4 py-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Putaway Items ({pt.items.length})
            </h3>
            <div className="flex items-center gap-2">
              {canAssign && !putawayMode && (
                <button type="submit" className="btn-primary text-xs" disabled={assigning}>
                  {assigning ? 'Saving…' : 'Assign Pickers'}
                </button>
              )}
              {canAssign && pt.status !== 'Closed' && !putawayMode && (
                <button type="button" className="btn-secondary text-xs" onClick={startPutaway}>
                  Putaway
                </button>
              )}
              {putawayMode && (
                <>
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={() => setPutawayMode(false)}
                    disabled={putawayLoading}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary text-xs" disabled={putawayLoading}>
                    {putawayLoading ? 'Saving…' : 'Confirm'}
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-3">Item</th>
                  <th className="px-3 py-3">PO</th>
                  <th className="px-3 py-3">Mat. Code</th>
                  <th className="px-3 py-3">Vendor</th>
                  <th className="px-3 py-3 text-right">Planned</th>
                  <th className="px-3 py-3 text-right">Actual</th>
                  <th className="px-3 py-3 text-right">Quality</th>
                  <th className="px-3 py-3 text-right">Qty Issue</th>
                  <th className="px-3 py-3 text-right">Remaining</th>
                  <th className="px-3 py-3">Bin</th>
                  <th className="px-3 py-3">Picker</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pt.items.map((it) => {
                  const actualVal = putawayActuals[it.id] != null ? putawayActuals[it.id] : (it.actual_qty || it.planned_qty);
                  const qualityVal = putawayQuality[it.id] ?? it.quality_issue;
                  const qtyIssueVal = putawayQtyIssue[it.id] ?? it.qty_issue;
                  const remainVal = remainingMap[it.id] ?? it.remaining_qty;
                  return (
                    <tr key={it.id} className="hover:bg-slate-50">
                      <td className="px-3 py-3 font-medium text-slate-800">{it.item_name ?? '—'}</td>
                      <td className="px-3 py-3 text-slate-600">{it.po_number ?? '—'}</td>
                      <td className="px-3 py-3 text-slate-600">{it.material_code ?? '—'}</td>
                      <td className="px-3 py-3 text-slate-600">{it.vendor_name ?? '—'}</td>
                      <td className="px-3 py-3 text-right text-slate-800">{it.planned_qty}</td>
                      <td className="px-3 py-3">
                        {putawayMode ? (
                          <NumberInput
                            value={actualVal}
                            onChange={(v) => setPutawayActuals((s) => ({ ...s, [it.id]: v }))}
                            min={0}
                            max={it.planned_qty}
                          />
                        ) : (
                          <span className="text-slate-600">{actualVal}</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {putawayMode ? (
                          <NumberInput
                            value={qualityVal}
                            onChange={(v) => setPutawayQuality((s) => ({ ...s, [it.id]: v }))}
                            min={0}
                            max={it.planned_qty}
                          />
                        ) : (
                          <span className="text-slate-600">{qualityVal}</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {putawayMode ? (
                          <NumberInput
                            value={qtyIssueVal}
                            onChange={(v) => setPutawayQtyIssue((s) => ({ ...s, [it.id]: v }))}
                            min={0}
                            max={it.planned_qty}
                          />
                        ) : (
                          <span className="text-slate-600">{qtyIssueVal}</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right text-slate-600">{remainVal}</td>
                      <td className="px-3 py-3">
                        {putawayMode ? (
                          <select
                            className="input text-xs w-32"
                            value={putawayBins[it.id] ?? ''}
                            onChange={(e) =>
                              setPutawayBins((s) => ({ ...s, [it.id]: e.target.value }))
                            }
                          >
                            <option value="">— Select —</option>
                            {bins.map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.binLabel}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-slate-600">{it.bin_label || '—'}</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {canAssign && !putawayMode ? (
                          <select
                            className="input text-xs w-28"
                            value={pickerSelects[it.id] ?? ''}
                            onChange={(e) =>
                              setPickerSelects((s) => ({ ...s, [it.id]: e.target.value }))
                            }
                          >
                            <option value="">— Select —</option>
                            {pickers.map((pu) => (
                              <option key={pu.id} value={String(pu.id)}>{pu.name}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-slate-600">{it.picker?.name ?? '—'}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </form>

      <Modal open={assignModal} title="Assign Pickers" onClose={() => setAssignModal(false)}>
        <div className="space-y-4">
          <p className={`text-sm ${assignMsg.includes('successfully') ? 'text-emerald-700' : 'text-red-700'}`}>
            {assignMsg}
          </p>
          <div className="flex justify-end">
            <button className="btn-primary" onClick={() => setAssignModal(false)}>Close</button>
          </div>
        </div>
      </Modal>

      <Modal open={confirmModal} title="Putaway Result" onClose={() => setConfirmModal(false)}>
        <div className="space-y-4">
          {putawayError && (
            <p className="text-sm text-red-700">{putawayError}</p>
          )}
          {putawaySuccess && (
            <p className="text-sm text-emerald-700">{putawaySuccess}</p>
          )}
          <div className="flex justify-end">
            <button className="btn-primary" onClick={() => setConfirmModal(false)}>Close</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="font-medium text-slate-700">{value || <span className="text-slate-300">—</span>}</dd>
    </div>
  );
}
