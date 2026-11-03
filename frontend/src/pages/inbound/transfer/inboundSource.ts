/**
 * The inbounds whose screens are GR Lists of their source's own lines: Transfer
 * IN (from a Transfer Order), Local Vendor (from a Purchase Order) and
 * Customer Return (from a Return Authorization). They
 * share the Goods Receive / Putaway / History pages; this tells the pages
 * which one they show.
 */
export interface InboundSource {
  code: 'TO' | 'PO' | 'CR';
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

export const CUSTOMER_RETURN: InboundSource = {
  code: 'CR',
  base: '/admin/inbound/customer-return',
  api: '/cr-inbound',
  noun: 'customer return',
  requestPath: (id) => `/admin/inbound/customer-return/requests/${id}`,
  sourceName: 'Customer Return',
};
