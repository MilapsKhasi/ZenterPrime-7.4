import React, { useEffect, useState } from 'react';
import { Search, Loader2, ShoppingCart, Package, Users, Receipt, Clock, BadgeIndianRupee, LayoutDashboard, ShieldAlert, X, Menu, ArrowUp, ArrowDown, CheckCircle2 } from 'lucide-react';
import { getActiveCompanyId, formatDate, normalizeBill, formatCurrency } from '../utils/helpers';
import DateFilter from '../components/DateFilter';
import Modal from '../components/Modal';
import BillForm from '../components/BillForm';
import SalesInvoiceForm from '../components/SalesInvoiceForm';
import PaymentVoucherModal from '../components/PaymentVoucherModal';
import NewVoucherDropdown from '../components/NewVoucherDropdown';
import SalesPurchaseChart from '../components/SalesPurchaseChart';
import PageHeader from '../components/PageHeader';
import { supabase } from '../lib/supabase';
import { useLicense } from '../context/LicenseContext';
import { useSecurityDemo } from '../context/SecurityDemoContext';

const Dashboard = () => {
  const { isReadOnly } = useLicense();
  const { investigationMode, isBannerDismissed, dismissBanner, verifyAction } = useSecurityDemo();
  const [stats, setStats] = useState({ 
    totalSales: 0,
    totalPurchases: 0, 
    payables: 0,
    receivables: 0,
    gstPaid: 0,
    totalVendors: 0,
    totalCustomers: 0,
    stockItems: 0
  });
  const [recentVouchers, setRecentVouchers] = useState<any[]>([]);
  const [salesList, setSalesList] = useState<any[]>([]);
  const [purchasesList, setPurchasesList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false);
  const [isSalesModalOpen, setIsSalesModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [paymentVoucherType, setPaymentVoucherType] = useState<'Receipt' | 'Payment'>('Receipt');
  const [dateRange, setDateRange] = useState<{ startDate: string | null, endDate: string | null }>({ startDate: null, endDate: null });
  const [searchQuery, setSearchQuery] = useState('');

  const loadData = async () => {
    setLoading(true);
    const cid = getActiveCompanyId();
    if (!cid) {
      setLoading(false);
      return;
    }

    try {
      let billQuery = supabase.from('purchase_bills').select('*').eq('company_id', cid).eq('is_deleted', false);
      let saleQuery = supabase.from('sales_invoices').select('*').eq('company_id', cid).eq('is_deleted', false);

      if (dateRange.startDate && dateRange.endDate) {
        billQuery = billQuery.gte('date', dateRange.startDate).lte('date', dateRange.endDate);
        saleQuery = saleQuery.gte('date', dateRange.startDate).lte('date', dateRange.endDate);
      }
      
      const [{ data: bills }, { data: sales }] = await Promise.all([billQuery, saleQuery]);
      
      const { data: allParties } = await supabase.from('vendors').select('party_type, is_customer').eq('company_id', cid).eq('is_deleted', false);
      const customerCount = (allParties || []).filter((p: any) => {
        const pt = (p.party_type || '').toLowerCase();
        return pt === 'customer' || pt === 'both' || (p.is_customer === true && pt !== 'vendor');
      }).length;
      const vendorCount = (allParties || []).filter((p: any) => {
        const pt = (p.party_type || '').toLowerCase();
        return pt === 'vendor' || pt === 'both' || (p.is_customer === false && pt !== 'customer');
      }).length;
      const { count: itemCount } = await supabase.from('stock_items').select('*', { count: 'exact', head: true }).eq('company_id', cid).eq('is_deleted', false);

      const allPaymentVouchers = [
        ...(bills || []).map((b: any) => normalizeBill(b)).filter((b: any) => b?.items_raw?.is_payment_voucher === true),
        ...(sales || []).map((s: any) => normalizeBill(s)).filter((s: any) => s?.items_raw?.is_payment_voucher === true)
      ];

      const actualPurchases = (bills || []).map((b: any) => {
        const norm = normalizeBill(b);
        return norm ? { ...norm, type: 'Purchase' } : null;
      }).filter((b: any) => b && !b.items_raw?.is_payment_voucher) as any[];

      const actualSales = (sales || []).map((s: any) => {
        const norm = normalizeBill(s);
        return norm ? { ...norm, type: 'Sale' } : null;
      }).filter((s: any) => s && !s.items_raw?.is_payment_voucher) as any[];

      const getInvoiceOutstanding = (invoice: any) => {
        const isSale = invoice.type === 'Sale';
        const linkedVouchers = allPaymentVouchers.filter(v => {
          const isCorrectType = isSale ? (v.type === 'Sale' || v.customer_name) : (v.type === 'Purchase' || v.vendor_name);
          return isCorrectType && v.items_raw?.linked_bills?.includes(invoice.id);
        });
        const totalPaid = linkedVouchers.reduce((sum, v) => {
          const pDetails = v.items_raw?.payment_details;
          const pArray = Array.isArray(pDetails) ? pDetails : (pDetails ? [pDetails] : []);
          const amt = pArray.reduce((s: number, p: any) => s + (Number(p.payment_amount) || 0), 0);
          return sum + amt;
        }, 0);
        return Math.max(0, Number(invoice.grand_total || 0) - totalPaid);
      };

      const payables = actualPurchases.reduce((acc, v) => acc + getInvoiceOutstanding(v), 0);
      const receivables = actualSales.reduce((acc, v) => acc + getInvoiceOutstanding(v), 0);

      setStats({ 
        totalSales: actualSales.reduce((acc, b) => acc + Number(b.grand_total || 0), 0), 
        totalPurchases: actualPurchases.reduce((acc, b) => acc + Number(b.grand_total || 0), 0), 
        payables, 
        receivables, 
        gstPaid: actualPurchases.reduce((acc, v) => acc + Number(v.total_gst || 0), 0),
        totalVendors: vendorCount || 0,
        totalCustomers: customerCount || 0,
        stockItems: itemCount || 0
      });

      setSalesList(actualSales);
      setPurchasesList(actualPurchases);

      const combined = [
        ...actualPurchases.map(p => ({ ...p, status: getInvoiceOutstanding(p) === 0 && Number(p.grand_total || 0) > 0 ? 'Paid' : 'Pending' })),
        ...actualSales.map(s => ({ ...s, status: getInvoiceOutstanding(s) === 0 && Number(s.grand_total || 0) > 0 ? 'Paid' : 'Pending' }))
      ];
      setRecentVouchers(combined.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
    } catch (err: any) {
      console.error("Dashboard error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    window.addEventListener('appSettingsChanged', loadData);
    return () => window.removeEventListener('appSettingsChanged', loadData);
  }, [dateRange]);

  const filteredVouchers = recentVouchers.filter(v => {
    const search = searchQuery.toLowerCase();
    const partyName = v.vendor_name || v.customer_name || '';
    return v.bill_number?.toLowerCase().includes(search) || partyName.toLowerCase().includes(search);
  }).slice(0, 10);

  const StatBox = ({ label, value, subLabel, icon: Icon }: any) => (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded hover:border-slate-300 dark:hover:border-slate-700">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 capitalize tracking-tight">{label}</span>
        <Icon className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600" />
      </div>
      <div className="text-xl font-medium text-slate-900 dark:text-white leading-none mb-1">{value}</div>
      {subLabel && <div className="text-[10px] text-slate-400 dark:text-slate-500 font-medium capitalize">{subLabel}</div>}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Sales Invoice Modal */}
      <Modal isOpen={isSalesModalOpen} onClose={() => setIsSalesModalOpen(false)} title="New Sales Invoice" maxWidth="max-w-5xl">
        <SalesInvoiceForm 
          onSubmit={(inv, shouldPrint, isSaveAndNew) => { 
            if (!isSaveAndNew) setIsSalesModalOpen(false); 
            loadData(); 
          }} 
          onCancel={() => setIsSalesModalOpen(false)} 
        />
      </Modal>

      {/* Purchase Bill Modal */}
      <Modal isOpen={isPurchaseModalOpen} onClose={() => setIsPurchaseModalOpen(false)} title="New Purchase Bill" maxWidth="max-w-5xl">
        <BillForm 
          onSubmit={(bill, isSaveAndNew) => { 
            if (!isSaveAndNew) setIsPurchaseModalOpen(false); 
            loadData(); 
          }} 
          onCancel={() => setIsPurchaseModalOpen(false)} 
        />
      </Modal>

      {/* Payment / Receipt Voucher Modal */}
      <PaymentVoucherModal
        isOpen={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        initialType={paymentVoucherType}
        onSuccess={loadData}
      />

      {/* Part 2: Dashboard Investigation Warning Banner */}
      {investigationMode && !isBannerDismissed && (
        <div className="flex items-start justify-between p-4 rounded-xl border border-amber-300 dark:border-amber-700/80 bg-amber-50 dark:bg-amber-950/40 text-amber-950 dark:text-amber-100 shadow-xs">
          <div className="flex items-start space-x-3">
            <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/60 flex items-center justify-center text-amber-700 dark:text-amber-300 shrink-0 mt-0.5">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold tracking-tight text-amber-900 dark:text-amber-200">
                Unknown Device Investigation Active
              </h3>
              <p className="text-xs text-amber-800/90 dark:text-amber-300/80 mt-0.5 leading-relaxed">
                This session is being treated as a new or untrusted device. Sensitive actions require Z-PIN verification.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={dismissBanner}
            className="p-1 rounded-md text-amber-600 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-100 hover:bg-amber-100/60 dark:hover:bg-amber-900/40 transition-colors shrink-0 ml-3"
            title="Dismiss banner"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <PageHeader
        icon={LayoutDashboard}
        iconColor="text-slate-700 dark:text-slate-200"
        title="Executive Summary"
        subtitle="Real-time overview of sales, purchases, payables, receivables, and recent activity"
        actions={
          <>
            <DateFilter onFilterChange={setDateRange} />
            <NewVoucherDropdown
              onSelectSalesInvoice={() => { if (!isReadOnly) verifyAction('Create Sales Invoice', () => setIsSalesModalOpen(true)); }}
              onSelectPurchaseBill={() => { if (!isReadOnly) verifyAction('Create Purchase Bill', () => setIsPurchaseModalOpen(true)); }}
              onSelectReceivePayment={() => { if (!isReadOnly) verifyAction('Create Receipt Voucher', () => { setPaymentVoucherType('Receipt'); setIsPaymentModalOpen(true); }); }}
              onSelectMakePayment={() => { if (!isReadOnly) verifyAction('Create Payment Voucher', () => { setPaymentVoucherType('Payment'); setIsPaymentModalOpen(true); }); }}
            />
          </>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatBox label="Sales (Gross)" value={formatCurrency(stats.totalSales)} subLabel={`Net Recv: ${formatCurrency(stats.receivables)}`} icon={BadgeIndianRupee} />
        <StatBox label="Purchases" value={formatCurrency(stats.totalPurchases)} subLabel={`Net Payable: ${formatCurrency(stats.payables)}`} icon={ShoppingCart} />
        <StatBox label="Active Partners" value={stats.totalVendors + stats.totalCustomers} subLabel={`${stats.totalVendors} Vendors / ${stats.totalCustomers} Customers`} icon={Users} />
        <StatBox label="Inventory" value={stats.stockItems} subLabel="Registered SKU Items" icon={Package} />
      </div>

      {/* Sales vs Purchases Comparison Graph */}
      <SalesPurchaseChart 
        sales={salesList} 
        purchases={purchasesList} 
        loading={loading} 
      />

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-2xs">
        <div className="p-4 px-6 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-900">
          <div className="flex items-center space-x-3">
            <Menu className="w-5 h-5 text-slate-900 dark:text-white stroke-[2.5]" />
            <h2 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">Recent Transactions</h2>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 w-4 h-4" />
            <input 
              type="text" 
              value={searchQuery} 
              onChange={(e) => setSearchQuery(e.target.value)} 
              placeholder="Filter list..." 
              className="pl-9 pr-3.5 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg text-xs outline-none focus:border-slate-400 dark:focus:border-slate-600 w-full bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400" 
            />
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[800px]">
            <thead>
              <tr className="bg-[#F8FAFC] dark:bg-slate-800/60 border-b border-slate-200/80 dark:border-slate-800 text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                <th className="py-3.5 px-6">Date</th>
                <th className="py-3.5 px-6">Type</th>
                <th className="py-3.5 px-6">Document #</th>
                <th className="py-3.5 px-6">Party Name</th>
                <th className="py-3.5 px-6 text-right">Total Amount</th>
                <th className="py-3.5 px-6 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {loading ? (
                <tr><td colSpan={6} className="text-center py-20 text-slate-400 capitalize text-xs font-medium">Refreshing Data...</td></tr>
              ) : filteredVouchers.map((v) => {
                const isPaid = v.status === 'Paid';
                const isSale = v.type === 'Sale';
                const amt = Number(v.grand_total || 0);
                const wholeStr = Math.floor(amt).toLocaleString('en-IN');
                const decimalStr = (amt % 1).toFixed(2).substring(1);

                return (
                  <tr key={v.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="py-4 px-6 text-sm text-slate-700 dark:text-slate-300 whitespace-nowrap">{formatDate(v.date)}</td>
                    <td className="py-4 px-6 whitespace-nowrap">
                      {isSale ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 text-xs font-semibold">
                          <ArrowUp className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 stroke-[2.5]" />
                          Sale
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 text-xs font-semibold">
                          <ArrowDown className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 stroke-[2.5]" />
                          Purchase
                        </span>
                      )}
                    </td>
                    <td className="py-4 px-6 text-sm text-slate-700 dark:text-slate-300 whitespace-nowrap font-normal font-mono">{v.bill_number}</td>
                    <td className="py-4 px-6 text-sm font-bold text-slate-900 dark:text-white capitalize whitespace-nowrap">{v.vendor_name || v.customer_name}</td>
                    <td className="py-4 px-6 text-right whitespace-nowrap font-mono tabular-nums">
                      <span className="font-bold text-slate-900 dark:text-white text-base">₹{wholeStr}</span>
                      <span className="text-slate-500 dark:text-slate-400 text-xs font-medium">{decimalStr}</span>
                    </td>
                    <td className="py-4 px-6 text-center whitespace-nowrap">
                      {isPaid ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 text-xs font-semibold border border-emerald-200/60 dark:border-emerald-900/40">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                          Paid
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 text-xs font-semibold border border-amber-200/60 dark:border-amber-900/40">
                          <Clock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                          Pending
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!loading && filteredVouchers.length === 0 && (
                <tr><td colSpan={6} className="py-20 text-center text-slate-400 italic text-sm">No transactions found for the selected period.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;