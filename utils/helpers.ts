
import { supabase } from '../lib/supabase';

export const CURRENCIES = {
  INR: { symbol: '₹', name: 'Indian Rupee', locale: 'en-IN' },
  USD: { symbol: '$', name: 'US Dollar', locale: 'en-US' }
};

export const getActiveCompanyId = () => {
  const id = localStorage.getItem('activeCompanyId');
  return id && id !== 'undefined' ? id : '';
};

export const isGstRegistered = (gstin?: string | null): boolean => {
  return Boolean(gstin && typeof gstin === 'string' && gstin.trim().length > 0);
};

export interface AppSettings {
  currency: string;
  borderStyle: string;
  dateFormat: string;
  gstEnabled: boolean;
  gstType: string;
  invoicePrefix: string;
  companyGstin?: string;
  partnerCompanyId?: string;
  partnerCompanyName?: string;
  partnerCompanyGstin?: string;
  partnerCompanyAddress?: string;
}

export const getAppSettings = (): AppSettings => {
  const cid = getActiveCompanyId();
  const defaultSettings: AppSettings = { 
    currency: 'INR', 
    borderStyle: 'rounded', 
    dateFormat: 'DD/MM/YY',
    gstEnabled: false,
    gstType: 'CGST - SGST',
    invoicePrefix: '2026-27-000',
    partnerCompanyId: '',
    partnerCompanyName: '',
    partnerCompanyGstin: '',
    partnerCompanyAddress: ''
  };
  
  if (!cid) return defaultSettings;
  
  const s = localStorage.getItem(`appSettings_${cid}`);
  try {
    const parsed = s ? JSON.parse(s) : {};
    
    // Check if the current company is registered with its own GSTIN
    const activeGstin = (
      parsed.companyGstin ||
      localStorage.getItem(`company_gstin_${cid}`) ||
      localStorage.getItem('activeCompanyGstin') ||
      ''
    ).trim();

    // Check if connected with a registered partner company (RD firm)
    const partnerGstin = (parsed.partnerCompanyGstin || '').trim();
    const isPartnerRegistered = Boolean(parsed.partnerCompanyId && partnerGstin.length > 0);
    const isOwnRegistered = Boolean(activeGstin.length > 0);

    // Business Rule:
    // If the company is not registered under GST (URD) and has no registered partner firm connected,
    // do not let them enter sales or purchase invoices enabled with GST.
    const canUseGst = isOwnRegistered || isPartnerRegistered;

    let isGstEnabled = false;
    if (canUseGst) {
      isGstEnabled = parsed.gstEnabled !== undefined 
        ? (parsed.gstEnabled !== false && parsed.gstEnabled !== 'false') 
        : true;
    } else {
      isGstEnabled = false;
    }

    return {
      ...defaultSettings,
      ...parsed,
      gstEnabled: isGstEnabled,
      invoicePrefix: parsed.invoicePrefix || '2026-27-000'
    };
  } catch (e) {
    return defaultSettings;
  }
};

export interface EffectiveCompanyInfo {
  id: string;
  name: string;
  gstin: string;
  address: string;
  isUrd: boolean;
  isPartnered: boolean;
  canUseGst: boolean;
  partnerCompany: {
    id: string;
    name: string;
    gstin: string;
    address: string;
  } | null;
  originalCompany: {
    id: string;
    name: string;
    gstin: string;
    address: string;
  };
}

export const getEffectiveCompanyInfo = (activeCompanyObj?: any): EffectiveCompanyInfo => {
  const cid = activeCompanyObj?.id || getActiveCompanyId();
  const origName = activeCompanyObj?.name || localStorage.getItem('activeCompanyName') || '';
  const origGstin = (
    activeCompanyObj?.gstin ||
    localStorage.getItem(`company_gstin_${cid}`) ||
    localStorage.getItem('activeCompanyGstin') ||
    ''
  ).trim();
  const origAddress = activeCompanyObj?.address || localStorage.getItem(`company_address_${cid}`) || localStorage.getItem('activeCompanyAddress') || '';
  
  const settings = getAppSettings();
  const isOriginalUrd = !origGstin;
  const hasPartner = Boolean(settings.partnerCompanyId && settings.partnerCompanyGstin && settings.partnerCompanyGstin.trim().length > 0);
  
  const partnerCompany = hasPartner ? {
    id: settings.partnerCompanyId!,
    name: settings.partnerCompanyName || '',
    gstin: settings.partnerCompanyGstin || '',
    address: settings.partnerCompanyAddress || ''
  } : null;
  
  const isPartnered = Boolean(hasPartner);
  const canUseGst = !isOriginalUrd || isPartnered;
  
  // If connected to a registered firm, make our-side business company information use that RD company's information!
  if (isPartnered && partnerCompany) {
    return {
      id: cid,
      name: partnerCompany.name,
      gstin: partnerCompany.gstin,
      address: partnerCompany.address,
      isUrd: isOriginalUrd,
      isPartnered: true,
      canUseGst: true,
      partnerCompany,
      originalCompany: {
        id: cid,
        name: origName,
        gstin: origGstin,
        address: origAddress
      }
    };
  }
  
  return {
    id: cid,
    name: origName,
    gstin: origGstin,
    address: origAddress,
    isUrd: isOriginalUrd,
    isPartnered: false,
    canUseGst,
    partnerCompany: null,
    originalCompany: {
      id: cid,
      name: origName,
      gstin: origGstin,
      address: origAddress
    }
  };
};

