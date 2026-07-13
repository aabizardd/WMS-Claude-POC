import { useEffect, useState, type ReactNode } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useWarehouse } from '../context/WarehouseContext';
import type { DashboardSummary, NameCount } from '../types';

const RANGES = [7, 30, 90] as const;

const PALETTE = [
  '#2563eb',
  '#16a34a',
  '#f59e0b',
  '#dc2626',
  '#7c3aed',
  '#0891b2',
  '#db2777',
  '#65a30d',
];

// Consistent colors for well-known statuses; unknown ones fall back to palette.
const STATUS_COLORS: Record<string, string> = {
  Open: '#f59e0b',
  OnProgress: '#2563eb',
  ProgressPicking: '#2563eb',
  Syncing: '#0891b2',
  SyncFailed: '#dc2626',
  Closed: '#16a34a',
  Solved: '#16a34a',
  Approved: '#16a34a',
  Rejected: '#dc2626',
  PendingApproval: '#f59e0b',
  success: '#16a34a',
  partial: '#f59e0b',
  failed: '#dc2626',
  quantity: '#2563eb',
  quality: '#7c3aed',
  qty_issue: '#2563eb',
  quality_issue: '#7c3aed',
  inbound: '#16a34a',
  outbound: '#db2777',
};

function num(n: number) {
  return n.toLocaleString();
}

function norm(list: NameCount[]): { name: string; count: number }[] {
  return list.map((x) => ({
    name: x.status ?? x.type ?? x.source ?? '—',
    count: x.count,
  }));
}

function colorFor(name: string, i: number) {
  return STATUS_COLORS[name] ?? PALETTE[i % PALETTE.length];
}

function Card({
  title,
  children,
  className = '',
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`card p-4 ${className}`}>
      <h3 className="mb-3 text-sm font-semibold text-slate-700">{title}</h3>
      {children}
    </div>
  );
}

function Kpi({
  label,
  value,
  accent = 'text-slate-800',
  hint,
}: {
  label: string;
  value: number | string;
  accent?: string;
  hint?: string;
}) {
  return (
    <div className="card px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold ${accent}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

function EmptyOr({ data, children }: { data: unknown[]; children: ReactNode }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex h-[240px] items-center justify-center text-sm text-slate-300">
        No data in range
      </div>
    );
  }
  return <>{children}</>;
}

function Donut({ data }: { data: NameCount[] }) {
  const d = norm(data);
  return (
    <EmptyOr data={d}>
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie
            data={d}
            dataKey="count"
            nameKey="name"
            innerRadius={55}
            outerRadius={85}
            paddingAngle={2}
          >
            {d.map((entry, i) => (
              <Cell key={i} fill={colorFor(entry.name, i)} />
            ))}
          </Pie>
          <Tooltip />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </EmptyOr>
  );
}

