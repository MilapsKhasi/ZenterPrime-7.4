
import React, { useState, useEffect, useRef } from 'react';
import { Save, Package, Tag, Box, Hash, Scale, X, Loader2, FileText, Fingerprint } from 'lucide-react';
import { toDisplayValue, toStorageValue, getAppSettings, CURRENCIES, getActiveCompanyId } from '../utils/helpers';
import { recordActivity } from '../utils/activityTracker';
import { supabase, getAuthUser } from '../lib/supabase';
import { getDraft, saveDraft, clearDraft } from '../utils/draftManager';
import { createNewMasterId, updateMasterIdOnEdit } from '../utils/masterIdHelper';

interface StockFormProps {
  initialData?: any;
  onSubmit: (item: any, isSaveAndNew?: boolean) => void;
  onCancel: () => void;
  focusStockField?: boolean;
}

const TAX_RATES = [0, 5, 12, 18, 28];

const StockForm: React.FC<StockFormProps> = ({ initialData, onSubmit, onCancel, focusStockField }) => {
  const cid = getActiveCompanyId();
  const [loading, setLoading] = useState(false);
  const [isSaveAndNew, setIsSaveAndNew] = useState(false);
  const [isDraftRestored, setIsDraftRestored] = useState(false);

  const draftKey = `stock_${cid}_${initialData?.id || 'new'}`;

  const [formData, setFormData] = useState<any>({
      name: '', sku: '', unit: 'PCS', hsn: '', rate: 0, selling_price: 0, in_stock: 0, description: '', tax_rate: 18, kg_per_bag: 0
  });

  const currencySymbol = CURRENCIES[getAppSettings().currency as keyof typeof CURRENCIES]?.symbol || '₹';
  const firstInputRef = useRef<HTMLInputElement>(null);
  const stockInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const savedDraft = getDraft(draftKey);
    if (savedDraft) {
      setFormData(savedDraft);
      setIsDraftRestored(true);
    } else if (initialData) {
      setFormData({ 
        name: initialData.name || '',
        sku: initialData.sku || '',
        unit: initialData.unit || 'PCS',
        hsn: initialData.hsn || '',
        rate: toDisplayValue(initialData.rate),
        selling_price: toDisplayValue(initialData.selling_price || 0),
        in_stock: toDisplayValue(initialData.in_stock),
        description: initialData.description || '',
        tax_rate: initialData.tax_rate || 18,
        kg_per_bag: toDisplayValue(initialData.kg_per_bag)
      });
    }
    setTimeout(() => {
      if (focusStockField && stockInputRef.current) {
        stockInputRef.current.focus();
        stockInputRef.current.select();
      } else {
        firstInputRef.current?.focus();
        firstInputRef.current?.select();
      }
    }, 150);
  }, [initialData, focusStockField, draftKey]);

  // Auto-save draft
  useEffect(() => {
    if (!cid) return;
    if (formData.name?.trim() || formData.sku?.trim() || formData.hsn?.trim() || formData.rate > 0 || formData.selling_price > 0) {
      saveDraft(draftKey, formData);
    }
  }, [formData, draftKey, cid]);

  const handleInputChange = (field: string, value: any) => { 
    if (field === 'name') {
      setFormData({ ...formData, name: typeof value === 'string' ? value.toUpperCase() : value });
    } else {
      setFormData({ ...formData, [field]: value }); 
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      if (loading) return;
      if (!formData.name.trim()) return alert("Item name is mandatory.");
      
      setLoading(true);
      try {
        const user = await getAuthUser();
        if (user) recordActivity(user.id, user.email || '');

        const oldName = initialData?.name ? initialData.name.trim().toUpperCase() : null;
        const newName = formData.name.trim().toUpperCase();

        const existingPrevNames: string[] = Array.isArray(initialData?.previous_names) ? initialData.previous_names : [];
        const updatedPrevNames = oldName && oldName !== newName && !existingPrevNames.includes(oldName)
          ? [...existingPrevNames, oldName]
          : existingPrevNames;

        let finalMasterId = initialData?.master_id;
        if (finalMasterId) {
          finalMasterId = updateMasterIdOnEdit(finalMasterId);
        } else if (cid) {
          finalMasterId = await createNewMasterId(cid, 'stock_items');
        }

        const storageData = { 
          ...formData, 
          ...(initialData?.id ? { id: initialData.id } : {}),
          master_id: finalMasterId,
          previous_names: updatedPrevNames,
          name: newName,
          rate: toStorageValue(formData.rate), 
          selling_price: toStorageValue(formData.selling_price),
          in_stock: toStorageValue(formData.in_stock),
          kg_per_bag: toStorageValue(formData.kg_per_bag)
        };
        await onSubmit(storageData, isSaveAndNew);

        // If editing an existing item, ensure historical vouchers line_items are stamped with item_id
        if (initialData?.id && cid) {
          try {
            const [{ data: salesInvs }, { data: purchBills }] = await Promise.all([
              supabase.from('sales_invoices').select('*').eq('company_id', cid).eq('is_deleted', false),
              supabase.from('purchase_bills').select('*').eq('company_id', cid).eq('is_deleted', false)
            ]);

            for (const inv of (salesInvs || [])) {
              if (inv.items) {
                const isWrapped = inv.items && typeof inv.items === 'object' && Array.isArray(inv.items.line_items);
                const lineItems: any[] = isWrapped ? inv.items.line_items : (Array.isArray(inv.items) ? inv.items : []);
                let modified = false;
                const updated = lineItems.map((li: any) => {
                  const liItemId = li.item_id || li.itemId;
                  const liName = (li.itemName || li.item_name || '').trim().toUpperCase();
                  if ((liItemId && String(liItemId) === String(initialData.id)) || (oldName && liName === oldName)) {
                    modified = true;
                    return { ...li, item_id: initialData.id, itemId: initialData.id, stock_item_id: initialData.id };
                  }
                  return li;
                });
                if (modified) {
                  const payloadItems = isWrapped ? { ...inv.items, line_items: updated } : updated;
                  await supabase.from('sales_invoices').update({ items: payloadItems }).eq('id', inv.id);
                }
              }
            }

            for (const bill of (purchBills || [])) {
              if (bill.items) {
                const isWrapped = bill.items && typeof bill.items === 'object' && Array.isArray(bill.items.line_items);
                const lineItems: any[] = isWrapped ? bill.items.line_items : (Array.isArray(bill.items) ? bill.items : []);
                let modified = false;
                const updated = lineItems.map((li: any) => {
                  const liItemId = li.item_id || li.itemId;
                  const liName = (li.itemName || li.item_name || '').trim().toUpperCase();
                  if ((liItemId && String(liItemId) === String(initialData.id)) || (oldName && liName === oldName)) {
                    modified = true;
                    return { ...li, item_id: initialData.id, itemId: initialData.id, stock_item_id: initialData.id };
                  }
                  return li;
                });
                if (modified) {
                  const payloadItems = isWrapped ? { ...bill.items, line_items: updated } : updated;
                  await supabase.from('purchase_bills').update({ items: payloadItems }).eq('id', bill.id);
                }
              }
            }
          } catch (stkErr) {
            console.warn('Error linking historical stock line items:', stkErr);
          }
        }

        clearDraft(draftKey);
        setIsDraftRestored(false);
        if (isSaveAndNew) {
          setFormData({
            name: '', sku: '', unit: 'PCS', hsn: '', rate: 0, selling_price: 0, in_stock: 0, description: '', tax_rate: 18, kg_per_bag: 0
          });
          setTimeout(() => firstInputRef.current?.focus(), 100);
        }
      } catch (err: any) {
        alert("Error saving item: " + err.message);
      } finally {
        setLoading(false);
      }
  };

  const handleDiscardDraft = () => {
    clearDraft(draftKey);
    setIsDraftRestored(false);
    if (initialData) {
      setFormData({
        name: initialData.name || '',
        sku: initialData.sku || '',
        unit: initialData.unit || 'PCS',
        hsn: initialData.hsn || '',
        rate: toDisplayValue(initialData.rate),
        selling_price: toDisplayValue(initialData.selling_price || 0),
        in_stock: toDisplayValue(initialData.in_stock),
        description: initialData.description || '',
        tax_rate: initialData.tax_rate || 18,
        kg_per_bag: toDisplayValue(initialData.kg_per_bag)
      });
    } else {
      setFormData({
        name: '', sku: '', unit: 'PCS', hsn: '', rate: 0, selling_price: 0, in_stock: 0, description: '', tax_rate: 18, kg_per_bag: 0
      });
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 flex flex-col max-h-[90vh] overflow-hidden">
        {isDraftRestored && (
          <div className="mx-4 sm:mx-8 mt-4 p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex items-center justify-between text-xs text-amber-900 dark:text-amber-200">
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
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-6 bg-white dark:bg-slate-900 custom-scrollbar">
            <div className="space-y-6">
                {initialData?.master_id && (
                  <div className="flex items-center space-x-2">
                    <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Master ID:</span>
                    <span className="inline-flex items-center px-2.5 py-0.5 text-[11px] font-bold bg-primary/10 text-primary border border-primary/20">
                      <Fingerprint className="w-3 h-3 mr-1" />
                      {initialData.master_id}
                    </span>
                  </div>
                )}
                <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Item Name</label>
                    <input 
                        ref={firstInputRef} 
                        type="text" 
                        required
                        value={toDisplayValue(formData.name)} 
                        onChange={(e) => handleInputChange('name', e.target.value)} 
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 outline-none text-base font-bold text-slate-900 dark:text-white focus:border-slate-500 uppercase" 
                        placeholder="e.g. PREMIUM RICE" 
                    />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">SKU / Code</label>
                        <input 
                            type="text" 
                            value={toDisplayValue(formData.sku)} 
                            onChange={(e) => handleInputChange('sku', e.target.value)} 
                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 outline-none text-sm focus:border-slate-500 dark:text-slate-100" 
                            placeholder="Optional" 
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">HSN Code</label>
                        <input 
                            type="text" 
                            value={toDisplayValue(formData.hsnCode || formData.hsn)} 
                            onChange={(e) => handleInputChange('hsn', e.target.value)} 
                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 outline-none text-sm focus:border-slate-500 dark:text-slate-100" 
                            placeholder="Optional" 
                        />
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Unit of Measure</label>
                        <div className="relative">
                            <select 
                                value={formData.unit} 
                                onChange={(e) => handleInputChange('unit', e.target.value)} 
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 outline-none text-sm bg-white dark:bg-slate-800 appearance-none focus:border-slate-500 dark:text-slate-100"
                            >
                                {['PCS', 'NOS', 'KGS', 'LTR', 'BAGS', 'BOX', 'DRUMS', 'PACKS'].map(u => <option key={u} value={u} className="bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100">{u}</option>)}
                            </select>
                            <Box className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none" />
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Opening Stock</label>
                        <input 
                            ref={stockInputRef}
                            type="number" 
                            step="any" 
                            value={toDisplayValue(formData.in_stock)} 
                            onChange={(e) => handleInputChange('in_stock', e.target.value)} 
                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 outline-none text-sm font-medium focus:border-slate-500 dark:text-slate-100" 
                        />
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Purchase Rate ({currencySymbol})</label>
                        <input 
                            type="number" 
                            step="any" 
                            value={toDisplayValue(formData.rate)} 
                            onChange={(e) => handleInputChange('rate', e.target.value)} 
                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 outline-none text-sm font-medium text-slate-900 dark:text-white bg-white dark:bg-slate-800 focus:border-slate-500" 
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Selling Price ({currencySymbol})</label>
                        <input 
                            type="number" 
                            step="any" 
                            value={toDisplayValue(formData.selling_price)} 
                            onChange={(e) => handleInputChange('selling_price', e.target.value)} 
                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 outline-none text-sm font-medium text-slate-900 dark:text-white bg-white dark:bg-slate-800 focus:border-slate-500" 
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Default GST %</label>
                        <select 
                            value={formData.tax_rate} 
                            onChange={(e) => handleInputChange('tax_rate', Number(e.target.value))} 
                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 outline-none text-sm font-medium text-slate-900 dark:text-white bg-white dark:bg-slate-800 appearance-none focus:border-slate-500"
                        >
                            {TAX_RATES.map(r => <option key={r} value={r} className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white">{r}% GST</option>)}
                        </select>
                    </div>
                </div>

                <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Item Description</label>
                    <textarea 
                        rows={3} 
                        value={toDisplayValue(formData.description)} 
                        onChange={(e) => handleInputChange('description', e.target.value)} 
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 outline-none text-sm focus:border-slate-500 dark:text-slate-100 resize-none" 
                        placeholder="Optional remarks..." 
                    />
                </div>
            </div>

            <div className="pt-6 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-3">
                <button 
                  type="button" 
                  onClick={onCancel} 
                  disabled={loading} 
                  className="h-10 px-4 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors cursor-pointer disabled:opacity-50"
                >
                  Discard
                </button>
                <button 
                  type="submit" 
                  onClick={() => setIsSaveAndNew(false)} 
                  disabled={loading} 
                  className="h-10 px-6 bg-primary hover:bg-primary-dark text-white text-sm font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {loading && !isSaveAndNew ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save
                </button>
                <button 
                  type="submit" 
                  onClick={() => setIsSaveAndNew(true)} 
                  disabled={loading} 
                  className="h-10 px-5 bg-slate-800 hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {loading && isSaveAndNew && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save & New
                </button>
            </div>
        </form>
    </div>
  );
};

export default StockForm;
