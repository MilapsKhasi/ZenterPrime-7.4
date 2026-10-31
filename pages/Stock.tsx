
import React, { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { Search, History, Trash2, Edit, Eye, Package, Maximize2, Minimize2, Plus, TrendingUp, TrendingDown, Layers, ArrowDownLeft, ArrowUpRight, ArrowLeft, Lock } from 'lucide-react';
import { getActiveCompanyId, formatDate, normalizeBill, syncInvoiceItemsToItemsTable } from '../utils/helpers';
import Modal from '../components/Modal';
import StockForm from '../components/StockForm';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import PageHeader from '../components/PageHeader';
import { supabase } from '../lib/supabase';
import { useLicense } from '../context/LicenseContext';
import { useSecurityDemo } from '../context/SecurityDemoContext';

const Stock = () => {
  const location = useLocation();
  const { isReadOnly } = useLicense();
  const { verifyAction } = useSecurityDemo();
  const cid = getActiveCompanyId();
  const [items, setItems] = useState<any[]>([]);
  const [vouchers, setVouchers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [editingItem, setEditingItem] = useState<any | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  useEffect(() => {
    if (location.state?.highlightedId || location.state?.selectedId || location.state?.searchKey || location.state?.selectedItem) {
      const sId = location.state.highlightedId || location.state.selectedId || location.state.selectedItem?.id;
      if (sId) {
        setSelectedId(String(sId));
        setHighlightedId(String(sId));
      }
      if (location.state.selectedItem?.name) {
        setSearchQuery(location.state.selectedItem.name);
      } else if (location.state.searchKey) {
        setSearchQuery(location.state.searchKey);
      }
    }
  }, [location.state]);

  // Ensure selected item is active once loaded
  useEffect(() => {
    if (!loading && items.length > 0 && (location.state?.highlightedId || location.state?.selectedId || location.state?.selectedItem?.id)) {
      const targetId = String(location.state.highlightedId || location.state.selectedId || location.state.selectedItem?.id);
      const found = items.find(i => String(i.id) === targetId);
      if (found) {
        setSelectedId(String(found.id));
        setHighlightedId(String(found.id));
      }
    }
  }, [loading, items, location.state]);
  
  const [deleteDialog, setDeleteDialog] = useState<{ isOpen: boolean; item: any | null }>({
    isOpen: false,
    item: null
  });

  const loadData = async () => {
    setLoading(true);
    const cid = getActiveCompanyId();
    if (!cid) return;
    try {
      const [{ data: purchaseData }, { data: saleData }] = await Promise.all([
        supabase.from('purchase_bills').select('*').eq('company_id', cid).eq('is_deleted', false),
        supabase.from('sales_invoices').select('*').eq('company_id', cid).eq('is_deleted', false)
      ]);

      // Sync any items from external invoices into stock_items before displaying
      if (saleData && saleData.length > 0) {
        await syncInvoiceItemsToItemsTable(saleData, cid);
      }

      const { data: stockItems } = await supabase
        .from('stock_items')
        .select('*')
        .eq('company_id', cid)
        .eq('is_deleted', false)
        .order('name', { ascending: true });
      
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

      setItems(stockItems || []);
      setVouchers(normalizedVouchers);
      
      if (stockItems && stockItems.length > 0 && !selectedId) {
        setSelectedId(String(stockItems[0].id));
      }
    } catch (err) {
      console.error("Stock load error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    window.addEventListener('appSettingsChanged', loadData);
    window.addEventListener('stockUpdated', loadData);
    return () => {
      window.removeEventListener('appSettingsChanged', loadData);
      window.removeEventListener('stockUpdated', loadData);
    };
  }, [cid]);

  const selectedItem = items.find(i => String(i.id) === String(selectedId));

  const filteredItems = useMemo(() => {
    return items.filter(i => i.name?.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [items, searchQuery]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isModalOpen || deleteDialog.isOpen) return;

      if (e.key === 'ArrowDown') {
        if (filteredItems.length === 0) return;
        e.preventDefault();
        const currIdx = filteredItems.findIndex(i => String(i.id) === String(selectedId));
        const nextIdx = currIdx < 0 ? 0 : Math.min(currIdx + 1, filteredItems.length - 1);
        const nextItem = filteredItems[nextIdx];
        if (nextItem) {
          setSelectedId(String(nextItem.id));
          setHighlightedId(null);
        }
      } else if (e.key === 'ArrowUp') {
        if (filteredItems.length === 0) return;
        e.preventDefault();
        const currIdx = filteredItems.findIndex(i => String(i.id) === String(selectedId));
        const prevIdx = currIdx <= 0 ? 0 : currIdx - 1;
        const prevItem = filteredItems[prevIdx];
        if (prevItem) {
          setSelectedId(String(prevItem.id));
          setHighlightedId(null);
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        if (selectedItem && !isReadOnly) {
          e.preventDefault();
          e.stopPropagation();
          setEditingItem(selectedItem);
          setIsModalOpen(true);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filteredItems, selectedId, selectedItem, isModalOpen, deleteDialog.isOpen, isReadOnly]);

  const handleSaveItem = async (itemData: any, isSaveAndNew?: boolean) => {
    const cid = getActiveCompanyId();
    let res;
    if (editingItem) {
      res = await supabase.from('stock_items').update({ ...itemData }).eq('id', editingItem.id);
      if (res.error && (res.error.message?.includes('selling_price') || res.error.code === 'PGRST204' || res.error.code === '42703')) {
        const { selling_price, ...cleanData } = itemData;
        res = await supabase.from('stock_items').update(cleanData).eq('id', editingItem.id);
      }
    } else {
      res = await supabase.from('stock_items').insert([{ ...itemData, company_id: cid }]);
      if (res.error && (res.error.message?.includes('selling_price') || res.error.code === 'PGRST204' || res.error.code === '42703')) {
        const { selling_price, ...cleanData } = itemData;
        res = await supabase.from('stock_items').insert([{ ...cleanData, company_id: cid }]);
      }
    }
    loadData();
    if (!isSaveAndNew) {
      setIsModalOpen(false);
      setEditingItem(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteDialog.item) return;
    const itemToDelete = deleteDialog.item;
    setDeleteDialog({ isOpen: false, item: null });

    verifyAction('Delete Stock Item', async () => {
      await supabase.from('stock_items').update({ is_deleted: true }).eq('id', itemToDelete.id);
      loadData();
      if (selectedId === String(itemToDelete.id)) setSelectedId(null);
    });
  };

  const itemStats = useMemo(() => {
    if (!selectedItem) return null;
    const transactions: any[] = [];
    let inwardTotal = 0;
    let outwardTotal = 0;
    
    vouchers.forEach(v => {
      v.items?.forEach((it: any) => {
        const itName = (it.particulars || it.itemName || it.name || '').trim().toLowerCase();
        if (itName && itName === selectedItem.name?.trim().toLowerCase()) {
          const isPurchase = v.type === 'Purchase';
          const qty = Number(it.qty || it.quantity || 0);
          transactions.push({ 
            date: v.date, 
            docNo: v.bill_number || v.invoice_number, 
            party: v.vendor_name || v.customer_name, 
            qty: qty, 
            type: v.type 
          });
          if (isPurchase) inwardTotal += qty;
          else outwardTotal += qty;
        }
      });
    });

    const stockBalance = (Number(selectedItem.in_stock) || 0) + inwardTotal - outwardTotal;

    return { 
      transactions: transactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()), 
      inwardTotal,
      outwardTotal,
      stockBalance
    };
  }, [selectedItem, vouchers]);

  return (
    <div className="space-y-6 h-full flex flex-col">
      <Modal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setEditingItem(null); }} title={editingItem ? "Edit Stock Master" : "Add New Stock Item"} maxWidth="max-w-5xl">
        <StockForm initialData={editingItem} onSubmit={handleSaveItem} onCancel={() => { setIsModalOpen(false); setEditingItem(null); }} />
      </Modal>
      <ConfirmDialog isOpen={deleteDialog.isOpen} onClose={() => setDeleteDialog({ isOpen: false, item: null })} onConfirm={confirmDelete} title="Delete Stock Item" message={`Are you sure you want to remove "${deleteDialog.item?.name}" from master?`} />
      
      <PageHeader
        icon={Package}
        iconColor="text-teal-600 dark:text-teal-400"
        title="Inventory & Stock Control"
        subtitle="Track stock balances, inward purchases, outward sales, and SKU registers"
        actions={
          <button
            disabled={isReadOnly}
            onClick={() => {
              if (!isReadOnly) {
                verifyAction('Create Stock Item', () => {
                  setEditingItem(null);
                  setIsModalOpen(true);
                });
              }
            }}
            className={`w-full sm:w-auto px-5 py-2.5 rounded-md font-medium text-sm flex items-center justify-center shadow-sm ${
              isReadOnly
                ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                : 'bg-primary text-white hover:bg-primary-dark cursor-pointer'
            }`}
            title={isReadOnly ? 'Evaluation Expired - Read Only Mode' : 'New SKU Item'}
          >
            {isReadOnly ? <Lock className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />} New SKU Item
          </button>
        }
      />

      {!loading && items.length === 0 ? (
        <EmptyState 
          title="Inventory is Empty" 
          message="Take control of your warehouse! Register your stock items (SKUs) to track movements, quantities, and valuation." 
          actionLabel="Add First Stock Item" 
          onAction={() => verifyAction('Create Stock Item', () => { setEditingItem(null); setIsModalOpen(true); })} 
        />
      ) : (
        <div className="flex-1 flex flex-col lg:flex-row gap-6 overflow-hidden min-h-0">
            {!isFullScreen && (
            <div className={`w-full lg:w-80 flex flex-col space-y-4 flex-1 lg:flex-none min-h-0 lg:shrink-0 ${selectedId ? 'hidden lg:flex' : 'flex'}`}>
                <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 w-4 h-4" />
                <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Filter items..." className="w-full pl-10 pr-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-xs outline-none focus:border-slate-300 dark:focus:border-slate-600 shadow-sm text-slate-900 dark:text-slate-100" />
                </div>
                <div className="flex-1 overflow-y-auto min-h-0 space-y-2 pr-1 custom-scrollbar touch-pan-y">
                {filteredItems.map((item) => {
                    let inward = 0; let outward = 0;
                    vouchers.forEach(v => { v.items?.forEach((it: any) => {
                    if (it.itemName?.toLowerCase() === item.name?.toLowerCase()) {
                        if (v.type === 'Purchase') inward += Number(it.qty || 0);
                        else outward += Number(it.qty || 0);
                    }
                    });});
                    const currentBalance = (Number(item.in_stock) || 0) + inward - outward;
                    const isSelected = String(selectedId) === String(item.id);
                    const isHighlighted = String(item.id) === String(highlightedId);

                    return (
                    <div 
                      key={item.id} 
                      ref={(el) => {
                        if (el && (isHighlighted || isSelected)) {
                          el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                        }
                      }}
                      onClick={() => {
                        setSelectedId(String(item.id));
                        setHighlightedId(null);
                      }} 
                      className={`p-4 rounded-[6px] cursor-pointer transition-all ${
                        isSelected 
                          ? 'bg-amber-100/95 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-700/70 text-slate-900 dark:text-amber-100 shadow-xs ring-1 ring-amber-400/40' 
                          : 'bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/80 hover:bg-slate-50 dark:hover:bg-slate-700/50'
                      }`}
                    >
                        <h3 className={`font-medium capitalize text-[11px] truncate mb-1 ${isSelected ? 'text-amber-950 dark:text-white font-bold' : 'text-slate-700 dark:text-slate-200'}`}>{item.name}</h3>
                        <div className="flex justify-between items-end">
                            <span className={`text-[10px] font-medium capitalize tracking-tighter ${isSelected ? 'text-amber-800/80 dark:text-amber-300/80 font-medium' : 'text-slate-400 dark:text-slate-500'}`}>Hsn: {item.hsn || 'N/A'}</span>
                            <span className={`font-mono text-lg font-bold leading-none ${isSelected ? 'text-amber-950 dark:text-amber-300' : 'text-blue-600 dark:text-blue-400'}`}>
                                {currentBalance.toFixed(0)} <span className={`text-[10px] opacity-75 font-sans ${isSelected ? 'text-amber-800 dark:text-amber-300' : ''}`}>{item.unit || 'PCS'}</span>
                            </span>
                        </div>
                    </div>
                    );
                })}
                </div>
            </div>
            )}

            <div className={`flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md flex flex-col overflow-hidden ${isFullScreen ? 'fixed inset-4 z-[500] m-0 shadow-2xl' : ''} ${!selectedId ? 'hidden lg:flex' : 'flex'}`}>
            {selectedItem && itemStats ? (
                <div className="flex flex-col h-full overflow-hidden">
                <div className="px-4 sm:px-8 py-4 sm:py-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/30 shrink-0">
                    <div className="flex items-center space-x-3 sm:space-x-4 overflow-hidden">
                    <button onClick={() => setSelectedId(null)} className="lg:hidden p-2 -ml-2 text-slate-400 hover:text-slate-900 dark:hover:text-white">
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                    <div className="w-10 h-10 sm:w-12 sm:h-12 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-center shadow-sm shrink-0">
                        <Package className="w-5 h-5 sm:w-6 sm:h-6 text-slate-400 dark:text-slate-500" />
                    </div>
                    <div className="truncate">
                        <h2 className="text-base sm:text-xl font-medium text-slate-900 dark:text-white capitalize tracking-tight truncate">{selectedItem.name}</h2>
                        <div className="flex items-center space-x-2 mt-1">
                        <span className="text-[9px] font-medium text-slate-400 dark:text-slate-500 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-0.5 rounded capitalize">Hsn {selectedItem.hsn || 'N/A'}</span>
                        <span className="text-[9px] font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 border border-blue-100 dark:border-blue-800 px-2 py-0.5 rounded capitalize">Sku {selectedItem.sku || 'N/A'}</span>
                        </div>
                    </div>
                    </div>
                    <div className="flex items-center space-x-1 sm:space-x-2">
                      {!isReadOnly && (
                        <button 
                          onClick={() => { setEditingItem(selectedItem); setIsModalOpen(true); }} 
                          title="Edit Stock Master"
                          className="p-2.5 text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:text-slate-900 dark:hover:text-white shadow-xs"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                      )}
                      <button 
                        onClick={() => document.getElementById('stock-movement-log')?.scrollIntoView({ behavior: 'smooth' })} 
                        title="View Stock Movement Statement"
                        className="p-2.5 text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:text-slate-900 dark:hover:text-white shadow-xs"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => setIsFullScreen(!isFullScreen)} 
                        title={isFullScreen ? "Exit Fullscreen" : "Fullscreen View"}
                        className="hidden sm:block p-2.5 text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:text-slate-900 dark:hover:text-white shadow-xs"
                      >
                        {isFullScreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                      </button>
                      {!isReadOnly && (
                        <button 
                          onClick={() => setDeleteDialog({ isOpen: true, item: selectedItem })} 
                          title="Delete Stock Item"
                          className="p-2.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/60 rounded-lg shadow-xs"
                        >
                          <Trash2 className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                        </button>
                      )}
                    </div>
                </div>
                
                <div className="flex-1 overflow-y-auto p-4 sm:p-8 custom-scrollbar space-y-8">
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
                    <div className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
                        <p className="text-[9px] font-medium text-slate-400 dark:text-slate-500 capitalize tracking-widest mb-1">Current Balance</p>
                        <p className="text-2xl sm:text-3xl font-bold font-mono text-link dark:text-blue-400">{itemStats.stockBalance.toFixed(0)} <span className="text-xs font-normal opacity-50">{selectedItem.unit}</span></p>
                    </div>
                    <div className="bg-white dark:bg-slate-800 p-6 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm">
                        <p className="text-[9px] font-medium text-slate-400 dark:text-slate-500 capitalize tracking-widest mb-1">Purchased (Inward)</p>
                        <div className="flex items-center text-emerald-600 dark:text-emerald-400">
                            <ArrowDownLeft className="w-4 h-4 mr-1" />
                            <p className="text-xl sm:text-2xl font-medium font-mono">{itemStats.inwardTotal.toFixed(0)}</p>
                        </div>
                    </div>
                    <div className="bg-white dark:bg-slate-800 p-6 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm">
                        <p className="text-[9px] font-medium text-slate-400 dark:text-slate-500 capitalize tracking-widest mb-1">Sold (Outward)</p>
                        <div className="flex items-center text-rose-600 dark:text-rose-400">
                            <ArrowUpRight className="w-4 h-4 mr-1" />
                            <p className="text-xl sm:text-2xl font-medium font-mono">{itemStats.outwardTotal.toFixed(0)}</p>
                        </div>
                    </div>
                    <div className="bg-white dark:bg-slate-800 p-6 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm">
                        <p className="text-[9px] font-medium text-slate-400 dark:text-slate-500 capitalize tracking-widest mb-1">Purchase Rate</p>
                        <p className="text-xl sm:text-2xl font-medium text-slate-900 dark:text-white font-mono">₹{selectedItem.rate || 0}</p>
                    </div>
                    <div className="bg-white dark:bg-slate-800 p-6 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm">
                        <p className="text-[9px] font-medium text-slate-400 dark:text-slate-500 capitalize tracking-widest mb-1">Selling Price</p>
                        <p className="text-xl sm:text-2xl font-medium text-slate-900 dark:text-white font-mono">₹{selectedItem.selling_price || 0}</p>
                    </div>
                    </div>

                    <div className="space-y-4" id="stock-movement-log">
                    <h4 className="text-[11px] font-medium text-slate-400 dark:text-slate-500 capitalize tracking-widest flex items-center">
                        <History className="w-4 h-4 mr-2 text-slate-300 dark:text-slate-600" /> Stock Movement Log
                    </h4>
                    <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900 shadow-2xs">
                        <table className="w-full text-left border-collapse min-w-[600px]">
                        <thead>
                            <tr className="bg-[#F8FAFC] dark:bg-slate-800/60 text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider border-b border-slate-200/80 dark:border-slate-800">
                                <th className="py-3.5 px-6">Date</th>
                                <th className="py-3.5 px-6">Voucher #</th>
                                <th className="py-3.5 px-6">Type</th>
                                <th className="py-3.5 px-6">Party</th>
                                <th className="py-3.5 px-6 text-right">Quantity</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-sm">
                            {itemStats.transactions.map((t, idx) => (
                                <tr key={idx} className="border-b border-slate-100 dark:border-slate-800/80 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                                    <td className="py-4 px-6 text-slate-700 dark:text-slate-300 font-mono text-sm">{formatDate(t.date)}</td>
                                    <td className="py-4 px-6 font-mono text-sm text-slate-700 dark:text-slate-300">{t.docNo}</td>
                                    <td className="py-4 px-6 whitespace-nowrap">
                                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${t.type === 'Sale' ? 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300' : 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'}`}>
                                            {t.type}
                                        </span>
                                    </td>
                                    <td className="py-4 px-6 font-bold text-slate-900 dark:text-white capitalize truncate max-w-[200px]">{t.party}</td>
                                    <td className={`py-4 px-6 text-right font-bold font-mono text-base tabular-nums ${t.type === 'Purchase' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                        {t.type === 'Purchase' ? '+' : '-'}{t.qty}
                                    </td>
                                </tr>
                            ))}
                            {itemStats.transactions.length === 0 && (
                                <tr><td colSpan={5} className="py-24 text-center text-slate-400 italic text-sm">No inventory activity registered for this SKU.</td></tr>
                            )}
                        </tbody>
                        </table>
                    </div>
                    </div>
                </div>
                </div>
            ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-300 dark:text-slate-700 italic py-20">
                    <Layers className="w-16 h-16 opacity-5 mb-4" />
                    <p className="text-sm font-medium">Select an item from the list to view analytics.</p>
                </div>
            )}
            </div>
        </div>
      )}
    </div>
  );
};

export default Stock;