function FunnelBars({ data }: { data: { stage: string; count: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} layout="vertical" margin={{ left: 20, right: 16 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" allowDecimals={false} />
        <YAxis type="category" dataKey="stage" width={92} tick={{ fontSize: 12 }} />
        <Tooltip />
        <Bar dataKey="count" radius={[0, 4, 4, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const { activeWarehouseId, activeWarehouseName, canSwitch } = useWarehouse();

  const [range, setRange] = useState<number>(30);
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api
      .get<DashboardSummary>('/dashboard/summary', { params: { range } })
      .then((r) => active && setData(r.data))
      .catch(() => active && setError('Failed to load dashboard'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
    // Refetch on range change and when the admin switches the active warehouse.
  }, [range, activeWarehouseId]);

  const k = data?.kpis;

  return (
    <div className="space-y-6">
      {/* Header + controls */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">
            Welcome back, {user?.name?.split(' ')[0] ?? 'there'} 👋
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Transaction overview
            {canSwitch && (
              <> · {activeWarehouseName ? activeWarehouseName : 'All sites'}</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded-md px-3 py-1 text-sm font-medium transition ${
                range === r
                  ? 'bg-brand-600 text-white'
                  : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              {r}d
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading || !data || !k ? (
        <div className="card px-6 py-16 text-center text-slate-400">
          Loading dashboard…
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
            <Kpi
              label="Goods Receive"
              value={num(k.goods_receive_period)}
              hint={`${k.goods_receive_open} open`}
            />
            <Kpi
              label="Sales Orders"
              value={num(k.sales_order_period)}
              hint={`${k.sales_order_pending} pending`}
            />
            <Kpi
              label="SKU On Hand"
              value={num(k.sku_on_hand)}
              hint={`${num(k.on_hand_qty)} qty`}
            />
            <Kpi
              label="Adj. Pending"
              value={num(k.adjustment_pending)}
              accent={k.adjustment_pending ? 'text-amber-600' : 'text-slate-800'}
            />
            <Kpi
              label="Complaints Open"
              value={num(k.complaint_open)}
              accent={k.complaint_open ? 'text-red-600' : 'text-slate-800'}
            />
          </div>

          {/* ===== Inbound ===== */}
          <SectionHeader title="Inbound" />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card title="Goods Receive per day" className="lg:col-span-2">
              <EmptyOr data={data.inbound.throughput}>
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={data.inbound.throughput}>
                    <defs>
                      <linearGradient id="gIn" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#2563eb" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickFormatter={fmtDay} tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} width={30} />
                    <Tooltip />
                    <Area
                      type="monotone"
                      dataKey="count"
                      stroke="#2563eb"
                      fill="url(#gIn)"
                      name="GR"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </EmptyOr>
            </Card>
            <Card title="Inbound funnel">
              <FunnelBars data={data.inbound.funnel} />
            </Card>
            <Card title="Goods Receive status">
              <Donut data={data.inbound.gr_status} />
            </Card>
            <Card title="Putaway status">
              <Donut data={data.inbound.putaway_status} />
            </Card>
            <Card title="Aging (overdue open docs)">
              <div className="grid h-[240px] grid-cols-1 content-center gap-3">
                {data.ops.aging.map((a) => (
                  <div
                    key={a.label}
                    className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-4 py-3"
                  >
                    <span className="text-sm text-slate-600">{a.label}</span>
                    <span
                      className={`text-lg font-semibold ${
                        a.count ? 'text-amber-600' : 'text-slate-700'
                      }`}
                    >
                      {a.count}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* ===== Outbound ===== */}
          <SectionHeader title="Outbound / Fulfillment" />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card title="Deliveries per day" className="lg:col-span-2">
              <EmptyOr data={data.outbound.throughput}>
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={data.outbound.throughput}>
                    <defs>
                      <linearGradient id="gOut" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#16a34a" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#16a34a" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickFormatter={fmtDay} tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} width={30} />
                    <Tooltip />
                    <Area
                      type="monotone"
                      dataKey="count"
                      stroke="#16a34a"
                      fill="url(#gOut)"
                      name="Delivery"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </EmptyOr>
            </Card>
            <Card title="Fulfillment funnel">
              <FunnelBars data={data.outbound.funnel} />
            </Card>
            <Card title="Picking status">
              <Donut data={data.outbound.picking_status} />
            </Card>
            <Card title="Packing status">
              <Donut data={data.outbound.packing_status} />
            </Card>
            <Card title="Delivery status">
              <Donut data={data.outbound.delivery_status} />
            </Card>
          </div>

          {/* ===== Inventory ===== */}
          <SectionHeader title="Inventory" />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="On-hand qty" value={num(k.on_hand_qty)} />
            <Kpi label="Tracked SKUs" value={num(k.sku_on_hand)} />
            <Kpi
              label="Low stock (<10)"
              value={num(data.inventory.low_stock)}
              accent={data.inventory.low_stock ? 'text-amber-600' : 'text-slate-800'}
            />
            <Kpi
              label="Zero stock"
              value={num(data.inventory.zero_stock)}
              accent={data.inventory.zero_stock ? 'text-red-600' : 'text-slate-800'}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card title="On-hand by warehouse">
              <EmptyOr data={data.inventory.on_hand_by_warehouse}>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data.inventory.on_hand_by_warehouse}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="warehouse" tick={{ fontSize: 11 }} />
                    <YAxis width={40} />
                    <Tooltip />
                    <Bar dataKey="on_hand" fill="#2563eb" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </EmptyOr>
            </Card>
            <Card title="Top materials (on-hand)" className="lg:col-span-2">
              <EmptyOr data={data.inventory.top_materials}>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart
                    data={data.inventory.top_materials}
                    layout="vertical"
                    margin={{ left: 20, right: 16 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={150}
                      tick={{ fontSize: 11 }}
                    />
                    <Tooltip />
                    <Bar dataKey="on_hand" fill="#0891b2" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </EmptyOr>
            </Card>
            <Card title="Stock composition" className="lg:col-span-3">
              <EmptyOr data={data.inventory.composition}>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={data.inventory.composition}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="bucket" tick={{ fontSize: 12 }} />
                    <YAxis width={40} />
                    <Tooltip />
                    <Bar dataKey="qty" radius={[4, 4, 0, 0]}>
                      {data.inventory.composition.map((_, i) => (
                        <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </EmptyOr>
            </Card>
          </div>

          {/* ===== Quality & Ops ===== */}
          <SectionHeader title="Quality & Operations" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card title="Discrepancy by type">
              <Donut data={data.quality.discrepancy_by_type} />
            </Card>
            <Card title="Discrepancy by direction">
              <Donut data={data.quality.discrepancy_by_source} />
            </Card>
            <Card title="Adjustment by status">
              <Donut data={data.quality.adjustment_by_status} />
            </Card>
            <Card title="Adjustment by type">
              <Donut data={data.quality.adjustment_by_type} />
            </Card>
            <Card title="Complaints">
              <Donut data={data.quality.complaint_status} />
            </Card>
            <Card title="Oracle sync (range)">
              <Donut data={data.ops.sync_by_status} />
            </Card>
            <Card title="Last sync per module" className="lg:col-span-3">
              <EmptyOr data={data.ops.last_sync_per_module}>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
                      <tr>
                        <th className="py-2 pr-4">Module</th>
                        <th className="py-2 pr-4">Status</th>
                        <th className="py-2">Last run</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.ops.last_sync_per_module.map((s) => (
                        <tr key={s.module}>
                          <td className="py-2 pr-4 font-medium capitalize text-slate-700">
                            {s.module}
                          </td>
                          <td className="py-2 pr-4">
                            <span
                              className="rounded-full px-2 py-0.5 text-xs font-medium"
                              style={{
                                backgroundColor: `${colorFor(s.status, 0)}1a`,
                                color: colorFor(s.status, 0),
                              }}
                            >
                              {s.status}
                            </span>
                          </td>
                          <td className="py-2 text-slate-500">
                            {new Date(s.at).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </EmptyOr>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h2>
      <div className="h-px flex-1 bg-slate-200" />
    </div>
  );
}

function fmtDay(d: string) {
  // "2026-07-09" -> "07-09"
  return d.slice(5);
}
