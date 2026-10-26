import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import axios from 'axios';
import api from '../../lib/api';
import type { SalesDeliveryDetail } from '../../types';
import logoMso from '../../assets/logo-mso.png';
import logoIel from '../../assets/logo-iel.png';
import {
  PrintSectionTitle,
  PrintShell,
  PrintSignature,
  PrintTd,
  PrintTh,
  stamp,
} from '../../components/PrintDocument';

/**
 * Printable Sales Delivery / Sales Return note, on the shared print template.
 *
 * The organisation is fixed to IEL, which is the only subsidiary this WMS
 * serves; everything else comes from the document.
 */
const DELIVERY_ORG = 'IEL';

/**
 * Which company the note is printed under: goods leaving an IMIP or IWIP
 * warehouse go out under MSO, everything else under IEL.
 */
function printLogo(origin: string | null): string {
  return /IMIP|IWIP/i.test(origin ?? '') ? logoMso : logoIel;
}

export default function SalesDeliveryPrintPage() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<SalesDeliveryDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    api
      .get<SalesDeliveryDetail>(`/sales-delivery/${id}`)
      .then((r) => setD(r.data))
      .catch((err) => {
        const m = axios.isAxiosError(err) ? err.response?.data?.message : null;
        setError(typeof m === 'string' ? m : 'Sales delivery not found.');
      });
  }, [id]);

  if (error) {
    return (
      <div className="space-y-4 p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
        <Link to="/admin/inventory/sales-delivery" className="btn-secondary">
          ← Back
        </Link>
      </div>
    );
  }
  if (!d) {
    return <div className="p-10 text-center text-slate-400">Loading…</div>;
  }

  const customer = d.customer_name
    ? d.customer_entity_id
      ? `${d.customer_entity_id} — ${d.customer_name}`
      : d.customer_name
    : null;

  return (
    <PrintShell
      backTo={`/admin/inventory/sales-delivery/${d.id}`}
      title="SALES DELIVERY"
      titleZh="销售发货单"
      logo={printLogo(d.from_warehouse)}
    >
      <PrintSectionTitle en="Sales Delivery Details" zh="销售发货详情" />
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <PrintTh en="SD Number" zh="发货单号" />
            <PrintTh en="Origin WH" zh="始发仓库" />
            <PrintTh en="Customer" zh="客户" />
            <PrintTh en="Delivery Org" zh="发货组织" />
            <PrintTh en="Delivery Date" zh="发货日期" />
            <PrintTh en="Created By" zh="创建人" />
          </tr>
        </thead>
        <tbody>
          <tr>
            <PrintTd>{d.delivery_number}</PrintTd>
            <PrintTd>{d.from_warehouse}</PrintTd>
            <PrintTd>{customer}</PrintTd>
            <PrintTd>{DELIVERY_ORG}</PrintTd>
            <PrintTd>{stamp(d.created_at)}</PrintTd>
            <PrintTd>{d.created_by}</PrintTd>
          </tr>
        </tbody>
      </table>

      {/* Header-level note. */}
      <table className="mt-2 w-full border-collapse">
        <thead>
          <tr>
            <PrintTh en="To Location" zh="目的仓库" />
            <PrintTh en="Memo" zh="备注" />
          </tr>
        </thead>
        <tbody>
          <tr>
            <PrintTd className="w-1/3">{d.to_warehouse}</PrintTd>
            <PrintTd>{d.memo}</PrintTd>
          </tr>
        </tbody>
      </table>

      <PrintSectionTitle en="Material List" zh="物料清单" />
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <PrintTh en="No" zh="序号" />
            <PrintTh en="Material Code" zh="物料编码" />
            <PrintTh en="Material Name" zh="物料名称" />
            <PrintTh en="Bin Label" zh="库位标签" />
            <PrintTh en="Qty Delivered" zh="配送数量" />
            <PrintTh en="Remarks" zh="行备注" />
          </tr>
        </thead>
        <tbody>
          {d.items.map((it, i) => (
            <tr key={it.id}>
              <PrintTd className="w-10 text-center">{i + 1}</PrintTd>
              <PrintTd>{it.material_code}</PrintTd>
              <PrintTd>{it.material_name}</PrintTd>
              <PrintTd>{it.bin_label}</PrintTd>
              <PrintTd className="text-right">
                {it.qty_transfer}
                {it.uom_code ? <span className="ml-1 text-slate-500">{it.uom_code}</span> : null}
              </PrintTd>
              <PrintTd>{it.remarks}</PrintTd>
            </tr>
          ))}
          <tr>
            <PrintTd className="text-right text-[10px] uppercase tracking-wide text-slate-500" colSpan={4}>
              Total 合计
            </PrintTd>
            <PrintTd className="text-right font-semibold">{d.total_qty}</PrintTd>
            <PrintTd />
          </tr>
        </tbody>
      </table>

      <div className="mt-8 grid grid-cols-3 gap-6">
        <PrintSignature en="Created By" zh="创建人" name={d.created_by} />
        <PrintSignature en="Warehouse Picker" zh="拣货人" />
        <PrintSignature en="Receiver" zh="收货人" />
      </div>
    </PrintShell>
  );
}
