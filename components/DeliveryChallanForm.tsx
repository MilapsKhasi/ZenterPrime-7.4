import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Save, Printer, Truck, Calendar, User, FileText, AlertTriangle, Package, ShoppingCart, Loader2 } from 'lucide-react';
import { supabase, getAuthUser } from '../lib/supabase';
import { getActiveCompanyId, safeSupabaseSave, ensureParty, ensureStockItems, normalizeBill, fetchStockItemsWithBalance } from '../utils/helpers';
import Modal from './Modal';
import StockForm from './StockForm';
import BillForm from './BillForm';
import ItemSelectDropdown from './ItemSelectDropdown';
import { InvoicePrintModal } from './InvoicePrintModal';
import { recordActivity } from '../utils/activityTracker';
import { getDraft, saveDraft, clearDraft } from '../utils/draftManager';

interface DeliveryChallanFormProps {
  initialData?: any;
  onSubmit: (challan: any, shouldPrint: boolean, isSaveAndNew: boolean) => void;
  onCancel: () => void;
}

export const DeliveryChallanForm: React.FC<DeliveryChallanFormProps> = ({
  initialData,
  onSubmit,
  onCancel
}) => {
  const cid = getActiveCompanyId();

  const [date, setDate] = useState<string>(
    initialData?.date || new Date().toISOString().split('T')[0]
  );
  const [challanNumber, setChallanNumber] = useState<string>(
    initialData?.invoice_number || initialData?.bill_number || ''
  );
  const [partyName, setPartyName] = useState<string>(
    initialData?.customer_name || initialData?.vendor_name || ''
  );
  const [vehicleNo, setVehicleNo] = useState<string>(
    initialData?.items_raw?.vehicle_no || ''
  );
  const [driverName, setDriverName] = useState<string>(
    initialData?.items_raw?.driver_name || ''
  );
  const [ewayBillNo, setEwayBillNo] = useState<string>(
    initialData?.items_raw?.eway_bill_no || ''
  );
  const [dispatchDestination, setDispatchDestination] = useState<string>(
    initialData?.items_raw?.dispatch_destination || ''
  );
  const [notes, setNotes] = useState<string>(
    initialData?.description || ''
  );

  const [parties, setParties] = useState<any[]>([]);
  const [stockItemsList, setStockItemsList] = useState<any[]>([]);
  const [existingChallans, setExistingChallans] = useState<{ id: string; number: string }[]>([]);
  const [challanNoDuplicateError, setChallanNoDuplicateError] = useState<string | null>(null);
  const [loadingParties, setLoadingParties] = useState(false);
  const [loadingChallanNo, setLoadingChallanNo] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isSaveAndNewSaving, setIsSaveAndNewSaving] = useState(false);
  const [isSaveAndPrintSaving, setIsSaveAndPrintSaving] = useState(false);
  const [showPrintModal, setShowPrintModal] = useState(false);

  const [itemModal, setItemModal] = useState<{
    isOpen: boolean;
    rowIdx: number | null;
    initialData?: any;
  }>({
    isOpen: false,
    rowIdx: null
  });

  const [stockWarningModal, setStockWarningModal] = useState<{
    isOpen: boolean;
    items: {
      itemName: string;
      stockItemId?: string;
      sku?: string;
      hsn: string;
      unit: string;
      rate: number;
      tax_rate: number;
      requiredQty: number;
      availableStock: number;
      shortageQty: number;
    }[];
  }>({
    isOpen: false,
    items: []
  });

  const [stockAdjustmentModal, setStockAdjustmentModal] = useState<{
    isOpen: boolean;
    item: any;
  }>({
    isOpen: false,
    item: null
  });

  const [purchaseDraftModal, setPurchaseDraftModal] = useState<{
    isOpen: boolean;
    initialData: any;
  }>({
    isOpen: false,
    initialData: null
  });

  const [lineItems, setLineItems] = useState<any[]>(() => {
    if (initialData?.items && Array.isArray(initialData.items) && initialData.items.length > 0) {
      return initialData.items.map((item: any) => ({
        id: item.id || Math.random().toString(),
        item_name: item.item_name || item.description || '',
        hsn: item.hsn || '',
        quantity: item.quantity || 1,
        unit: item.unit || 'PCS',
        rate: item.rate || item.price || 0,
        tax_rate: item.tax_rate || 0,
        amount: item.amount || (Number(item.quantity || 1) * Number(item.rate || 0))
      }));
    }
    return [
      { id: '1', item_name: '', hsn: '', quantity: 1, unit: 'PCS', rate: 0, tax_rate: 0, amount: 0 }
    ];
  });

  const draftKey = `delivery_challan_${cid}_${initialData?.id || 'new'}`;
  const [isDraftRestored, setIsDraftRestored] = useState(false);

  // Restore draft on initial load
  useEffect(() => {
    if (!cid) return;
    const savedDraft = getDraft(draftKey);
    if (savedDraft) {
      if (savedDraft.date) setDate(savedDraft.date);
      if (savedDraft.challanNumber) setChallanNumber(savedDraft.challanNumber);
      if (savedDraft.partyName) setPartyName(savedDraft.partyName);
      if (savedDraft.vehicleNo) setVehicleNo(savedDraft.vehicleNo);
      if (savedDraft.driverName) setDriverName(savedDraft.driverName);
      if (savedDraft.ewayBillNo) setEwayBillNo(savedDraft.ewayBillNo);
      if (savedDraft.dispatchDestination) setDispatchDestination(savedDraft.dispatchDestination);
      if (savedDraft.notes) setNotes(savedDraft.notes);
      if (savedDraft.lineItems) setLineItems(savedDraft.lineItems);
      setIsDraftRestored(true);
    }
  }, [cid, draftKey]);

  // Auto-save draft on changes
  useEffect(() => {
    if (!cid) return;
    const isMeaningful = partyName?.trim() || vehicleNo?.trim() || notes?.trim() || lineItems.some(i => i.item_name?.trim() || i.quantity > 1 || i.rate > 0);
    if (isMeaningful) {
      saveDraft(draftKey, {
        date, challanNumber, partyName, vehicleNo, driverName, ewayBillNo, dispatchDestination, notes, lineItems
      });
    }
  }, [cid, draftKey, date, challanNumber, partyName, vehicleNo, driverName, ewayBillNo, dispatchDestination, notes, lineItems]);

  // Load parties, stock items, and existing delivery challan numbers
  useEffect(() => {
    if (!cid) return;

    const loadRefData = async () => {
      setLoadingParties(true);
      try {
        const [{ data: custs }, { data: vends }, stockData, { data: dcDocs }, { data: salesDocs }] = await Promise.all([
          supabase.from('customers').select('*').eq('company_id', cid).eq('is_deleted', false),
          supabase.from('vendors').select('*').eq('company_id', cid).eq('is_deleted', false),
          fetchStockItemsWithBalance(cid),
          supabase.from('delivery_challans').select('id, challan_number, invoice_number').eq('company_id', cid).eq('is_deleted', false),
          supabase.from('sales_invoices').select('id, invoice_number').eq('company_id', cid).eq('is_deleted', false)
        ]);

        const pMap = new Map();
        (custs || []).forEach((c: any) => pMap.set(c.name?.trim().toUpperCase() || c.id, c));
        (vends || []).forEach((v: any) => pMap.set(v.name?.trim().toUpperCase() || v.id, v));

        setParties(Array.from(pMap.values()));
        setStockItemsList(stockData || []);

        const existingList: { id: string; number: string }[] = [];
        (dcDocs || []).forEach((doc: any) => {
          const num = (doc.challan_number || doc.invoice_number || '').trim();
          if (num) existingList.push({ id: doc.id, number: num });
        });
        (salesDocs || []).forEach((doc: any) => {
          const num = (doc.invoice_number || '').trim();
          if (num && !existingList.some(item => item.id === doc.id)) {
            existingList.push({ id: doc.id, number: num });
          }
        });

        setExistingChallans(existingList);
      } catch (err) {
        console.error('Error loading ref data:', err);
      } finally {
        setLoadingParties(false);
      }
    };

    loadRefData();
  }, [cid]);

  // Check for duplicate challan number
  const checkDuplicateChallanNo = (num: string, list = existingChallans) => {
    const trimmed = num.trim().toLowerCase();
    if (!trimmed) {
      setChallanNoDuplicateError(null);
      return false;
    }

    const isDup = list.some(
      item => item.number.toLowerCase() === trimmed && item.id !== initialData?.id
    );

    if (isDup) {
      const msg = `Challan number '${num.trim()}' already exists in database`;
      setChallanNoDuplicateError(msg);
      return true;
    } else {
      setChallanNoDuplicateError(null);
      return false;
    }
  };

  const handleChallanNumberChange = (val: string) => {
    setChallanNumber(val);
    checkDuplicateChallanNo(val, existingChallans);
  };

  useEffect(() => {
    if (challanNumber) {
      checkDuplicateChallanNo(challanNumber, existingChallans);
    }
  }, [challanNumber, existingChallans]);

  // Generate Challan Number if creating new
  useEffect(() => {
    if (initialData || !cid) return;

    const generateNumber = async () => {
      setLoadingChallanNo(true);
      try {
        const [{ data: dcData }, { data: salesData }] = await Promise.all([
          supabase.from('delivery_challans').select('challan_number, invoice_number').eq('company_id', cid).eq('is_deleted', false),
          supabase.from('sales_invoices').select('invoice_number').eq('company_id', cid).eq('is_deleted', false)
        ]);

        let maxSeq = 0;
        const checkSeq = (no?: string) => {
          if (no && no.startsWith('DC-')) {
            const numPart = no.substring(3);
            if (/^\d+$/.test(numPart)) {
              const parsed = parseInt(numPart, 10);
              if (!isNaN(parsed) && parsed > maxSeq) {
                maxSeq = parsed;
              }
            }
          }
        };

        (dcData || []).forEach((inv: any) => checkSeq(inv.challan_number || inv.invoice_number));
        (salesData || []).forEach((inv: any) => checkSeq(inv.invoice_number));

        const generatedNo = `DC-${(maxSeq + 1).toString().padStart(3, '0')}`;
        setChallanNumber(generatedNo);
      } catch (err) {
        console.error('Error generating DC number:', err);
        setChallanNumber('DC-001');
      } finally {
        setLoadingChallanNo(false);
      }
    };

    generateNumber();
  }, [cid, initialData]);

  const selectStockItemForDCRow = (index: number, selected: any) => {
    setLineItems(prev => {
      const updated = [...prev];
      const row = { ...updated[index] };

      if (selected) {
        row.item_name = selected.name || '';
        row.hsn = selected.hsn || '';
        row.unit = selected.unit || 'PCS';
        row.rate = selected.selling_price !== undefined && selected.selling_price !== null && selected.selling_price !== ''
          ? Number(selected.selling_price)
          : Number(selected.rate || 0);
        row.tax_rate = selected.tax_rate || 0;
      } else {
        row.item_name = '';
      }

      const qty = parseFloat(row.quantity) || 0;
      const rate = parseFloat(row.rate) || 0;
      row.amount = qty * rate;

      updated[index] = row;
      return updated;
    });
  };

  const handleSaveNewStockItem = async (itemData: any) => {
    try {
      const user = await getAuthUser();
      if (user) recordActivity(user.id, user.email || '');

      let insertedItem: any;
      if (itemModal.initialData?.id) {
        let res = await supabase.from('stock_items').update({ ...itemData }).eq('id', itemModal.initialData.id).select();
        if (res.error && (res.error.message?.includes('selling_price') || res.error.code === 'PGRST204' || res.error.code === '42703')) {
          const { selling_price, ...cleanData } = itemData;
          res = await supabase.from('stock_items').update(cleanData).eq('id', itemModal.initialData.id).select();
        }
        insertedItem = (res.data && res.data[0]) ? res.data[0] : { ...itemData, id: itemModal.initialData.id };
      } else {
        const storageData = { ...itemData, company_id: cid, is_deleted: false };
        let res = await supabase.from('stock_items').insert([storageData]).select();
        if (res.error && (res.error.message?.includes('selling_price') || res.error.code === 'PGRST204' || res.error.code === '42703')) {
          const { selling_price, ...cleanData } = storageData;
          res = await supabase.from('stock_items').insert([cleanData]).select();
        }

        insertedItem = (res.data && res.data[0]) ? res.data[0] : null;
        if (!insertedItem) {
          const { data: fetchRes } = await supabase.from('stock_items')
            .select('*')
            .eq('company_id', cid)
            .eq('name', itemData.name)
            .eq('is_deleted', false)
            .maybeSingle();
          insertedItem = fetchRes || itemData;
        }
      }

      window.dispatchEvent(new Event('stockUpdated'));
      const stockData = await fetchStockItemsWithBalance(cid);
      setStockItemsList(stockData || []);

      if (itemModal.rowIdx !== null && itemModal.rowIdx >= 0 && insertedItem) {
        selectStockItemForDCRow(itemModal.rowIdx, insertedItem);
      }

      setItemModal({ isOpen: false, rowIdx: null });
    } catch (err: any) {
      alert("Error saving stock item: " + err.message);
    }
  };

  const handleLineChange = (index: number, field: string, value: any) => {
    setLineItems(prev => {
      const updated = [...prev];
      const row = { ...updated[index], [field]: value };

      if (field === 'item_name') {
        const found = stockItemsList.find(
          s => s.name?.toLowerCase() === String(value).toLowerCase()
        );
        if (found) {
          row.hsn = found.hsn || '';
          row.unit = found.unit || 'PCS';
          row.rate = found.selling_price || found.rate || 0;
          row.tax_rate = found.tax_rate || 0;
        }
      }

      const qty = parseFloat(row.quantity) || 0;
      const rate = parseFloat(row.rate) || 0;
      row.amount = qty * rate;

      updated[index] = row;
      return updated;
    });
  };

  const addLineItem = () => {
    setLineItems(prev => [
      ...prev,
      { id: Math.random().toString(), item_name: '', hsn: '', quantity: 1, unit: 'PCS', rate: 0, tax_rate: 0, amount: 0 }
    ]);
  };

  const removeLineItem = (index: number) => {
    if (lineItems.length === 1) return;
    setLineItems(prev => prev.filter((_, i) => i !== index));
  };

  const subtotal = lineItems.reduce((acc, row) => acc + (Number(row.amount) || 0), 0);
  const totalGst = 0;
  const grandTotal = subtotal;

  const handleSave = async (shouldPrint: boolean = false, isSaveAndNew: boolean = false) => {
    if (!cid) {
      alert('Workspace company not loaded.');
      return;
    }
    if (!partyName.trim()) {
      alert('Please select or enter a Customer/Party Name.');
      return;
    }
    if (!challanNumber.trim()) {
      alert('Please enter a Delivery Challan Number.');
      return;
    }

    if (checkDuplicateChallanNo(challanNumber, existingChallans)) {
      alert(`Delivery Challan number '${challanNumber.trim()}' already exists in database. Please enter a unique challan number.`);
      return;
    }

    const validItems = lineItems.filter(item => item.item_name.trim() !== '');
    if (validItems.length === 0) {
      alert('Please add at least one stock item.');
      return;
    }

    setSaving(true);
    try {
      // 1. Fetch latest stock balances
      const latestStockList = await fetchStockItemsWithBalance(cid);
      setStockItemsList(latestStockList || []);

      // 2. Validate stock for each selected line item
      const requestedQtyMap = new Map<string, { name: string; qty: number; hsn: string; unit: string; rate: number; tax_rate: number }>();
      validItems.forEach(item => {
        const rawName = (item.item_name || '').trim();
        if (rawName) {
          const key = rawName.toUpperCase();
          const qty = Number(item.quantity) || 0;
          if (requestedQtyMap.has(key)) {
            const existing = requestedQtyMap.get(key)!;
            existing.qty += qty;
          } else {
            requestedQtyMap.set(key, {
              name: rawName,
              qty: qty,
              hsn: item.hsn || '',
              unit: item.unit || 'PCS',
              rate: Number(item.rate) || 0,
              tax_rate: Number(item.tax_rate) || 0
            });
          }
        }
      });

      const shortageList: {
        itemName: string;
        stockItemId?: string;
        sku?: string;
        hsn: string;
        unit: string;
        rate: number;
        tax_rate: number;
        requiredQty: number;
        availableStock: number;
        shortageQty: number;
      }[] = [];

      requestedQtyMap.forEach((reqObj, key) => {
        const matchedStock = (latestStockList || []).find(
          (s: any) => (s.name || '').trim().toUpperCase() === key
        );
        const available = Math.max(0, Number(matchedStock?.in_stock || 0));
        if (reqObj.qty > available) {
          shortageList.push({
            itemName: matchedStock?.name || reqObj.name,
            stockItemId: matchedStock?.id,
            sku: matchedStock?.sku || '',
            hsn: matchedStock?.hsn || reqObj.hsn,
            unit: matchedStock?.unit || reqObj.unit,
            rate: matchedStock?.rate || reqObj.rate,
            tax_rate: matchedStock?.tax_rate || reqObj.tax_rate,
            requiredQty: reqObj.qty,
            availableStock: available,
            shortageQty: reqObj.qty - available
          });
        }
      });

      if (shortageList.length > 0) {
        setSaving(false);
        setStockWarningModal({
          isOpen: true,
          items: shortageList
        });
        return;
      }

      const trimmedParty = partyName.trim().toUpperCase();
      const matchedParty = parties.find(p => p.name?.trim().toUpperCase() === trimmedParty);
      const partyId = matchedParty?.id || initialData?.party_id || initialData?.customer_id || null;

      // Auto register party & stock items
      await ensureParty(trimmedParty, 'customer', cid, partyId || undefined);
      await ensureStockItems(validItems, cid);

      const itemsPayload = {
        party_id: partyId,
        customer_id: partyId,
        is_delivery_challan: true,
        vehicle_no: vehicleNo.trim(),
        driver_name: driverName.trim(),
        eway_bill_no: ewayBillNo.trim(),
        dispatch_destination: dispatchDestination.trim(),
        line_items: validItems.map(i => {
          const matchedStock = stockItemsList.find(s => s.name?.trim().toUpperCase() === (i.item_name || '').trim().toUpperCase());
          const itemId = i.item_id || i.itemId || matchedStock?.id || null;
          return {
            item_id: itemId,
            itemId: itemId,
            stock_item_id: itemId,
            item_name: i.item_name,
            itemName: i.item_name,
            hsn: i.hsn,
            quantity: Number(i.quantity) || 0,
            unit: i.unit,
            rate: Number(i.rate) || 0,
            tax_rate: 0,
            amount: Number(i.amount) || 0
          };
        })
      };

      const payload = {
        company_id: cid,
        party_id: partyId,
        customer_id: partyId,
        customer_name: trimmedParty,
        challan_number: challanNumber.trim(),
        invoice_number: challanNumber.trim(),
        date: date,
        total_goods_value: grandTotal,
        total_without_gst: subtotal,
        total_gst: totalGst,
        grand_total: grandTotal,
        status: 'Dispatched',
        is_deleted: false,
        description: notes.trim(),
        items: itemsPayload
      };

      let savedRes;
      try {
        savedRes = await safeSupabaseSave('delivery_challans', payload, initialData?.id);
      } catch (dcErr: any) {
        console.warn('Saving to delivery_challans failed, falling back to sales_invoices:', dcErr);
        savedRes = await safeSupabaseSave('sales_invoices', payload, initialData?.id);
      }

      const savedData = savedRes?.data?.[0] || { ...payload, id: initialData?.id || 'new-dc' };
      const normalized = normalizeBill(savedData);

      clearDraft(draftKey);
      setIsDraftRestored(false);
      onSubmit(normalized, shouldPrint, isSaveAndNew);
    } catch (err: any) {
      console.error('Error saving delivery challan:', err);
      alert(`Save failed: ${err.message || 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDiscardDraft = () => {
    clearDraft(draftKey);
    setIsDraftRestored(false);
    setDate(initialData?.date || new Date().toISOString().split('T')[0]);
    setChallanNumber(initialData?.invoice_number || initialData?.bill_number || '');
    setPartyName(initialData?.customer_name || initialData?.vendor_name || '');
    setVehicleNo(initialData?.items_raw?.vehicle_no || '');
    setDriverName(initialData?.items_raw?.driver_name || '');
    setEwayBillNo(initialData?.items_raw?.eway_bill_no || '');
    setDispatchDestination(initialData?.items_raw?.dispatch_destination || '');
    setNotes(initialData?.description || '');
    setLineItems([
      { id: '1', item_name: '', hsn: '', quantity: 1, unit: 'PCS', rate: 0, tax_rate: 0, amount: 0 }
    ]);
  };

  const handleOpenStockAdjustment = () => {
    const shortageItems = stockWarningModal.items;
    if (shortageItems.length === 0) return;
    const firstItem = shortageItems[0];
    setStockWarningModal({ isOpen: false, items: [] });

    const matchedStockItem = stockItemsList.find(
      s => s.name?.trim().toUpperCase() === firstItem.itemName?.trim().toUpperCase()
    );

    setStockAdjustmentModal({
      isOpen: true,
      item: matchedStockItem || {
        id: firstItem.stockItemId,
        name: firstItem.itemName,
        sku: firstItem.sku || '',
        unit: firstItem.unit || 'PCS',
        hsn: firstItem.hsn || '',
        rate: firstItem.rate || 0,
        in_stock: firstItem.availableStock || 0
      }
    });
  };

  const handleOpenPurchaseDraft = async () => {
    const shortageItems = stockWarningModal.items;
    if (shortageItems.length === 0) return;
    setStockWarningModal({ isOpen: false, items: [] });

    let suggestedVendor = '';
    try {
      const { data: pastPurchases } = await supabase
        .from('purchase_bills')
        .select('*')
        .eq('company_id', cid)
        .eq('is_deleted', false)
        .order('date', { ascending: false });

      const shortageNames = shortageItems.map(s => s.itemName.trim().toUpperCase());
      if (pastPurchases) {
        for (const pb of pastPurchases) {
          const norm = normalizeBill(pb);
          if (norm?.vendor_name && norm.vendor_name.trim() !== '' && norm.vendor_name !== 'Unknown' && norm.items?.some((it: any) => shortageNames.includes(it.itemName?.trim().toUpperCase()))) {
            suggestedVendor = norm.vendor_name;
            break;
          }
        }
      }
    } catch (e) {
      console.error('Error fetching supplier history:', e);
    }

    const draftItems = shortageItems.map((s, idx) => ({
      id: (idx + 1).toString(),
      itemName: s.itemName,
      hsnCode: s.hsn || '',
      qty: s.shortageQty,
      unit: s.unit || 'PCS',
      rate: s.rate || 0,
      tax_rate: s.tax_rate || 0,
      taxableAmount: s.shortageQty * (s.rate || 0),
      itemTotal: s.shortageQty * (s.rate || 0)
    }));

    setPurchaseDraftModal({
      isOpen: true,
      initialData: {
        type: 'Purchase',
        vendor_name: suggestedVendor,
        bill_number: '',
        date: new Date().toISOString().split('T')[0],
        items: draftItems
      }
    });
  };

  const handleStockAdjustmentSaved = async (storageData: any) => {
    try {
      await safeSupabaseSave('stock_items', {
        ...storageData,
        company_id: cid,
        is_deleted: false
      }, stockAdjustmentModal.item?.id);

      const updatedStockList = await fetchStockItemsWithBalance(cid);
      setStockItemsList(updatedStockList || []);
      setStockAdjustmentModal({ isOpen: false, item: null });
      window.dispatchEvent(new Event('appSettingsChanged'));
    } catch (err: any) {
      alert("Error saving stock item: " + err.message);
    }
  };

  const handlePurchaseBillSaved = async () => {
    const updatedStockList = await fetchStockItemsWithBalance(cid);
    setStockItemsList(updatedStockList || []);
    setPurchaseDraftModal({ isOpen: false, initialData: null });
    window.dispatchEvent(new Event('appSettingsChanged'));
  };

  return (
    <div className="p-6 space-y-6 bg-white dark:bg-slate-900">
      {isDraftRestored && (
        <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex items-center justify-between text-xs text-amber-900 dark:text-amber-200">
          <span className="flex items-center gap-2 font-medium">
            <FileText className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>Restored unsaved draft from your previous session.</span>
          </span>
          <button
            type="button"
            onClick={handleDiscardDraft}
            className="px-2.5 py-1 bg-amber-200/70 dark:bg-amber-900/60 hover:bg-amber-300 dark:hover:bg-amber-800 text-amber-950 dark:text-amber-100 font-semibold transition-colors cursor-pointer"
          >
            Discard Draft
          </button>
        </div>
      )}

      {/* Voucher Header Info: Date, Voucher Number, Party Name */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
            Date
          </label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full h-10 px-3 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-900 dark:text-white outline-none focus:border-primary"
          />
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
            Voucher Number
          </label>
          <input
            type="text"
            value={challanNumber}
            onChange={(e) => handleChallanNumberChange(e.target.value)}
            placeholder={loadingChallanNo ? 'Generating...' : 'e.g. DC-001'}
            className={`w-full h-10 px-3 bg-white dark:bg-slate-800 text-xs font-medium text-slate-900 dark:text-white outline-none uppercase transition-colors ${
              challanNoDuplicateError
                ? 'border-2 border-red-500 bg-red-50/40 text-red-900'
                : 'border border-slate-300 dark:border-slate-700 focus:border-primary'
            }`}
          />
          {challanNoDuplicateError && (
            <p className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">
              {challanNoDuplicateError}
            </p>
          )}
        </div>

        <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
            Party Name
          </label>
          <input
            type="text"
            list="dc-parties-list"
            value={partyName}
            onChange={(e) => setPartyName(e.target.value)}
            placeholder="Select or enter party name"
            className="w-full h-10 px-3 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-900 dark:text-white outline-none focus:border-primary uppercase"
          />
          <datalist id="dc-parties-list">
            {parties.map(p => (
              <option key={p.id} value={p.name} />
            ))}
          </datalist>
        </div>
      </div>

      {/* Dispatch & Transport Details */}
      <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
        <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200 uppercase tracking-wider mb-3">
          Dispatch & Transport Details
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Vehicle Number
            </label>
            <input
              type="text"
              value={vehicleNo}
              onChange={(e) => setVehicleNo(e.target.value)}
              placeholder="e.g. MH-12-AB-1234"
              className="w-full h-10 px-3 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs text-slate-900 dark:text-white outline-none focus:border-primary uppercase"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Driver Name
            </label>
            <input
              type="text"
              value={driverName}
              onChange={(e) => setDriverName(e.target.value)}
              placeholder="e.g. Ramesh / 9876543210"
              className="w-full h-10 px-3 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs text-slate-900 dark:text-white outline-none focus:border-primary"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              E-Way Bill Number
            </label>
            <input
              type="text"
              value={ewayBillNo}
              onChange={(e) => setEwayBillNo(e.target.value)}
              placeholder="e.g. 123456789012"
              className="w-full h-10 px-3 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs text-slate-900 dark:text-white outline-none focus:border-primary"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Destination Location
            </label>
            <input
              type="text"
              value={dispatchDestination}
              onChange={(e) => setDispatchDestination(e.target.value)}
              placeholder="e.g. Warehouse 3, Pune"
              className="w-full h-10 px-3 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs text-slate-900 dark:text-white outline-none focus:border-primary"
            />
          </div>
        </div>
      </div>

      {/* Dispatched Items Section */}
      <div className="border border-slate-200 dark:border-slate-800 overflow-x-auto bg-white dark:bg-slate-900">
        <table className="w-full text-xs border-collapse">
          <thead className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-semibold">
            <tr>
              <th className="p-3 w-10 text-center border-r border-slate-200 dark:border-slate-700">#</th>
              <th className="p-3 text-left border-r border-slate-200 dark:border-slate-700 min-w-[220px]">Particulars</th>
              <th className="p-3 text-left w-24 border-r border-slate-200 dark:border-slate-700">HSN Code</th>
              <th className="p-3 text-center w-24 border-r border-slate-200 dark:border-slate-700">Quantity</th>
              <th className="p-3 text-center w-20 border-r border-slate-200 dark:border-slate-700">Unit</th>
              <th className="p-3 text-right w-28 border-r border-slate-200 dark:border-slate-700">Rate</th>
              <th className="p-3 text-right w-28">Subtotal</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {lineItems.map((item, idx) => (
              <tr key={item.id || idx}>
                <td className="p-2.5 text-center text-slate-400 border-r border-slate-100 dark:border-slate-800">{idx + 1}</td>
                <td className="p-0 border-r border-slate-100 dark:border-slate-800 min-w-[220px]">
                  <ItemSelectDropdown
                    value={item.item_name}
                    stockItems={stockItemsList}
                    onSelect={(selectedItem) => selectStockItemForDCRow(idx, selectedItem)}
                    onAddNewItem={() => setItemModal({ isOpen: true, rowIdx: idx, initialData: null })}
                    onEditItem={(itemToEdit) => setItemModal({ isOpen: true, rowIdx: idx, initialData: itemToEdit })}
                    placeholder="Select Item"
                  />
                </td>
                <td className="p-0 border-r border-slate-100 dark:border-slate-800">
                  <input
                    type="text"
                    value={item.hsn}
                    onChange={(e) => handleLineChange(idx, 'hsn', e.target.value)}
                    placeholder="HSN"
                    className="w-full h-10 px-3 outline-none bg-transparent text-slate-500 dark:text-slate-400"
                  />
                </td>
                <td className="p-0 border-r border-slate-100 dark:border-slate-800">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={item.quantity}
                    onChange={(e) => handleLineChange(idx, 'quantity', e.target.value)}
                    className="w-full h-10 px-2 text-center outline-none font-semibold dark:text-white bg-transparent"
                  />
                </td>
                <td className="p-0 border-r border-slate-100 dark:border-slate-800">
                  <input
                    type="text"
                    value={item.unit}
                    onChange={(e) => handleLineChange(idx, 'unit', e.target.value)}
                    placeholder="PCS"
                    className="w-full h-10 px-2 text-center outline-none uppercase font-semibold dark:text-white bg-transparent"
                  />
                </td>
                <td className="p-0 border-r border-slate-100 dark:border-slate-800">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={item.rate}
                    onChange={(e) => handleLineChange(idx, 'rate', e.target.value)}
                    className="w-full h-10 px-2 text-right outline-none font-semibold dark:text-white bg-transparent"
                  />
                </td>
                <td className="p-3 text-right font-semibold text-slate-900 dark:text-slate-100">
                  {(Number(item.amount) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td className="p-2.5 text-center">
                  <button
                    type="button"
                    onClick={() => removeLineItem(idx)}
                    disabled={lineItems.length === 1}
                    className="text-slate-400 hover:text-red-500 disabled:opacity-30 cursor-pointer"
                    title="Remove Item"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          type="button"
          onClick={addLineItem}
          className="w-full py-2.5 bg-slate-50 dark:bg-slate-800/50 text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider hover:bg-slate-100 dark:hover:bg-slate-800 border-t border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
        >
          + Add New Row
        </button>
      </div>

      {/* Bottom Section: Remark on Left, Amount Fields on Right */}
      <div className="flex flex-col lg:flex-row justify-between items-start pt-4 border-t border-slate-200 dark:border-slate-800 gap-8">
        <div className="w-full lg:w-1/2">
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
            Remark
          </label>
          <textarea
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Enter dispatch notes, goods condition, or delivery terms..."
            className="w-full p-3 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none text-xs resize-none h-40 focus:border-primary"
          />
        </div>

        <div className="flex flex-col items-end space-y-3 w-full lg:w-1/2">
          <div className="flex items-center justify-between w-full max-w-sm text-xs border-t border-slate-200 dark:border-slate-800 pt-3">
            <span className="text-slate-900 dark:text-slate-100 font-bold text-sm">Total Goods Value</span>
            <span className="font-bold text-xl text-primary">
              ₹{grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      </div>

      {/* Action Buttons Horizontal Bar */}
      <div className="flex flex-wrap items-center justify-end gap-3 pt-6 border-t border-slate-200 dark:border-slate-800">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="h-10 px-4 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          Discard
        </button>

        <button
          type="button"
          onClick={() => setShowPrintModal(true)}
          disabled={saving}
          className="h-10 px-5 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 text-sm font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          <Printer className="w-4 h-4 text-slate-600 dark:text-slate-400" />
          <span>Print Preview</span>
        </button>

        <button
          type="button"
          onClick={() => handleSave(false, false)}
          disabled={saving}
          className="h-10 px-5 bg-primary text-white hover:bg-primary-dark text-sm font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {saving && !isSaveAndNewSaving && !isSaveAndPrintSaving && <Loader2 className="w-4 h-4 animate-spin" />}
          <span>{initialData ? 'Update Challan' : 'Save'}</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setIsSaveAndNewSaving(true);
            handleSave(false, true).finally(() => setIsSaveAndNewSaving(false));
          }}
          disabled={saving}
          className="h-10 px-5 bg-slate-800 dark:bg-slate-700 text-white hover:bg-slate-900 dark:hover:bg-slate-600 text-sm font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {saving && isSaveAndNewSaving && <Loader2 className="w-4 h-4 animate-spin" />}
          <span>Save & New</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setIsSaveAndPrintSaving(true);
            handleSave(true, false).finally(() => setIsSaveAndPrintSaving(false));
          }}
          disabled={saving}
          className="h-10 px-5 bg-primary text-white hover:bg-primary-dark text-sm font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {saving && isSaveAndPrintSaving && <Loader2 className="w-4 h-4 animate-spin" />}
          <Printer className="w-4 h-4" />
          <span>{initialData ? 'Update & Print' : 'Save & Print'}</span>
        </button>
      </div>

      <InvoicePrintModal
        isOpen={showPrintModal}
        onClose={() => setShowPrintModal(false)}
        invoice={{
          date,
          challan_number: challanNumber || 'DRAFT',
          invoice_number: challanNumber || 'DRAFT',
          bill_number: challanNumber || 'DRAFT',
          customer_name: partyName,
          total_goods_value: grandTotal,
          grand_total: grandTotal,
          items: lineItems.map(i => ({
            itemName: i.item_name,
            hsnCode: i.hsn,
            qty: i.quantity,
            unit: i.unit,
            rate: i.rate,
            itemTotal: i.amount
          })),
          items_raw: {
            is_delivery_challan: true,
            vehicle_no: vehicleNo,
            driver_name: driverName,
            eway_bill_no: ewayBillNo,
            dispatch_destination: dispatchDestination,
            line_items: lineItems
          },
          description: notes
        }}
      />

      {/* Stock Item Modal */}
      {itemModal.isOpen && (
        <Modal
          isOpen={itemModal.isOpen}
          onClose={() => setItemModal({ isOpen: false, rowIdx: null })}
          title={itemModal.initialData ? "Edit Stock Item" : "Add New Stock Item"}
        >
          <StockForm
            initialData={itemModal.initialData}
            onSubmit={handleSaveNewStockItem}
            onCancel={() => setItemModal({ isOpen: false, rowIdx: null })}
          />
        </Modal>
      )}

      {/* Stock Warning Modal */}
      {stockWarningModal.isOpen && (
        <Modal
          isOpen={true}
          onClose={() => setStockWarningModal({ isOpen: false, items: [] })}
          title="Stock Not Available"
          maxWidth="max-w-xl"
        >
          <div className="p-6 space-y-6">
            <div className="flex items-start space-x-3.5">
              <div className="p-2.5 bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 rounded-lg flex-shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">Stock Not Available</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  The following items do not have enough stock to complete this Delivery Challan.
                </p>
              </div>
            </div>

            <div className="space-y-3 max-h-[320px] overflow-y-auto pr-1 custom-scrollbar">
              {stockWarningModal.items.map((item, idx) => (
                <div key={idx} className="p-3.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 rounded-lg space-y-2">
                  <div className="font-bold text-sm text-slate-900 dark:text-white flex items-center space-x-1.5">
                    <span className="text-amber-500">•</span>
                    <span>{item.itemName}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs font-mono bg-white dark:bg-slate-900 p-2.5 rounded border border-slate-200/80 dark:border-slate-800">
                    <div>
                      <span className="text-slate-400 dark:text-slate-500 block text-[10px] font-sans uppercase tracking-wider">Required</span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">{item.requiredQty} {item.unit}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 dark:text-slate-500 block text-[10px] font-sans uppercase tracking-wider">Available</span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">{item.availableStock} {item.unit}</span>
                    </div>
                    <div>
                      <span className="text-rose-500 block text-[10px] font-sans uppercase tracking-wider font-semibold">Shortage</span>
                      <span className="font-bold text-rose-600 dark:text-rose-400">{item.shortageQty} {item.unit}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-end gap-2.5 pt-4 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setStockWarningModal({ isOpen: false, items: [] })}
                className="w-full sm:w-auto px-4 py-2 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-md transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleOpenStockAdjustment}
                className="w-full sm:w-auto px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-md transition-colors shadow-xs flex items-center justify-center space-x-1.5 cursor-pointer"
              >
                <Package className="w-4 h-4" />
                <span>Add Stock</span>
              </button>
              <button
                type="button"
                onClick={handleOpenPurchaseDraft}
                className="w-full sm:w-auto px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-md transition-colors shadow-xs flex items-center justify-center space-x-1.5 cursor-pointer"
              >
                <ShoppingCart className="w-4 h-4" />
                <span>Purchase New Qty</span>
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Stock Adjustment Modal */}
      {stockAdjustmentModal.isOpen && (
        <Modal
          isOpen={true}
          onClose={() => setStockAdjustmentModal({ isOpen: false, item: null })}
          title="Stock Adjustment / Opening Stock"
          maxWidth="max-w-5xl"
        >
          <StockForm
            initialData={stockAdjustmentModal.item}
            focusStockField={true}
            onSubmit={handleStockAdjustmentSaved}
            onCancel={() => setStockAdjustmentModal({ isOpen: false, item: null })}
          />
        </Modal>
      )}

      {/* Purchase Bill Draft Modal */}
      {purchaseDraftModal.isOpen && (
        <Modal
          isOpen={true}
          onClose={() => setPurchaseDraftModal({ isOpen: false, initialData: null })}
          title="Create Purchase Bill for Stock Shortage"
          maxWidth="max-w-5xl"
        >
          <BillForm
            initialData={purchaseDraftModal.initialData}
            focusQtyField={true}
            onSubmit={handlePurchaseBillSaved}
            onCancel={() => setPurchaseDraftModal({ isOpen: false, initialData: null })}
          />
        </Modal>
      )}
    </div>
  );
};

export default DeliveryChallanForm;