export const linkPartnerCompany = async (
  cid: string, 
  partner: { id: string; name: string; gstin: string; address?: string }
) => {
  const currentSettings = getAppSettings();
  const updatedSettings = {
    ...currentSettings,
    gstEnabled: true,
    partnerCompanyId: partner.id,
    partnerCompanyName: partner.name,
    partnerCompanyGstin: partner.gstin,
    partnerCompanyAddress: partner.address || ''
  };
  localStorage.setItem(`appSettings_${cid}`, JSON.stringify(updatedSettings));
  
  try {
    await supabase.from('companies').update({ partner_company_id: partner.id }).eq('id', cid);
  } catch (err) {
    console.warn("Could not save partner_company_id to database table:", err);
  }
  
  window.dispatchEvent(new Event('appSettingsChanged'));
  window.dispatchEvent(new Event('companyUpdated'));
};

export const unlinkPartnerCompany = async (cid: string) => {
  const currentSettings = getAppSettings();
  const activeGstin = (
    localStorage.getItem(`company_gstin_${cid}`) ||
    localStorage.getItem('activeCompanyGstin') ||
    ''
  ).trim();
  const isOriginalRegistered = Boolean(activeGstin.length > 0);
  
  const updatedSettings = {
    ...currentSettings,
    gstEnabled: isOriginalRegistered ? currentSettings.gstEnabled : false,
    partnerCompanyId: '',
    partnerCompanyName: '',
    partnerCompanyGstin: '',
    partnerCompanyAddress: ''
  };
  localStorage.setItem(`appSettings_${cid}`, JSON.stringify(updatedSettings));
  
  try {
    await supabase.from('companies').update({ partner_company_id: null }).eq('id', cid);
  } catch (err) {
    console.warn("Could not remove partner_company_id from database table:", err);
  }
  
  window.dispatchEvent(new Event('appSettingsChanged'));
  window.dispatchEvent(new Event('companyUpdated'));
};

export const filterActualSalesInvoices = (invoices: any[]) => {
  return (invoices || []).filter((inv: any) => {
    if (!inv) return false;
    let itemsObj = inv.items;
    if (typeof itemsObj === 'string') {
      try { itemsObj = JSON.parse(itemsObj); } catch { itemsObj = {}; }
    }
    if (!itemsObj) itemsObj = {};
    const isPaymentVoucher = itemsObj.is_payment_voucher === true;
    const isDeliveryChallan = itemsObj.is_delivery_challan === true;
    const invNo = (inv.invoice_number || inv.bill_number || '').trim().toUpperCase();
    const isVoucherNo = invNo.startsWith('REC-') || invNo.startsWith('PAY-') || invNo.startsWith('VCH-') || invNo.startsWith('DC-');
    return !isPaymentVoucher && !isDeliveryChallan && !isVoucherNo;
  });
};

export const calculateNextInvoiceNumber = (prefix: string = '2026-27-000', latestInvoiceNumber?: string) => {
  const cleanPrefix = (prefix || '2026-27-000').trim();

  if (latestInvoiceNumber && latestInvoiceNumber.trim()) {
    const match = latestInvoiceNumber.trim().match(/^(.*?)(\d+)$/);
    if (match) {
      const basePrefix = match[1];
      const numStr = match[2];
      const nextVal = parseInt(numStr, 10) + 1;
      const paddedVal = String(nextVal).padStart(numStr.length, '0');
      return `${basePrefix}${paddedVal}`;
    }
  }

  const matchPrefix = cleanPrefix.match(/^(.*?)(\d+)$/);
  if (matchPrefix) {
    const basePrefix = matchPrefix[1];
    const numStr = matchPrefix[2];
    const numVal = parseInt(numStr, 10);
    const startVal = numVal === 0 ? 1 : numVal + 1;
    const paddedVal = String(startVal).padStart(numStr.length, '0');
    return `${basePrefix}${paddedVal}`;
  }

  return `${cleanPrefix}001`;
};

export const formatCurrency = (amount: number | undefined | null, includeSymbol: boolean = true) => {
  if (amount === undefined || amount === null || isNaN(amount)) return includeSymbol ? '₹ 0.00' : '0.00';
  const { currency } = getAppSettings();
  
  const options: any = {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  };
  
  if (includeSymbol) {
    options.style = 'currency';
    options.currency = currency;
  } else {
    options.style = 'decimal';
  }
  
  return new Intl.NumberFormat('en-IN', options).format(amount);
};

