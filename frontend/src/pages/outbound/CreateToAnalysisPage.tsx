import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Lucide, icons } from '../../components/master/MasterKit';

/**
 * Create Transfer Order — end-to-end analysis for SA and developers: the flow
 * from Draft to Oracle and back (approval / rejection, Clone), every form
 * field with its source and filters, the server checks, the Oracle request,
 * the API and data model, and the known gaps. Static: it documents the code
 * as built (transfer-order-create.service.ts and the Create TO form).
 */

const SECTIONS = [
  ['ringkasan', 'Ringkasan'],
  ['alur-status', 'Alur status'],
  ['langkah', 'Alur end-to-end'],
  ['field', 'Field form & sumber data'],
  ['item', 'Pemilihan item'],
  ['validasi', 'Validasi server'],
  ['oracle', 'Kapan & bagaimana ke Oracle'],
  ['setelah-oracle', 'Setelah Oracle: approve / reject'],
  ['draft', 'Aturan Draft'],
  ['clone', 'Clone TO Rejected'],
  ['matriks', 'Matriks aksi per status'],
  ['api', 'API endpoint'],
  ['data', 'Model data'],
  ['gap', 'Gap & rekomendasi'],
] as const;

export default function CreateToAnalysisPage() {
  const navigate = useNavigate();
  return (
    <div className="space-y-5">
      <div className="card p-5">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/admin/outbound/transfer-stock/list')}
            aria-label="Back"
            className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-700 shadow-sm hover:bg-neutral-50"
          >
            <Lucide>{icons.chevronLeft}</Lucide>
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold text-slate-800">Analisa Create Transfer Order (End-to-End)</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              Referensi untuk SA dan developer: alur Draft → Submit → Oracle → Approve / Reject → Clone, sumber data,
              filter, validasi, API dan data model. Mendokumentasikan perilaku sistem saat ini.
            </p>
          </div>
          <Link to="/admin/outbound/transfer-stock/list/create" className="btn-primary">
            + Create TO
          </Link>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        {/* Table of contents */}
        <nav className="card hidden h-fit p-4 lg:sticky lg:top-4 lg:block" aria-label="Daftar isi">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Daftar isi</p>
          <ol className="space-y-1 text-sm">
            {SECTIONS.map(([id, label], i) => (
              <li key={id}>
                <a href={`#${id}`} className="block rounded px-2 py-1 text-slate-600 hover:bg-slate-50 hover:text-[#5166AE]">
                  {i + 1}. {label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="min-w-0 space-y-5">
          <Section id="ringkasan" n={1} title="Ringkasan">
            <p>
              Create TO membuat Transfer Order dari WMS dan mengirimnya ke Oracle (NetSuite) untuk approval. Mulai
              versi ini setiap TO bisa disimpan sebagai <B>Draft</B> dulu, masih bisa diedit atau dihapus, dan baru
              dikirim ke Oracle saat di-<B>Submit</B>. TO yang di-<B>Reject</B> di Oracle bisa di-<B>Clone</B>{' '}
              menjadi TO baru dengan isi yang sama.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Fact label="Sending Warehouse" value="Master Location (semua gudang aktif), exclude billing" />
              <Fact label="Receiving Warehouse" value="Gudang user (/me); admin semua gudang, exclude billing" />
              <Fact label="Kirim ke Oracle" value="Hanya saat Submit (background, status Syncing)" />
              <Fact label="Approve / Reject" value="Ditarik dari Oracle oleh sync terjadwal" />
            </div>
            <Table
              head={['Bagian', 'Lokasi kode']}
              rows={[
                ['Form Create / Edit / Clone', <Code>frontend/src/pages/outbound/TransferOrderCreatePage.tsx</Code>],
                ['Detail & list TO', <Code>TransferOrderDetailPage.tsx</Code>, ],
                ['List TO Out / TO In (aksi Detail / Clone)', <Code>TransferOrderTab.tsx</Code>],
                ['Logic create, draft, submit, Oracle', <Code>backend/src/transfer-orders/transfer-order-create.service.ts</Code>],
                ['Sync TO dari Oracle', <Code>transfer-order-sync.service.ts</Code>],
                ['Controller / route API', <Code>transfer-orders.controller.ts</Code>],
                ['DTO request', <Code>dto/create-transfer-order.dto.ts</Code>],
              ]}
            />
          </Section>

          <Section id="alur-status" n={2} title="Alur status">
            <p>
              Status WMS-only: <Badge tone="slate">Draft</Badge> <Badge tone="sky">Syncing</Badge>{' '}
              <Badge tone="rose">Failed</Badge>. Setelah Oracle menerima, status mengikuti Oracle (
              <Badge tone="violet">Pending Approval</Badge>, <Badge tone="orange">Pending Fulfillment</Badge>,{' '}
              <Badge tone="rose">Rejected</Badge>, dst).
            </p>
            <StatusFlow />
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <B>Save Draft</B> → <Badge tone="slate">Draft</Badge>. Tidak ada request ke Oracle.
              </li>
              <li>
                <B>Submit</B> (dari form Create, atau dari form Edit Draft) → <Badge tone="sky">Syncing</Badge> → request
                <Code>POST /transfer-orders/create</Code> ke Oracle di background.
              </li>
              <li>
                Oracle menerima → <Badge tone="violet">Pending Approval</Badge> (+ Oracle ID & Transaction ID terisi).
                Oracle menolak request / error → <Badge tone="rose">Failed</Badge> → tombol <B>Retry</B> di detail.
              </li>
              <li>
                Approver di Oracle menyetujui → status berubah lewat sync (mis. <Badge tone="orange">Pending Fulfillment</Badge>)
                → bisa Generate Picking. Approver menolak → <Badge tone="rose">Rejected</Badge> → <B>Clone</B>.
              </li>
              <li>
                <B>Delete Draft</B> → baris TO dan item dihapus permanen (belum pernah ada di Oracle).
              </li>
            </ul>
          </Section>

          <Section id="langkah" n={3} title="Alur end-to-end">
            <Table
              head={['#', 'Aktor', 'Aksi', 'Yang terjadi di sistem', 'API']}
              rows={[
                ['1', 'User', 'Klik + Create TO (TO Out atau TO In)', 'Form dimuat: dropdown gudang, class, department, default terisi', <Code>GET create/form-options</Code>],
                ['2', 'User', 'Pilih Sending Warehouse', 'Kartu material berstok di gudang itu dimuat per halaman (9/18/27), bisa dicari', <Code>GET create/items</Code>],
                ['3', 'User', 'Centang material / Quick Add / Import Excel', 'Baris masuk Selected Items; qty dicek terhadap available secara live', <Code>POST create/resolve-items</Code>],
                ['4a', 'User', 'Save Draft', 'Server memvalidasi penuh, simpan status Draft + TO ID (OUTyyyymmdd-nnn)', <Code>POST /transfer-orders {'{draft:true}'}</Code>],
                ['4b', 'User', 'Submit', 'Validasi penuh, simpan Syncing + payload Oracle, kirim di background', <Code>POST /transfer-orders {'{draft:false}'}</Code>],
                ['5', 'User', 'Buka Draft dari list (aksi Detail)', 'Langsung ke form Edit (detail mengalihkan otomatis)', <Code>GET :id/form-data?purpose=edit</Code>],
                ['6', 'User', 'Edit → Save Draft / Submit / Delete Draft', 'Header & item diganti; Submit memvalidasi ulang stok lalu kirim', <Code>PUT /:id · DELETE /:id</Code>],
                ['7', 'Sistem', 'Background send', 'Lock baris, kirim ke Oracle, simpan Oracle ID → Pending Approval, atau Failed', <Code>Oracle POST /transfer-orders/create</Code>],
                ['8', 'Approver', 'Approve / Reject di Oracle', 'Sync terjadwal menarik status baru dan line Oracle', <Code>Oracle POST /transfer-orders/get</Code>],
                ['9', 'User', 'Rejected → Clone', 'Form Create terisi isi TO lama; disimpan sebagai TO baru', <Code>GET :id/form-data?purpose=clone</Code>],
              ]}
            />
          </Section>

          <Section id="field" n={4} title="Field form & sumber data">
            <Table
              head={['Field', 'Wajib', 'Sumber & filter', 'Default', 'Ke Oracle sebagai']}
              rows={[
                [
                  <B>Sending Warehouse</B>,
                  'Ya',
                  <>
                    <B>Master Location</B> (tabel <Code>warehouses</Code>): <Code>is_inactive = false</Code>, <Code>subsidiary_id</Code> ∈
                    allowlist (default <Code>6</Code>, env <Code>SUBSIDIARY_ALLOWLIST</Code>), <B>nama tidak mengandung “billing”</B>{' '}
                    (case-insensitive). Disembunyikan bila sama dengan Receiving. Urut nama A–Z.
                  </>,
                  'Kosong',
                  <Code>location</Code>,
                ],
                [
                  <B>Receiving Warehouse</B>,
                  'Ya',
                  <>
                    <B>/me</B>: gudang yang di-assign ke user (<Code>user_warehouses</Code>, gudang aktif). Admin, atau user tanpa
                    assignment → semua gudang aktif di subsidiary. <B>Exclude billing</B> di kedua kasus. Disembunyikan bila sama
                    dengan Sending.
                  </>,
                  'Gudang header (admin) → gudang user pertama → opsi pertama',
                  <Code>transferlocation</Code>,
                ],
                [
                  <B>Class</B>,
                  'Ya',
                  <>
                    Tabel <Code>classes</Code>: aktif, <Code>subsidiary_id</Code> (list dipisah koma) memuat id allowlist.
                  </>,
                  <>Oracle ID <Code>3</Code></>,
                  <Code>class</Code>,
                ],
                [
                  <B>Department</B>,
                  'Ya',
                  <>
                    Tabel <Code>departments</Code>: aktif, filter subsidiary sama seperti Class.
                  </>,
                  <>Oracle ID <Code>3</Code></>,
                  <Code>department</Code>,
                ],
                [<B>Memo</B>, 'Tidak', 'Teks bebas, maks 999 karakter', '—', <Code>memo</Code>],
                [<B>Note Approval</B>, 'Tidak', 'Teks bebas untuk approver, maks 999 karakter', '—', <Code>note_approval</Code>],
                [
                  <B>Items</B>,
                  'Min 1, maks 200 baris',
                  'Material berstok di Sending Warehouse (lihat bagian 5). Material sama boleh di beberapa baris (tidak digabung).',
                  '—',
                  <>
                    <Code>items[]</Code> = {'{item: materials.erp_doc_id, quantity, description}'}
                  </>,
                ],
                [<B>Qty Request</B>, 'Ya', '> 0; bilangan bulat bila UoM tidak boleh desimal; total semua baris material ≤ available', '—', <Code>items[].quantity</Code>],
                [<B>Description</B>, 'Tidak', 'Per baris, maks 300 karakter', '—', <Code>items[].description</Code>],
              ]}
            />
            <Note>
              Billing dideteksi dari <B>nama gudang</B> (<Code>/billing/i</Code>) — pengecekan yang sama dipakai juga di server saat
              create/submit, sehingga request API langsung dengan gudang billing ditolak.
            </Note>
          </Section>

          <Section id="item" n={5} title="Pemilihan item">
            <Table
              head={['Cara', 'Aturan']}
              rows={[
                [
                  <B>Kartu material</B>,
                  <>
                    Baris <Code>inventory_management</Code> di Sending Warehouse yang material-nya punya <Code>erp_doc_id</Code>{' '}
                    dan punya bin stock <B>transferable</B>: <Code>bin_id</Code> terisi, <Code>avail_qty &gt; 0</Code>, bin{' '}
                    <B>bukan frozen</B> (label bin tidak mengandung <Code>FROZEN_BIN_LABEL</Code>, default <Code>KIT</Code>). Available =
                    jumlah <Code>avail_qty</Code> bin tersebut. Cari: kode atau nama material.
                  </>,
                ],
                [
                  <B>Quick Add</B>,
                  <>
                    Paste PN + qty (+ description). PN cocok bila sama persis dengan kode material atau bagian kode dari “KODE - NAMA”.
                    Hasil per PN: <Code>ok</Code>, <Code>not_found</Code>, <Code>no_erp_id</Code>, <Code>no_stock</Code>.
                  </>,
                ],
                [
                  <B>Import Excel</B>,
                  <>
                    File <Code>.xlsx</Code> maks 5 MB, template <Code>template_import_TO.xlsx</Code>. Header dikenali dari kata
                    kunci (ID/EN/中文): Kode Material / Part Number, Jumlah Transfer / Qty, Nama Item, Keterangan / Description. File
                    tidak disimpan; baris dicek seperti Quick Add.
                  </>,
                ],
                [
                  <B>Ganti Sending Warehouse</B>,
                  'Semua baris terpilih dikosongkan (dengan konfirmasi), karena item milik gudang pengirim.',
                ],
              ]}
            />
          </Section>

          <Section id="validasi" n={6} title="Validasi server">
            <p>
              Dijalankan di <Code>prepare()</Code> pada <B>setiap</B> simpan (Draft maupun Submit) dan <B>diulang saat Submit</B>{' '}
              sebuah Draft — stok bisa berubah sejak Draft disimpan.
            </p>
            <Table
              head={['Cek', 'Pesan error']}
              rows={[
                ['Sending ≠ Receiving', 'The sending and receiving warehouse must be different'],
                ['Sending ada & aktif', 'Sending warehouse not found'],
                ['Sending bukan billing', '"X" is a billing warehouse and cannot send a Transfer Order'],
                ['Receiving ada & aktif', 'Receiving warehouse not found'],
                ['Receiving bukan billing', '"X" is a billing warehouse and cannot receive a Transfer Order'],
                ['Receiving termasuk gudang user (/me)', '"X" is not one of your warehouses'],
                ['Class / Department ada', 'Selected class / department does not exist'],
                ['Material berstok di Sending', 'A selected material has no stock in "X"'],
                ['Material punya ERP item id', 'CODE has no ERP item id — sync the material from ERP first'],
                ['Qty bulat bila UoM non-desimal', 'CODE: the quantity must be a whole number'],
                ['Total qty per material ≤ available', 'CODE: Qty Request (n) exceeds the available qty (m) in "X"'],
                ['DTO: memo/note ≤ 999, description ≤ 300, 1–200 baris, qty ≥ 0.0001', 'Pesan class-validator'],
              ]}
            />
          </Section>

          <Section id="oracle" n={7} title="Kapan & bagaimana dikirim ke Oracle">
            <p>
              <B>Hanya saat Submit.</B> Tiga jalur: Submit di form Create (<Code>POST</Code> dengan <Code>draft:false</Code>),
              Submit di form Edit Draft (<Code>PUT /:id</Code> dengan <Code>draft:false</Code>), atau{' '}
              <Code>POST /:id/submit</Code>. Save Draft, Edit, Delete tidak pernah memanggil Oracle.
            </p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>TO disimpan sebagai <Badge tone="sky">Syncing</Badge> dengan <Code>create_payload</Code> (request Oracle tanpa trandate).</li>
              <li>Background (<Code>setImmediate</Code>) mengklaim baris dengan <Code>sync_lock</Code> — satu pengirim per TO.</li>
              <li><Code>trandate</Code> = tanggal hari ini WIB, format <Code>DD/MM/YYYY</Code>, diisi saat kirim.</li>
              <li>
                Request <Code>POST {'{ERP_BASE_URL}'}/transfer-orders/create</Code>, <B>tidak di-retry otomatis</B> (bisa jadi sudah
                terbuat).
              </li>
              <li>
                Sukses → simpan Oracle ID & tranid, status <Badge tone="violet">Pending Approval</Badge>, lalu tarik header &
                line Oracle (<Code>/transfer-orders/get</Code>). Bila tidak ada id di respons, dicari berdasarkan isi.
              </li>
              <li>
                Gagal → <Badge tone="rose">Failed</Badge> + pesan. HTTP 4xx = Oracle menolak; 5xx / timeout / respons tak terbaca ={' '}
                <B>uncertain</B>.
              </li>
              <li>
                <B>Retry</B> pada TO uncertain lebih dulu mencari TO di Oracle (diubah sejak 5 menit sebelum percobaan pertama,
                location + transferlocation + memo + item:qty sama) agar tidak dobel.
              </li>
              <li>Server restart saat mengirim → Failed (uncertain); yang belum sempat terkirim dikirim ulang saat boot.</li>
            </ol>
            <p className="font-medium text-slate-700">Contoh payload:</p>
            <pre className="overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">{`{
  "customform": 135,            // tetap
  "subsidiary": 6,              // tetap
  "incoterm": 1,                // tetap
  "firmed": false,              // tetap
  "useitemcostastransfercost": true,
  "files": [],
  "location": 101,              // Sending warehouse oracle_id
  "transferlocation": 205,      // Receiving warehouse oracle_id
  "class": 3,                   // class oracle_id
  "department": 3,              // department oracle_id
  "memo": "Weekly stock request",
  "note_approval": "Urgent untuk site",
  "custbody_msi_createdby_api": "Nama User",
  "items": [{ "item": 19595, "quantity": 5, "description": "" }],
  "trandate": "16/11/2026"      // ditambahkan saat kirim (WIB)
}`}</pre>
          </Section>

          <Section id="setelah-oracle" n={8} title="Setelah Oracle: approve / reject">
            <ul className="list-disc space-y-1 pl-5">
              <li>
                Approval terjadi di Oracle. WMS <B>tidak menerima push</B>; status ditarik oleh scheduler{' '}
                <Code>OracleSyncScheduler</Code> setiap <Code>ERP_SYNC_INTERVAL_MS</Code> (default 60 detik; contoh env 1 jam) lewat{' '}
                <Code>POST /transfer-orders/get</Code> incremental (<Code>lastModified</Code>). Bisa juga manual: tombol Sync ERP
                (<Code>POST /transfer-orders/sync-erp</Code>).
              </li>
              <li>
                Upsert berdasarkan <Code>oracle_id</Code>: status, header, dan line Oracle. Line WMS yang tidak ada di Oracle dan
                belum dipakai (picking/packing/delivery/GR) dihapus. <Code>remaining_qty</Code> hanya diisi saat line pertama kali
                masuk (= committed).
              </li>
              <li>
                Picking hanya untuk status <Code>Pending Fulfillment</Code>, <Code>Partially Fulfilled</Code>,{' '}
                <Code>Pending Receipt/Partially Fulfilled</Code>.
              </li>
              <li>
                <Badge tone="rose">Rejected</Badge> → TO lama tetap apa adanya (read-only); tombol <B>Clone</B> muncul di detail
                dan menu aksi list TO Out.
              </li>
            </ul>
          </Section>

          <Section id="draft" n={9} title="Aturan Draft">
            <ul className="list-disc space-y-1 pl-5">
              <li>Siapa: pembuat Draft, atau user yang punya akses ke Sending Warehouse — dan punya permission <Code>transfer-orders:create</Code>. Admin “All sites” bebas.</li>
              <li>Membuka Draft dari list (aksi <B>Detail</B>) atau URL detail → langsung ke <B>form Edit</B>. User tanpa hak edit melihat detail read-only.</li>
              <li>Form Edit: <B>Delete Draft</B>, Cancel, <B>Save Draft</B>, <B>Submit</B>. Edit mengganti seluruh header dan item.</li>
              <li><B>Stok tidak di-reserve</B> oleh Draft; divalidasi ulang saat Submit.</li>
              <li>Draft tidak muncul di <B>TO In</B>, tidak bisa <B>Generate GR</B>, tidak bisa <B>Picking</B>.</li>
              <li>Draft dapat TO ID (<Code>OUTyyyymmdd-nnn</Code>) saat pertama disimpan. Transaction ID & ERP Doc ID kosong sampai Oracle menerima.</li>
              <li>Konkurensi: edit/submit/delete hanya berhasil selama status masih Draft (update bersyarat); bila sudah di-submit dari tab lain → “This Transfer Order is no longer a Draft”.</li>
            </ul>
          </Section>

          <Section id="clone" n={10} title="Clone TO Rejected">
            <ul className="list-disc space-y-1 pl-5">
              <li>Hanya status <Badge tone="rose">Rejected</Badge>; TO yang terlihat oleh user (pembuat, gudang pengirim, atau gudang penerima).</li>
              <li>
                Membuka <Code>/list/create?clone=&lt;id&gt;</Code>: form terisi Sending, Receiving, Class, Department, Memo, Note
                Approval, item + qty + description. <B>Belum ada dokumen baru</B> sampai user Save Draft / Submit.
              </li>
              <li>Available dihitung ulang dari stok saat ini — baris yang melebihi stok langsung ditandai merah.</li>
              <li>TO Rejected yang berasal dari Oracle tidak membawa Class/Department → diisi default form (Oracle ID 3).</li>
              <li>Line yang material-nya tidak dikenal WMS dilewati dan diinformasikan lewat toast.</li>
              <li>Sending yang kini tidak valid (billing/nonaktif) → dikosongkan beserta item; Receiving yang bukan milik user → diganti default.</li>
            </ul>
          </Section>

          <Section id="matriks" n={11} title="Matriks aksi per status">
            <Table
              head={['Status', 'Edit', 'Submit', 'Delete', 'Retry', 'Clone', 'Picking', 'TO In / GR']}
              rows={[
                [<Badge tone="slate">Draft</Badge>, '✓', '✓', '✓', '—', '—', '—', '—'],
                [<Badge tone="sky">Syncing</Badge>, '—', '—', '—', '—', '—', '—', '—'],
                [<Badge tone="rose">Failed</Badge>, '—', '—', '—', '✓', '—', '—', '—'],
                [<Badge tone="violet">Pending Approval</Badge>, '—', '—', '—', '—', '—', '—', '—'],
                [<Badge tone="orange">Pending Fulfillment</Badge>, '—', '—', '—', '—', '—', '✓', '—'],
                [<Badge tone="blue">Partially Fulfilled / Pending Receipt…</Badge>, '—', '—', '—', '—', '—', '✓ (sisa)', '✓'],
                [<Badge tone="rose">Rejected</Badge>, '—', '—', '—', '—', '✓', '—', 'Terlihat di TO In'],
              ]}
            />
          </Section>

          <Section id="api" n={12} title="API endpoint (prefix /api/transfer-orders)">
            <Table
              head={['Method & path', 'Permission', 'Fungsi']}
              rows={[
                [<Code>GET create/form-options</Code>, 'create', 'Dropdown Sending/Receiving/Class/Department + default'],
                [<Code>GET create/items</Code>, 'create', 'Stok transferable Sending Warehouse (page, limit, search)'],
                [<Code>POST create/resolve-items</Code>, 'create', 'Quick Add: cocokkan PN ke stok'],
                [<Code>GET create/import-template</Code>, 'create', 'Unduh template Excel'],
                [<Code>POST create/import-parse</Code>, 'create', 'Baca file Excel (tidak disimpan)'],
                [<Code>POST /</Code>, 'create', 'Simpan TO baru: draft:true → Draft, selain itu Submit'],
                [<Code>PUT /:id</Code>, 'create', 'Edit Draft; draft:false sekaligus Submit'],
                [<Code>POST /:id/submit</Code>, 'create', 'Submit Draft apa adanya (validasi ulang)'],
                [<Code>DELETE /:id</Code>, 'create', 'Hapus Draft'],
                [<Code>GET /:id/form-data?purpose=edit|clone</Code>, 'create', 'Data form untuk Edit Draft / Clone Rejected'],
                [<Code>POST /:id/retry-sync</Code>, 'create', 'Kirim ulang TO Failed'],
                [<Code>POST sync-erp</Code>, 'sync', 'Tarik TO dari Oracle'],
                [<Code>GET /:id</Code>, 'read', 'Detail (+ can_edit_draft, can_pick)'],
              ]}
            />
          </Section>

          <Section id="data" n={13} title="Model data (transfer_orders)">
            <Table
              head={['Kolom', 'Isi']}
              rows={[
                [<Code>source</Code>, 'WMS (dibuat di WMS) / ORACLE (dari sync)'],
                [<Code>status_name</Code>, 'Draft, Syncing, Failed, lalu status Oracle'],
                [<Code>sync_status · sync_error · sync_uncertain · sync_attempts · sync_lock · sync_started_at</Code>, 'Jejak pengiriman ke Oracle'],
                [<Code>create_payload</Code>, 'Request Oracle terakhir (diisi saat Submit)'],
                [<Code>class_id · department_id · note_approval</Code>, 'Field form yang disimpan untuk Draft & Clone (baru)'],
                [<Code>warehouse_id · to_warehouse_id</Code>, 'Sending / Receiving (WMS); + nama & oracle id lokasi'],
                [<Code>outbound_id</Code>, 'TO ID WMS (OUTyyyymmdd-nnn, dipakai bersama SO)'],
                [<Code>oracle_id · tran_id</Code>, 'Diisi saat Oracle menerima'],
                [<Code>created_by_id · created_by</Code>, 'Pembuat (dasar hak edit Draft)'],
                [<Code>transfer_order_items</Code>, 'line_number, material_id, item_oracle_id, quantity, description (+ angka fulfillment dari Oracle)'],
              ]}
            />
          </Section>

          <Section id="gap" n={14} title="Gap & rekomendasi">
            <Table
              head={['Gap / risiko', 'Dampak', 'Rekomendasi']}
              rows={[
                ['Billing dideteksi dari nama gudang', 'Gudang billing dengan nama lain lolos; gudang non-billing yang namanya memuat “billing” ikut terbuang', 'Tambah flag is_billing / tipe lokasi di Master Location'],
                ['Draft tidak me-reserve stok', 'Submit bisa gagal bila stok terpakai dokumen lain', 'Pertimbangkan hold stok Draft, atau tampilkan peringatan selisih saat membuka Draft'],
                ['Approval via polling', 'Status Approved/Rejected terlambat hingga 1 interval sync', 'Webhook dari Oracle, atau tombol “Check Oracle” per TO seperti di IA'],
                ['Tidak ada audit trail edit Draft', 'Tidak tahu siapa mengubah apa; Last Modified By menampilkan “ERP Sync”', 'Tabel event/history (created, edited, submitted, deleted, cloned_from)'],
                ['Clone tidak menyimpan relasi ke TO asal', 'Tidak bisa melacak TO pengganti dari TO Rejected', 'Kolom cloned_from_id + tautan di detail'],
                ['Delete Draft = hard delete', 'TO ID (OUT…) bolong di penomoran', 'Soft delete / status Cancelled bila penomoran harus berurutan'],
                ['TO Oracle-sourced tidak punya Class/Department', 'Clone memakai default yang mungkin salah', 'Ambil class/department dari Oracle saat sync bila API menyediakan'],
                ['TO Rejected tetap tampil di TO In', 'Gudang penerima melihat TO yang tidak akan dikirim', 'Tambahkan Rejected / Closed ke status yang dikecualikan dari TO In'],
                ['Interval sync berbeda per env (60 dtk vs 1 jam)', 'Perilaku status berbeda antar environment', 'Samakan / dokumentasikan ERP_SYNC_INTERVAL_MS per env'],
              ]}
            />
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ id, n, title, children }: { id: string; n: number; title: string; children: ReactNode }) {
  return (
    <section id={id} className="card scroll-mt-4 p-5">
      <h2 className="mb-3 text-base font-semibold text-slate-800">
        <span className="mr-2 text-[#5166AE]">{n}.</span>
        {title}
      </h2>
      <div className="space-y-3 text-sm leading-relaxed text-slate-600">{children}</div>
    </section>
  );
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
          <tr>
            {head.map((h) => (
              <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => (
            <tr key={i} className="align-top">
              {r.map((c, j) => (
                <td key={j} className="px-3 py-2 text-slate-700">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TONES = {
  slate: 'border-slate-400 bg-slate-100 text-slate-700',
  sky: 'border-sky-300 bg-sky-50 text-sky-700',
  rose: 'border-rose-300 bg-rose-50 text-rose-700',
  violet: 'border-violet-300 bg-violet-50 text-violet-700',
  orange: 'border-orange-300 bg-orange-50 text-orange-700',
  blue: 'border-blue-300 bg-blue-50 text-blue-700',
  emerald: 'border-emerald-300 bg-emerald-50 text-emerald-700',
};

function Badge({ tone, children }: { tone: keyof typeof TONES; children: ReactNode }) {
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}

const B = ({ children }: { children: ReactNode }) => <b className="font-semibold text-slate-800">{children}</b>;
const Code = ({ children }: { children: ReactNode }) => (
  <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[12px] text-slate-700">{children}</code>
);

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-medium text-slate-700">{value}</p>
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-r-lg border-l-4 border-[#5166AE] bg-[#F2F4FD] px-4 py-2.5 text-sm text-[#41528c]">{children}</div>
  );
}

/** The status flow as boxes and arrows (wraps on small screens). */
function FlowBox({ tone, title, sub }: { tone: keyof typeof TONES; title: string; sub: string }) {
  return (
    <div className={`min-w-[120px] rounded-lg border px-3 py-2 text-center ${TONES[tone]}`}>
      <div className="text-sm font-semibold">{title}</div>
      <div className="text-[11px] opacity-80">{sub}</div>
    </div>
  );
}

function FlowArrow({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center px-1 text-[11px] text-slate-500">
      <span className="whitespace-nowrap">{label}</span>
      <span aria-hidden="true" className="text-lg leading-none text-slate-400">→</span>
    </div>
  );
}

function StatusFlow() {
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <FlowBox tone="slate" title="Form" sub="Create / Clone" />
        <FlowArrow label="Save Draft" />
        <FlowBox tone="slate" title="Draft" sub="WMS only, editable" />
        <FlowArrow label="Submit" />
        <FlowBox tone="sky" title="Syncing" sub="kirim ke Oracle" />
        <FlowArrow label="Oracle OK" />
        <FlowBox tone="violet" title="Pending Approval" sub="di Oracle" />
        <FlowArrow label="Approve" />
        <FlowBox tone="orange" title="Pending Fulfillment" sub="→ Picking" />
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-600">
        <span>
          <Badge tone="slate">Form</Badge> <span className="mx-1">— Submit langsung →</span> <Badge tone="sky">Syncing</Badge>
        </span>
        <span>
          <Badge tone="slate">Draft</Badge> <span className="mx-1">— Delete →</span> <i>dihapus</i>
        </span>
        <span>
          <Badge tone="sky">Syncing</Badge> <span className="mx-1">— error →</span> <Badge tone="rose">Failed</Badge>{' '}
          <span className="mx-1">— Retry →</span> <Badge tone="sky">Syncing</Badge>
        </span>
        <span>
          <Badge tone="violet">Pending Approval</Badge> <span className="mx-1">— Reject →</span> <Badge tone="rose">Rejected</Badge>{' '}
          <span className="mx-1">— Clone →</span> <Badge tone="slate">Form</Badge>
        </span>
      </div>
    </div>
  );
}
