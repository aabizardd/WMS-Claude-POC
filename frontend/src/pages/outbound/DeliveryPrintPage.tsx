import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import axios from 'axios';
import api from '../../lib/api';
import type { DeliveryDetail } from '../../types';
import logoIel from '../../assets/logo-iel.png';
import {
  PrintSectionTitle,
  PrintShell,
  PrintSignature,
  PrintTd,
  PrintTh,
  PrintTitleBlock,
  stamp,
} from '../../components/PrintDocument';

/** Outbound deliveries always go out under IEL. */
const DELIVERY_ORG = 'IEL';

/**
 * Printable Sales Delivery note for a Sales Order or Transfer Order delivery
 * (Delivery Plan), on the same template as the Inventory Sales print-out.
 * Always IEL's logo.
 */
export default function DeliveryPrintPage({ basePath }: { basePath: string }) {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<DeliveryDetail | null>(null);
  const [printedAt] = useState(() => new Date());
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    api
      .get<DeliveryDetail>(`/delivery/${id}`)
      .then((r) => setD(r.data))
      .catch((err) => {
        const m = axios.isAxiosError(err) ? err.response?.data?.message : null;
        setError(typeof m === 'string' ? m : 'Delivery not found.');
      });
  }, [id]);

  if (error) {
    return (
      <div className="space-y-4 p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
        <Link to={`${basePath}/delivery`} className="btn-secondary">
          ← Back
        </Link>
      </div>
    );
  }
  if (!d) {
    return <div className="p-10 text-center text-slate-400">Loading…</div>;
  }

  const isTransfer = d.source_type === 'TRANSFER_ORDER';
  const totalQty = d.items.reduce((sum, it) => sum + it.qty, 0);

  /**
   * Everything above the material rows. It is rendered inside the single
   * table's <thead>, which the browser reprints at the top of every page.
   */
  const documentHeader = (
    <>
      <PrintTitleBlock
        title="SALES DELIVERY"
        titleZh="销售发货单"
        logo={logoIel}
        printedAt={printedAt}
      />
      <PrintSectionTitle en="Sales Delivery Details" zh="销售发货详情" />
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <PrintTh en="SD Number" zh="发货单号" />
            <PrintTh en="Transaction ID" zh="订单号" />
            <PrintTh en="Delivery ID" zh="交货编号" />
            <PrintTh en="Origin WH" zh="始发仓库" />
            {isTransfer ? <PrintTh en="Destination" zh="目的仓库" /> : <PrintTh en="Customer" zh="客户" />}
            <PrintTh en="Delivery Org" zh="发货组织" />
            <PrintTh en="Delivery Date" zh="发货日期" />
            <PrintTh en="Created By" zh="创建人" />
          </tr>
        </thead>
        <tbody>
          <tr>
            <PrintTd>{d.sdo_id}</PrintTd>
            <PrintTd>{d.source_number ?? d.so_number ?? d.to_number}</PrintTd>
            <PrintTd>{d.delivery_id}</PrintTd>
            <PrintTd>{d.location}</PrintTd>
            <PrintTd>{d.customer}</PrintTd>
            <PrintTd>{DELIVERY_ORG}</PrintTd>
            <PrintTd>{stamp(d.created_at)}</PrintTd>
            <PrintTd>{d.created_by}</PrintTd>
          </tr>
        </tbody>
      </table>

      {/*
        Header-level references. Packing ID is deliberately absent: one delivery
        can cover several packings, so it belongs on the line, not up here.
      */}
      <table className="mt-2 w-full border-collapse">
        <thead>
          <tr>
            <PrintTh en="ERP Doc ID" zh="ERP单据号" />
          </tr>
        </thead>
        <tbody>
          <tr>
            <PrintTd>{d.erp_doc_id}</PrintTd>
          </tr>
        </tbody>
      </table>

    </>
  );

  return (
    <PrintShell
      backTo={`${basePath}/delivery/${d.id}`}
      title="SALES DELIVERY"
      titleZh="销售发货单"
      logo={logoIel}
      hideTitle
    >
      {/*
        One table for the whole document. Nesting the material list inside a
        second table left the document header behind on page 1, so the header
        blocks and the rows now belong to the same table: <thead> is reprinted
        on every page, <tbody> flows on.
      */}
      <table className="w-full border-collapse">
        <thead className="table-header-group">
          <tr>
            <td colSpan={8} className="border-0 p-0 align-top">
              {documentHeader}
              <PrintSectionTitle en="Material List" zh="物料清单" />
            </td>
          </tr>
          <tr>
            <PrintTh en="No" zh="序号" />
            <PrintTh en="Material Code" zh="物料编码" />
            <PrintTh en="Material Name" zh="物料名称" />
            <PrintTh en="Packing ID" zh="装箱编号" />
            <PrintTh en="Staging Bin" zh="暂存库位" />
            <PrintTh en="Picking Bin" zh="拣货库位" />
            <PrintTh en="Quantity" zh="数量" />
            <PrintTh en="Remarks" zh="行备注" />
          </tr>
        </thead>
        <tbody>
          {d.items.map((it, i) => (
            <tr key={it.id}>
              <PrintTd className="w-10 text-center">{i + 1}</PrintTd>
              <PrintTd>{it.material_code}</PrintTd>
              <PrintTd>{it.material_name}</PrintTd>
              <PrintTd>{it.packing_code}</PrintTd>
              <PrintTd>{it.bin_label}</PrintTd>
              <PrintTd>{it.picked_bins?.join(', ')}</PrintTd>
              <PrintTd className="text-right">
                {it.qty}
                {it.uom ? <span className="ml-1 text-slate-500">{it.uom}</span> : null}
              </PrintTd>
              {/* Left blank for notes written on the printed copy. */}
              <PrintTd className="w-40" />
            </tr>
          ))}
          <tr>
            <PrintTd className="text-right text-[10px] uppercase tracking-wide text-slate-500" colSpan={6}>
              Total 合计
            </PrintTd>
            <PrintTd className="text-right font-semibold">{totalQty}</PrintTd>
            <PrintTd />
          </tr>
        </tbody>
      </table>

      {/* Printed once, after the rows, so it lands on the last page. */}
      <div className="mt-8 grid grid-cols-3 gap-6" style={{ breakInside: 'avoid' }}>
        <PrintSignature en="Created By" zh="创建人" name={d.created_by} />
        <PrintSignature en="Warehouse Picker" zh="拣货人" />
        <PrintSignature en="Receiver" zh="收货人" />
      </div>
    </PrintShell>
  );
}