export const formatDate = (iso: any) => {
  if (!iso || typeof iso !== 'string') return '';
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  const [y, m, d] = parts;
  // Using 2-digit year as requested
  const shortYear = y.length === 4 ? y.substring(2) : y;
  return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${shortYear}`;
};

export const parseDateFromInput = (input: string): string | null => {
  if (!input) return null;
  const parts = input.split(/[\/\-.]/);
  if (parts.length !== 3) return null;
  let [d, m, y] = parts;
  if (y.length === 2) {
    const yearNum = parseInt(y);
    const prefix = yearNum < 50 ? "20" : "19";
    y = prefix + y;
  }
  const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  const dateObj = new Date(iso);
  if (isNaN(dateObj.getTime())) return null;
  return iso;
};

export const toDisplayValue = (val: any) => {
  return val === null || val === undefined ? '' : val;
};

export const toStorageValue = (val: any) => {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const num = parseFloat(String(val).replace(/[^0-9.-]/g, ''));
  return isNaN(num) ? 0 : num;
};

export const safeSupabaseSave = async (table: string, payload: any, id?: string): Promise<any> => {
  const cid = getActiveCompanyId();
  if (!cid && table !== 'companies' && table !== 'profiles') {
    throw new Error("No active workspace context.");
  }

  let cleanPayload: any = { ...payload };
  
  // Convert empty strings to null & ensure code/name fields (GSTIN, HSN, Name, Vendor/Customer/Item Name) are UPPERCASE
  Object.keys(cleanPayload).forEach(key => {
    if (cleanPayload[key] === '') {
      cleanPayload[key] = null;
    } else if (
      typeof cleanPayload[key] === 'string' &&
      ['gstin', 'hsn', 'hsn_sac', 'sac', 'pan', 'ifsc', 'sku', 'name', 'customer_name', 'vendor_name', 'item_name', 'party_name', 'company_name', 'account_name'].includes(key.toLowerCase())
    ) {
      cleanPayload[key] = cleanPayload[key].toUpperCase();
    }
  });

  if (table !== 'companies' && table !== 'profiles') {
    cleanPayload.company_id = cid;
  }

  const ghostColumns = [
    'type',
    'gst_type',
    'transaction_type', 
    'user_id', 
    'items_raw', 
    'displayDate'
  ];
  
  ghostColumns.forEach(col => delete cleanPayload[col]);

  const operation = id
    ? supabase.from(table).update(cleanPayload).eq('id', id).select()
    : supabase.from(table).insert([cleanPayload]).select();

  const res = await operation;
  if (res.error) throw res.error;
  return res;
};

export const parseInvoiceItems = (itemsRaw: any): any[] => {
  if (!itemsRaw) return [];
  let parsed = itemsRaw;
  if (typeof itemsRaw === 'string') {
    try {
      parsed = JSON.parse(itemsRaw);
    } catch {
      return [];
    }
  }
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.line_items)) return parsed.line_items;
    if (Array.isArray(parsed.items)) return parsed.items;
  }
  return [];
};

export const normalizeBill = (data: any) => {
  if (!data) return null;
  let isSale = false;
  if (data.type === 'Sale') {
    isSale = true;
  } else if (data.type === 'Purchase') {
    isSale = false;
  } else {
    isSale = !!(data.customer_name || data.invoice_number || data.challan_number) && !(data.vendor_name || data.bill_number);
  }
  const partyName = isSale ? (data.customer_name ?? data.vendor_name ?? '') : (data.vendor_name ?? data.customer_name ?? '');
  const docNumber = data.challan_number || data.invoice_number || data.bill_number || '';
  const itemsRaw = data.items || {};
  let line_items: any[] = [];
  let gstType = 'Intra-State';

  const rawList = parseInvoiceItems(itemsRaw);
  if (typeof itemsRaw === 'object' && itemsRaw !== null && !Array.isArray(itemsRaw)) {
    gstType = itemsRaw.gst_type || data.gst_type || 'Intra-State';
  } else if (data.gst_type) {
    gstType = data.gst_type;
  }

  line_items = rawList.map((it: any) => {
    const particulars = it.particulars || it.itemName || it.name || '';
    const hsn = it.hsn || it.hsnCode || '';
    const qty = parseFloat(it.qty !== undefined ? it.qty : (it.quantity !== undefined ? it.quantity : 0)) || 0;
    const rate = parseFloat(it.rate !== undefined ? it.rate : 0) || 0;
    const tax = parseFloat(it.tax !== undefined ? it.tax : (it.tax_rate !== undefined ? it.tax_rate : (it.gst || 0))) || 0;
    const amount = parseFloat(it.amount !== undefined ? it.amount : (it.taxableAmount !== undefined ? it.taxableAmount : 0)) || (qty * rate);
    const cgst = it.cgst !== undefined ? parseFloat(it.cgst) : (amount * (tax / 2 / 100));
    const sgst = it.sgst !== undefined ? parseFloat(it.sgst) : (amount * (tax / 2 / 100));
    const igst = it.igst !== undefined ? parseFloat(it.igst) : (amount * (tax / 100));
    const isInter = gstType === 'Inter-State' || gstType === 'IGST';
    const total = it.total !== undefined ? parseFloat(it.total) : (it.itemTotal !== undefined ? parseFloat(it.itemTotal) : (amount + (isInter ? igst : (cgst + sgst))));

    return {
      ...it,
      particulars,
      itemName: particulars,
      name: particulars,
      hsn,
      hsnCode: hsn,
      qty,
      quantity: qty,
      rate,
      tax,
      tax_rate: tax,
      amount,
      taxableAmount: amount,
      cgst,
      sgst,
      igst,
      total,
      itemTotal: total
    };
  });

  return {
    ...data,
    type: isSale ? 'Sale' : 'Purchase',
    vendor_name: data.vendor_name !== undefined ? data.vendor_name : partyName, 
    customer_name: data.customer_name !== undefined ? data.customer_name : partyName, 
    bill_number: data.bill_number !== undefined ? data.bill_number : docNumber, 
    invoice_number: data.invoice_number !== undefined ? data.invoice_number : docNumber,
    challan_number: data.challan_number !== undefined ? data.challan_number : docNumber,
    gst_type: gstType,
    items: line_items,
    items_raw: itemsRaw                  
  };
};

export const getSelectedLedgerIds = () => {
  const cid = getActiveCompanyId();
  if (!cid) return [];
  try { return JSON.parse(localStorage.getItem(`selectedLedgers_${cid}`) || '[]'); } catch { return []; }
};

export const READONLY_LEDGERS = [
  { id: 'ro_cgst_2_5', name: 'CGST @2.5', type: 'Charge', calc_method: 'Percentage', rate: 2.5, fixed_amount: 0, apply_on: 'Subtotal', is_default: false, is_readonly: true },
  { id: 'ro_cgst_6', name: 'CGST @6', type: 'Charge', calc_method: 'Percentage', rate: 6, fixed_amount: 0, apply_on: 'Subtotal', is_default: false, is_readonly: true },
  { id: 'ro_cgst_9', name: 'CGST @9', type: 'Charge', calc_method: 'Percentage', rate: 9, fixed_amount: 0, apply_on: 'Subtotal', is_default: false, is_readonly: true },
  { id: 'ro_cgst_14', name: 'CGST @14', type: 'Charge', calc_method: 'Percentage', rate: 14, fixed_amount: 0, apply_on: 'Subtotal', is_default: false, is_readonly: true },

  { id: 'ro_sgst_2_5', name: 'SGST @2.5', type: 'Charge', calc_method: 'Percentage', rate: 2.5, fixed_amount: 0, apply_on: 'Subtotal', is_default: false, is_readonly: true },
  { id: 'ro_sgst_6', name: 'SGST @6', type: 'Charge', calc_method: 'Percentage', rate: 6, fixed_amount: 0, apply_on: 'Subtotal', is_default: false, is_readonly: true },
  { id: 'ro_sgst_9', name: 'SGST @9', type: 'Charge', calc_method: 'Percentage', rate: 9, fixed_amount: 0, apply_on: 'Subtotal', is_default: false, is_readonly: true },
  { id: 'ro_sgst_14', name: 'SGST @14', type: 'Charge', calc_method: 'Percentage', rate: 14, fixed_amount: 0, apply_on: 'Subtotal', is_default: false, is_readonly: true },

  { id: 'ro_igst_5', name: 'IGST @5', type: 'Charge', calc_method: 'Percentage', rate: 5, fixed_amount: 0, apply_on: 'Subtotal', is_default: false, is_readonly: true },
  { id: 'ro_igst_12', name: 'IGST @12', type: 'Charge', calc_method: 'Percentage', rate: 12, fixed_amount: 0, apply_on: 'Subtotal', is_default: false, is_readonly: true },
  { id: 'ro_igst_18', name: 'IGST @18', type: 'Charge', calc_method: 'Percentage', rate: 18, fixed_amount: 0, apply_on: 'Subtotal', is_default: false, is_readonly: true },
  { id: 'ro_igst_28', name: 'IGST @28', type: 'Charge', calc_method: 'Percentage', rate: 28, fixed_amount: 0, apply_on: 'Subtotal', is_default: false, is_readonly: true }
];

export const toggleSelectedLedgerId = (ledgerId: string) => {
  const cid = getActiveCompanyId();
  if (!cid) return [];
  const current = getSelectedLedgerIds();
  const next = current.includes(ledgerId) ? current.filter((id: string) => id !== ledgerId) : [...current, ledgerId];
  localStorage.setItem(`selectedLedgers_${cid}`, JSON.stringify(next));
  return next;
};

export const fetchStockItemsWithBalance = async (company_id: string) => {
  if (!company_id) return [];
  try {
    const [{ data: stockItems }, { data: purchaseData }, { data: saleData }] = await Promise.all([
      supabase.from('stock_items').select('*').eq('company_id', company_id).eq('is_deleted', false).order('name', { ascending: true }),
      supabase.from('purchase_bills').select('*').eq('company_id', company_id).eq('is_deleted', false),
      supabase.from('sales_invoices').select('*').eq('company_id', company_id).eq('is_deleted', false)
    ]);

    if (!stockItems || stockItems.length === 0) return [];

    const normalizedVouchers = [
      ...(purchaseData || []).map((b: any) => {
        const norm = normalizeBill(b);
        return norm ? { ...norm, type: 'Purchase' } : null;
      }).filter(Boolean),
      ...(saleData || []).map((s: any) => {
        const norm = normalizeBill(s);
        return norm ? { ...norm, type: 'Sale' } : null;
      }).filter(Boolean)
    ];

    return stockItems.map((item: any) => {
      let inward = 0;
      let outward = 0;
      const itemNameLower = item.name?.trim().toLowerCase();

      normalizedVouchers.forEach((v: any) => {
        v.items?.forEach((it: any) => {
          const itName = (it.particulars || it.itemName || it.name || '').trim().toLowerCase();
          if (itName && itName === itemNameLower) {
            const q = Number(it.qty || it.quantity || 0);
            if (v.type === 'Purchase') inward += q;
            else outward += q;
          }
        });
      });

      const netStock = (Number(item.in_stock) || 0) + inward - outward;
      return {
        ...item,
        in_stock: netStock
      };
    });
  } catch (err) {
    console.error('Error fetching stock items with balance:', err);
    const { data: stockItems } = await supabase.from('stock_items').select('*').eq('company_id', company_id).eq('is_deleted', false).order('name', { ascending: true });
    return stockItems || [];
  }
};

export const syncInvoiceItemsToItemsTable = async (invoices: any[], company_id: string) => {
  if (!invoices || !Array.isArray(invoices) || !company_id) return;

  const storageKey = `zenter_synced_invoices_${company_id}`;
  let syncedIds: Set<string>;
  try {
    const raw = localStorage.getItem(storageKey);
    syncedIds = new Set(raw ? JSON.parse(raw) : []);
  } catch {
    syncedIds = new Set();
  }

  // Filter out already processed invoices
  const pendingInvoices = invoices.filter(inv => inv && inv.id && !syncedIds.has(String(inv.id)));
  if (pendingInvoices.length === 0) return;

  // Retrieve existing stock items for the company to avoid duplicates
  const { data: currentStockItems, error } = await supabase
    .from('stock_items')
    .select('id, name, hsn, rate, selling_price, tax_rate')
    .eq('company_id', company_id)
    .eq('is_deleted', false);

  if (error) {
    console.warn('Error fetching stock items for sync:', error);
    return;
  }

  const stockMap = new Map<string, any>();
  (currentStockItems || []).forEach((si: any) => {
    if (si.name) stockMap.set(si.name.trim().toUpperCase(), si);
  });

  for (const inv of pendingInvoices) {
    const itemsRaw = inv.items_raw !== undefined ? inv.items_raw : inv.items;
    const itemsList = parseInvoiceItems(itemsRaw);

    for (const it of itemsList) {
      const name = (it.particulars || it.itemName || it.name || '').trim().toUpperCase();
      if (!name) continue;

      const hsn = (it.hsn || it.hsnCode || '').toString().trim().toUpperCase();
      const rate = Number(it.rate) || 0;
      const taxRate = Number(it.tax !== undefined ? it.tax : (it.tax_rate !== undefined ? it.tax_rate : (it.gst || 0))) || 0;
      const unit = it.unit || 'PCS';

      const existing = stockMap.get(name);
      if (existing) {
        const needsUpdate = (!existing.hsn && hsn) || (!existing.rate && rate);
        if (needsUpdate) {
          const updatePayload: any = {};
          if (!existing.hsn && hsn) updatePayload.hsn = hsn;
          if (!existing.rate && rate) {
            updatePayload.rate = rate;
            updatePayload.selling_price = rate;
          }
          if (taxRate && !existing.tax_rate) updatePayload.tax_rate = taxRate;

          await supabase.from('stock_items').update(updatePayload).eq('id', existing.id);
        }
      } else {
        const newRecord = {
          name,
          hsn,
          rate,
          selling_price: rate,
          tax_rate: taxRate,
          unit,
          company_id,
          in_stock: 0,
          description: it.particulars || it.description || '',
          is_deleted: false
        };
        const { data: inserted, error: insertErr } = await supabase.from('stock_items').insert([newRecord]).select();
        if (!insertErr && inserted && inserted[0]) {
          stockMap.set(name, inserted[0]);
        }
      }
    }

    syncedIds.add(String(inv.id));
  }

  try {
    localStorage.setItem(storageKey, JSON.stringify(Array.from(syncedIds)));
  } catch (e) {
    console.warn('Could not persist synced invoices set:', e);
  }
};

export const ensureStockItems = async (items: any[], company_id: string) => {
  if (!items || !Array.isArray(items)) return;
  for (const item of items) {
    const itemName = (item.particulars || item.itemName || item.name)?.trim().toUpperCase();
    if (!itemName) continue;
    const { data: existing } = await supabase.from('stock_items').select('id, hsn, rate, tax_rate').eq('company_id', company_id).eq('name', itemName).eq('is_deleted', false).maybeSingle();
    const rate = Number(item.rate) || 0;
    const payload: any = {
      name: itemName,
      hsn: (item.hsn || item.hsnCode || '').toUpperCase(),
      rate: rate,
      selling_price: rate,
      tax_rate: Number(item.tax !== undefined ? item.tax : (item.tax_rate || 0)),
      unit: item.unit || 'PCS',
      company_id,
      is_deleted: false
    };
    if (existing) await supabase.from('stock_items').update(payload).eq('id', existing.id);
    else await supabase.from('stock_items').insert([{ ...payload, in_stock: 0 }]);
  }
};

export const ensureParty = async (name: string, type: 'customer' | 'vendor', company_id: string, partyId?: string) => {
  if (!name || !name.trim()) return;
  const nameTrim = name.trim().toUpperCase();

  // If partyId is provided, check if it already exists by id
  if (partyId) {
    const { data: byId } = await supabase
      .from('vendors')
      .select('*')
      .eq('id', partyId)
      .eq('is_deleted', false)
      .maybeSingle();

    if (byId) {
      const pType = (byId.party_type || '').toLowerCase();
      if (type === 'customer' && pType === 'vendor') {
        await supabase.from('vendors').update({ party_type: 'both', is_customer: true }).eq('id', byId.id);
      } else if (type === 'vendor' && pType === 'customer') {
        await supabase.from('vendors').update({ party_type: 'both' }).eq('id', byId.id);
      }
      return;
    }
  }

  // 1. Search unified 'vendors' table
  const { data: existingVendor } = await supabase
    .from('vendors')
    .select('*')
    .eq('company_id', company_id)
    .eq('is_deleted', false)
    .ilike('name', nameTrim)
    .maybeSingle();

  if (existingVendor) {
    const pType = (existingVendor.party_type || '').toLowerCase();
    if (type === 'customer' && pType === 'vendor') {
      await supabase.from('vendors').update({ party_type: 'both', is_customer: true }).eq('id', existingVendor.id);
    } else if (type === 'vendor' && pType === 'customer') {
      await supabase.from('vendors').update({ party_type: 'both' }).eq('id', existingVendor.id);
    }
    return;
  }

  // 2. Search legacy 'customers' table if any
  const { data: existingCustomer } = await supabase
    .from('customers')
    .select('*')
    .eq('company_id', company_id)
    .eq('is_deleted', false)
    .ilike('name', nameTrim)
    .maybeSingle();

  if (existingCustomer) {
    const newType = type === 'vendor' ? 'both' : (existingCustomer.party_type || 'customer');
    await safeSupabaseSave('vendors', {
      ...existingCustomer,
      party_type: newType,
      is_customer: true
    });
    return;
  }

  // 3. Not found, save as new party in 'vendors'
  const payload = {
    name: nameTrim,
    party_type: type,
    is_customer: type === 'customer',
    company_id,
    is_deleted: false,
    balance: 0
  };
  await safeSupabaseSave('vendors', payload);
};

export const syncTransactionToCashbook = async (transaction: any) => {
  const bill = normalizeBill(transaction);
  if (!bill) return;
  const { company_id, date, vendor_name, bill_number, grand_total, type, status } = bill;
  if (status !== 'Paid') return;
  try {
    const { data: existing } = await supabase.from('cashbooks').select('*').eq('company_id', company_id).eq('date', date).eq('is_deleted', false).maybeSingle();
    const isSale = type === 'Sale';
    
    // Check if it's a payment voucher
    const isPaymentVoucher = bill.items_raw?.is_payment_voucher === true;
    let amount = Number(grand_total) || 0;
    
    if (isPaymentVoucher) {
      const pDetails = bill.items_raw?.payment_details;
      const payments = Array.isArray(pDetails) ? pDetails : (pDetails ? [pDetails] : []);
      amount = payments.reduce((acc: number, p: any) => acc + (Number(p.payment_amount) || 0), 0);
    }
    
    const entryLabel = isPaymentVoucher
      ? `${isSale ? 'Receipt' : 'Payment'} - Voucher ${bill_number} - Account: ${bill.items_raw?.payment_details?.[0]?.payment_method || 'Cash'} - ${vendor_name}`
      : `${isSale ? 'Sales' : 'Purchase'} - Bill ${bill_number} - ${vendor_name}`;
      
    let incomeRows = []; let expenseRows = []; let cashbookId = null;
    if (existing) {
      cashbookId = existing.id;
      const raw = existing.raw_data || {};
      incomeRows = Array.isArray(raw.incomeRows) ? raw.incomeRows : [];
      expenseRows = Array.isArray(raw.expenseRows) ? raw.expenseRows : [];
      
      const alreadyIn = [...incomeRows, ...expenseRows].some(r => r.particulars?.includes(isPaymentVoucher ? `Voucher ${bill_number}` : `Bill ${bill_number}`));
      if (alreadyIn) return;
    }
    const newRow = { id: Math.random().toString(36).substr(2, 9), particulars: entryLabel, amount: amount.toString() };
    if (isSale) incomeRows.push(newRow); else expenseRows.push(newRow);
    const payload = {
      company_id, date,
      income_total: incomeRows.reduce((acc: number, r: any) => acc + (Number(r.amount) || 0), 0),
      expense_total: expenseRows.reduce((acc: number, r: any) => acc + (Number(r.amount) || 0), 0),
      balance: incomeRows.reduce((acc: number, r: any) => acc + (Number(r.amount) || 0), 0) - expenseRows.reduce((acc: number, r: any) => acc + (Number(r.amount) || 0), 0),
      raw_data: { incomeRows, expenseRows, date },
      is_deleted: false
    };
    if (cashbookId) await supabase.from('cashbooks').update(payload).eq('id', cashbookId);
    else await supabase.from('cashbooks').insert([payload]);
  } catch (err) { console.error("Cashbook Sync Error:", err); }
};

export const unsyncTransactionFromCashbook = async (transaction: any) => {
  const bill = normalizeBill(transaction);
  if (!bill) return;
  const { company_id, date, bill_number } = bill;
  try {
    const { data: existing } = await supabase.from('cashbooks').select('*').eq('company_id', company_id).eq('date', date).eq('is_deleted', false).maybeSingle();
    if (!existing) return;

    const isPaymentVoucher = bill.items_raw?.is_payment_voucher === true;
    const termToMatch = isPaymentVoucher ? `Voucher ${bill_number}` : `Bill ${bill_number}`;

    const raw = existing.raw_data || {};
    let incomeRows = Array.isArray(raw.incomeRows) ? raw.incomeRows : [];
    let expenseRows = Array.isArray(raw.expenseRows) ? raw.expenseRows : [];

    incomeRows = incomeRows.filter((r: any) => !r.particulars?.includes(termToMatch));
    expenseRows = expenseRows.filter((r: any) => !r.particulars?.includes(termToMatch));

    if (incomeRows.length === 0 && expenseRows.length === 0) {
      await supabase.from('cashbooks').update({ is_deleted: true }).eq('id', existing.id);
    } else {
      const payload = {
        income_total: incomeRows.reduce((acc: number, r: any) => acc + (Number(r.amount) || 0), 0),
        expense_total: expenseRows.reduce((acc: number, r: any) => acc + (Number(r.amount) || 0), 0),
        balance: incomeRows.reduce((acc: number, r: any) => acc + (Number(r.amount) || 0), 0) - expenseRows.reduce((acc: number, r: any) => acc + (Number(r.amount) || 0), 0),
        raw_data: { incomeRows, expenseRows, date }
      };
      await supabase.from('cashbooks').update(payload).eq('id', existing.id);
    }
  } catch (err) {
    console.error("Cashbook Unsync Error:", err);
  }
};

export const validateGstin = (gstin: string): boolean => {
  if (!gstin || typeof gstin !== 'string') return false;
  const clean = gstin.trim().toUpperCase();
  if (clean === '' || clean === 'URD' || clean === 'N/A') return true;

  // 1. Standard Indian GSTIN Regex: 2 digits state code, 10 chars PAN, 1 entity code, Z, 1 checksum
  const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  if (!gstinRegex.test(clean)) return false;

  // 2. State code validation (01 to 37, 97, 99)
  const stateCode = parseInt(clean.substring(0, 2), 10);
  if ((stateCode < 1 || stateCode > 37) && stateCode !== 97 && stateCode !== 99) {
    return false;
  }

  // 3. Modulo 36 checksum algorithm validation
  try {
    const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let sum = 0;
    const modulus = 36;
    const length = clean.length;
    
    for (let i = 0; i < length - 1; i++) {
      const charValue = chars.indexOf(clean[i]);
      if (charValue === -1) return false;
      let product = charValue * (i % 2 === 0 ? 1 : 2);
      product = Math.floor(product / modulus) + (product % modulus);
      sum += product;
    }
    
    const checksum = (modulus - (sum % modulus)) % modulus;
    const expectedChar = chars[checksum];
    const actualChar = clean[length - 1];
    
    return expectedChar === actualChar;
  } catch (e) {
    return false;
  }
};

/**
 * Checks if a voucher or ledger transaction belongs to a given party.
 * Supports party passed as an object (with id, name, alias, previous_names)
 * or as an ID or name string.
 */
export const isTransactionForParty = (
  tx: any,
  partyOrId: any,
  optionalPartyName?: string
): boolean => {
  if (!tx || !partyOrId) return false;

  let targetId = '';
  const targetNames = new Set<string>();

  if (typeof partyOrId === 'object') {
    if (partyOrId.id) targetId = String(partyOrId.id).trim();
    if (partyOrId.name) targetNames.add(String(partyOrId.name).trim().toLowerCase());
    if (partyOrId.party_name) targetNames.add(String(partyOrId.party_name).trim().toLowerCase());
    if (partyOrId.alias) targetNames.add(String(partyOrId.alias).trim().toLowerCase());
    if (Array.isArray(partyOrId.previous_names)) {
      partyOrId.previous_names.forEach((pn: any) => {
        if (pn) targetNames.add(String(pn).trim().toLowerCase());
      });
    }
  } else if (typeof partyOrId === 'string') {
    const trimmed = partyOrId.trim();
    targetId = trimmed;
    targetNames.add(trimmed.toLowerCase());
  }

  if (optionalPartyName && typeof optionalPartyName === 'string') {
    targetNames.add(optionalPartyName.trim().toLowerCase());
  }

  // 1. Check ID matching first
  if (targetId) {
    const txPartyId = tx.party_id ||
                      tx.customer_id ||
                      tx.vendor_id ||
                      tx.items_raw?.party_id ||
                      tx.items_raw?.customer_id ||
                      tx.items_raw?.vendor_id ||
                      tx.items?.party_id ||
                      tx.items?.customer_id ||
                      tx.items?.vendor_id;

    if (txPartyId && String(txPartyId).trim() === targetId) {
      return true;
    }
  }

  // 2. Check Name matching
  const candidateNames = [
    tx.customer_name,
    tx.vendor_name,
    tx.party_name,
    tx.party,
    tx.name,
    tx.items_raw?.customer_name,
    tx.items_raw?.vendor_name,
    tx.items_raw?.party_name
  ];

  for (const c of candidateNames) {
    if (c && typeof c === 'string') {
      const cNorm = c.trim().toLowerCase();
      if (targetNames.has(cNorm)) {
        return true;
      }
    }
  }

  // 3. Check payment_details inside items_raw if payment voucher
  const pDetails = tx.items_raw?.payment_details || tx.payment_details;
  if (pDetails) {
    const pArray = Array.isArray(pDetails) ? pDetails : [pDetails];
    for (const p of pArray) {
      if (!p) continue;
      if (targetId && p.party_id && String(p.party_id).trim() === targetId) {
        return true;
      }
      const pCandidateNames = [p.party_name, p.customer_name, p.vendor_name, p.party];
      for (const pn of pCandidateNames) {
        if (pn && typeof pn === 'string' && targetNames.has(pn.trim().toLowerCase())) {
          return true;
        }
      }
    }
  }

  return false;
};

/**
 * Enriches transactions with master data from party and stock item lists.
 */
export const enrichTransactionsWithMasterData = (
  transactions: any[],
  parties: any[] = [],
  stockItems: any[] = []
): any[] => {
  if (!Array.isArray(transactions)) return [];
  const partyMap = new Map<string, any>();
  parties.forEach(p => {
    if (p && p.id) partyMap.set(String(p.id), p);
  });

  const stockMap = new Map<string, any>();
  stockItems.forEach(s => {
    if (s && s.id) stockMap.set(String(s.id), s);
  });

  return transactions.map(tx => {
    if (!tx) return tx;
    const pId = tx.party_id || tx.customer_id || tx.vendor_id;
    let matchedParty = pId ? partyMap.get(String(pId)) : null;
    if (!matchedParty && (tx.customer_name || tx.vendor_name)) {
      const name = (tx.customer_name || tx.vendor_name).trim().toLowerCase();
      matchedParty = parties.find(p => p.name && p.name.trim().toLowerCase() === name);
    }

    const customerName = matchedParty ? matchedParty.name : (tx.customer_name || tx.vendor_name || '');
    const vendorName = matchedParty ? matchedParty.name : (tx.vendor_name || tx.customer_name || '');

    return {
      ...tx,
      customer_name: customerName,
      vendor_name: vendorName,
      party_name: matchedParty ? matchedParty.name : (tx.party_name || customerName)
    };
  });
};


