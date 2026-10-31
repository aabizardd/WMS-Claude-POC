/**
 * The inbounds whose screens are GR Lists of their source's own lines: Transfer
 * IN (from a Transfer Order) and Local Vendor (from a Purchase Order). They
 * share the Goods Receive / Putaway / History pages; this tells the pages
 * which one they show.
 */
export interface InboundSource {
  code: 'TO' | 'PO';
  /** Route prefix of the module's pages. */
  base: string;
  /** API prefix of its Goods Receive / Putaway / History endpoints. */
  api: string;
  /** How the page subtitles name it ("… for transfer order"). */
  noun: string;
  /** The Request detail of a source document. */
  requestPath: (id: string) => string;
  /** Whose lines a deleted GR List frees again. */
  sourceName: string;
}

export const TRANSFER_IN: InboundSource = {
  code: 'TO',
  base: '/admin/inbound/transfer',
  api: '/transfer-inbound',
  noun: 'transfer order',
  requestPath: (id) => `/admin/inbound/transfer/to/${id}`,
  sourceName: 'Transfer Order',
};

export const LOCAL_VENDOR: InboundSource = {
  code: 'PO',
  base: '/admin/inbound/local',
  api: '/po-inbound',
  noun: 'local vendor',
  requestPath: (id) => `/admin/inbound/local/po/${id}`,
  sourceName: 'Purchase Order',
};
