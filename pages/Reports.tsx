import React, { useState, useEffect, useMemo } from 'react';
import { 
  Printer, ArrowUpRight, ArrowDownLeft, ArrowUpCircle 
} from 'lucide-react';
import DateFilter from '../components/DateFilter';
import ExportModal from '../components/ExportModal';
import PartyLedgerPrintModal from '../components/PartyLedgerPrintModal';
import { 
  ReportsEngineShell, 
  ReportViewHeader, 
  ReportKpiGrid, 
  ReportTable, 
  ReportTotalsBar, 
  ReportTabId 
} from '../components/ReportsEngineShell';
import { 
  getActiveCompanyId, formatDate, formatCurrency, 
  normalizeBill, isTransactionForParty, getEffectiveCompanyInfo 
} from '../utils/helpers';
import { exportToExcel, exportToCSV, triggerPrint } from '../utils/exportHelper';
import { supabase } from '../lib/supabase';
import { useSecurityDemo } from '../context/SecurityDemoContext';
import { ActionMenu } from '../components/ActionMenu';
import { PaymentVoucherModal } from '../components/PaymentVoucherModal';

const Reports: React.FC = () => {
  const { verifyAction } = useSecurityDemo();
  const [activeTab, setActiveTab] = useState<ReportTabId>('Sales Register');
  const [loading, setLoading] = useState(true);
  const [companyInfo, setCompanyInfo] = useState<any>(null);
  const [settlePayment, setSettlePayment] = useState<{
    isOpen: boolean;
    type: 'Receipt' | 'Payment';
    partyName: string;
    billId: string;
    amount: number;
  } | null>(null);

  // Raw data from database
  const [salesData, setSalesData] = useState<any[]>([]);
  const [purchaseData, setPurchaseData] = useState<any[]>([]);
  const [parties, setParties] = useState<any[]>([]);

  // Filtering
  const [dateRange, setDateRange] = useState<{ startDate: string | null; endDate: string | null }>({ 
    startDate: null, 
    endDate: null 
  });
  const [searchQuery, setSearchQuery] = useState('');

  // Party Ledgers specific state
  const [partyTypeFilter, setPartyTypeFilter] = useState<'both' | 'customer' | 'vendor'>('both');
  const [selectedParty, setSelectedParty] = useState<any | null>(null);

  // Export Modal
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isPartyLedgerPrintOpen, setIsPartyLedgerPrintOpen] = useState(false);

  const cid = getActiveCompanyId();

  // Load all necessary company records
  const loadData = async () => {
    if (!cid) {
      setLoading(false);
      return;
    }
    setLoading(true);

    try {
      const [
        { data: comp },
        { data: sales },
        { data: purchases },
        { data: vends },
        { data: custs }
      ] = await Promise.all([
        supabase.from('companies').select('*').eq('id', cid).maybeSingle(),
        supabase.from('sales_invoices').select('*').eq('company_id', cid).eq('is_deleted', false).order('date', { ascending: false }),
        supabase.from('purchase_bills').select('*').eq('company_id', cid).eq('is_deleted', false).order('date', { ascending: false }),
        supabase.from('vendors').select('*').eq('company_id', cid).eq('is_deleted', false).order('name'),
        supabase.from('customers').select('*').eq('company_id', cid).eq('is_deleted', false).order('name')
      ]);

      if (comp) {
        const effective = getEffectiveCompanyInfo(comp);
        setCompanyInfo({
          ...comp,
          name: effective.name,
          gstin: effective.gstin,
          address: effective.address
        });
      }

      setSalesData(sales || []);
      setPurchaseData(purchases || []);

      // Unify parties
      const partyMap = new Map<string, any>();
      (custs || []).forEach((c: any) => {
        const key = c.name ? c.name.trim().toUpperCase() : c.id;
        partyMap.set(key, { ...c, party_type: c.party_type || 'customer', is_customer: true });
      });
      (vends || []).forEach((v: any) => {
        const key = v.name ? v.name.trim().toUpperCase() : v.id;
        partyMap.set(key, v);
      });
      setParties(Array.from(partyMap.values()));
    } catch (err) {
      console.error('Error loading reports data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const handleRefresh = () => loadData();
    window.addEventListener('appSettingsChanged', handleRefresh);
    return () => window.removeEventListener('appSettingsChanged', handleRefresh);
  }, [cid]);

  // Reset selected party when switching tabs
  useEffect(() => {
    if (activeTab !== 'Party Ledgers') {
      setSelectedParty(null);
    }
    setSearchQuery('');
  }, [activeTab]);

  // Standalone payment vouchers for cross-bill linkage
  const allPaymentVouchers = useMemo(() => {
    const rawList = [
      ...(purchaseData || []).map((b: any) => ({ ...normalizeBill(b), source: 'purchase_bills' })),
      ...(salesData || []).map((s: any) => ({ ...normalizeBill(s), source: 'sales_invoices' }))
    ].filter(Boolean);

    return rawList.filter((item: any) => item?.items_raw?.is_payment_voucher === true || item?.items?.is_payment_voucher === true);
  }, [salesData, purchaseData]);

  // Processed Sales Invoices with real-time pending & paid statuses
  const processedSales = useMemo(() => {
    return (salesData || [])
      .map((s: any) => {
        const norm = normalizeBill(s);
        if (!norm || norm.items_raw?.is_payment_voucher === true) return null;

        const linkedVouchers = allPaymentVouchers.filter((v: any) => v.items_raw?.linked_bills?.includes(s.id));
        const linkedPaid = linkedVouchers.reduce((sum: number, v: any) => {
          const pDetails = v.items_raw?.payment_details || v.payment_details;
          const pArray = Array.isArray(pDetails) ? pDetails : (pDetails ? [pDetails] : []);
          return sum + pArray.reduce((acc: number, p: any) => acc + (Number(p.payment_amount) || 0), 0);
        }, 0);

        const directDetails = norm.items_raw?.payment_details || norm.payment_details;
        const directArray = Array.isArray(directDetails) ? directDetails : (directDetails ? [directDetails] : []);
        const directPaid = directArray.reduce((acc: number, p: any) => acc + (Number(p.payment_amount) || 0), 0);

        const totalPaid = linkedPaid + directPaid;
        const grandTotal = Number(norm.grand_total || 0);
        const outstanding = Math.max(0, grandTotal - totalPaid);
        const isPaid = (outstanding <= 0.01 && grandTotal > 0) || (norm.status === 'Paid' && outstanding <= 0.01);
        const status = isPaid ? 'Paid' : 'Pending';

        return {
          ...norm,
          type: 'Sale',
          totalPaid,
          outstanding,
          status
        };
      })
      .filter(Boolean);
  }, [salesData, allPaymentVouchers]);

  // Processed Purchase Bills with real-time pending & paid statuses
  const processedPurchases = useMemo(() => {
    return (purchaseData || [])
      .map((b: any) => {
        const norm = normalizeBill(b);
        if (!norm || norm.items_raw?.is_payment_voucher === true) return null;

        const linkedVouchers = allPaymentVouchers.filter((v: any) => v.items_raw?.linked_bills?.includes(b.id));
        const linkedPaid = linkedVouchers.reduce((sum: number, v: any) => {
          const pDetails = v.items_raw?.payment_details || v.payment_details;
          const pArray = Array.isArray(pDetails) ? pDetails : (pDetails ? [pDetails] : []);
          return sum + pArray.reduce((acc: number, p: any) => acc + (Number(p.payment_amount) || 0), 0);
        }, 0);

        const directDetails = norm.items_raw?.payment_details || norm.payment_details;
        const directArray = Array.isArray(directDetails) ? directDetails : (directDetails ? [directDetails] : []);
        const directPaid = directArray.reduce((acc: number, p: any) => acc + (Number(p.payment_amount) || 0), 0);

        const totalPaid = linkedPaid + directPaid;
        const grandTotal = Number(norm.grand_total || 0);
        const outstanding = Math.max(0, grandTotal - totalPaid);
        const isPaid = (outstanding <= 0.01 && grandTotal > 0) || (norm.status === 'Paid' && outstanding <= 0.01);
        const status = isPaid ? 'Paid' : 'Pending';

        return {
          ...norm,
          type: 'Purchase',
          totalPaid,
          outstanding,
          status
        };
      })
      .filter(Boolean);
  }, [purchaseData, allPaymentVouchers]);

  // Date range filter helper
  const matchesDateRange = (dateStr: string) => {
    if (!dateRange.startDate || !dateRange.endDate) return true;
    if (!dateStr) return false;
    const d = new Date(dateStr);
    const start = new Date(dateRange.startDate);
    const end = new Date(dateRange.endDate);
    return d >= start && d <= end;
  };

  // 1. Filtered Sales Register
  const filteredSalesRegister = useMemo(() => {
    return processedSales.filter((item: any) => {
      if (!matchesDateRange(item.date)) return false;
      const q = searchQuery.toLowerCase().trim();
      if (!q) return true;
      const docNo = (item.invoice_number || item.bill_number || '').toLowerCase();
      const party = (item.customer_name || item.vendor_name || '').toLowerCase();
      return docNo.includes(q) || party.includes(q);
    });
  }, [processedSales, dateRange, searchQuery]);

  const salesTotals = useMemo(() => {
    let taxable = 0;
    let gst = 0;
    let grandTotal = 0;
    filteredSalesRegister.forEach((s: any) => {
      taxable += Number(s.total_without_gst || 0);
      gst += Number(s.total_gst || 0);
      grandTotal += Number(s.grand_total || 0);
    });
    return { taxable, gst, grandTotal };
  }, [filteredSalesRegister]);

  // 2. Filtered Purchases Register
  const filteredPurchasesRegister = useMemo(() => {
    return processedPurchases.filter((item: any) => {
      if (!matchesDateRange(item.date)) return false;
      const q = searchQuery.toLowerCase().trim();
      if (!q) return true;
      const docNo = (item.bill_number || item.invoice_number || '').toLowerCase();
      const party = (item.vendor_name || item.customer_name || '').toLowerCase();
      return docNo.includes(q) || party.includes(q);
    });
  }, [processedPurchases, dateRange, searchQuery]);

  const purchaseTotals = useMemo(() => {
    let taxable = 0;
    let gst = 0;
    let grandTotal = 0;
    filteredPurchasesRegister.forEach((b: any) => {
      taxable += Number(b.total_without_gst || 0);
      gst += Number(b.total_gst || 0);
      grandTotal += Number(b.grand_total || 0);
    });
    return { taxable, gst, grandTotal };
  }, [filteredPurchasesRegister]);

  // 3. Filtered Accounts Receivables (Sales invoices with status 'Pending')
  const accountsReceivables = useMemo(() => {
    return processedSales.filter((item: any) => {
      if (item.status !== 'Pending') return false;
      if (!matchesDateRange(item.date)) return false;
      const q = searchQuery.toLowerCase().trim();
      if (!q) return true;
      const docNo = (item.invoice_number || item.bill_number || '').toLowerCase();
      const party = (item.customer_name || item.vendor_name || '').toLowerCase();
      return docNo.includes(q) || party.includes(q);
    });
  }, [processedSales, dateRange, searchQuery]);

  const receivableTotals = useMemo(() => {
    let invoiced = 0;
    let paid = 0;
    let outstanding = 0;
    accountsReceivables.forEach((inv: any) => {
      invoiced += Number(inv.grand_total || 0);
      paid += Number(inv.totalPaid || 0);
      outstanding += Number(inv.outstanding || 0);
    });
    return { invoiced, paid, outstanding };
  }, [accountsReceivables]);

  // 4. Filtered Accounts Payables (Purchase bills with status 'Pending')
  const accountsPayables = useMemo(() => {
    return processedPurchases.filter((item: any) => {
      if (item.status !== 'Pending') return false;
      if (!matchesDateRange(item.date)) return false;
      const q = searchQuery.toLowerCase().trim();
      if (!q) return true;
      const docNo = (item.bill_number || item.invoice_number || '').toLowerCase();
      const party = (item.vendor_name || item.customer_name || '').toLowerCase();
      return docNo.includes(q) || party.includes(q);
    });
  }, [processedPurchases, dateRange, searchQuery]);

  const payableTotals = useMemo(() => {
    let billed = 0;
    let paid = 0;
    let outstanding = 0;
    accountsPayables.forEach((b: any) => {
      billed += Number(b.grand_total || 0);
      paid += Number(b.totalPaid || 0);
      outstanding += Number(b.outstanding || 0);
    });
    return { billed, paid, outstanding };
  }, [accountsPayables]);

  // 5. Party Ledgers: List of total parties with search & toggle
  const filteredPartiesList = useMemo(() => {
    return parties.filter((p: any) => {
      const pType = (p.party_type || '').toLowerCase();
      const isCustomer = pType === 'customer' || pType === 'both' || p.is_customer === true;
      const isVendor = pType === 'vendor' || pType === 'both' || (p.is_customer === false && pType !== 'customer');

      if (partyTypeFilter === 'customer' && !isCustomer) return false;
      if (partyTypeFilter === 'vendor' && !isVendor) return false;

      const q = searchQuery.toLowerCase().trim();
      if (!q) return true;
      const name = (p.name || '').toLowerCase();
      const gstin = (p.gstin || '').toLowerCase();
      const phone = (p.phone || '').toLowerCase();
      return name.includes(q) || gstin.includes(q) || phone.includes(q);
    });
  }, [parties, partyTypeFilter, searchQuery]);

  // Pre-calculate balances for each party in list
  const partyBalances = useMemo(() => {
    const balances = new Map<string, { balance: number; isDr: boolean }>();

    const normalizedSales = (salesData || []).map((s: any) => normalizeBill(s)).filter(Boolean);
    const normalizedPurchases = (purchaseData || []).map((b: any) => normalizeBill(b)).filter(Boolean);

    parties.forEach((party: any) => {
      const pType = (party.party_type || '').toLowerCase();
      const isDebtor = pType === 'customer' || pType === 'both' || party.is_customer === true;
      const openingBal = Number(party.balance) || 0;
      let net = isDebtor ? openingBal : -openingBal;

      const partySales = normalizedSales.filter((s: any) => isTransactionForParty(s, party));
      const partyPurchases = normalizedPurchases.filter((b: any) => isTransactionForParty(b, party));

      partySales.forEach((s: any) => {
        if (s.items_raw?.is_payment_voucher) {
          const pDetails = s.items_raw?.payment_details || s.payment_details;
          const pArray = Array.isArray(pDetails) ? pDetails : (pDetails ? [pDetails] : []);
          const amt = pArray.reduce((acc: number, p: any) => acc + (Number(p.payment_amount) || 0), 0) || Number(s.grand_total || 0);
          net -= amt;
        } else {
          net += Number(s.grand_total || 0);
        }
      });

      partyPurchases.forEach((b: any) => {
        if (b.items_raw?.is_payment_voucher) {
          const pDetails = b.items_raw?.payment_details || b.payment_details;
          const pArray = Array.isArray(pDetails) ? pDetails : (pDetails ? [pDetails] : []);
          const amt = pArray.reduce((acc: number, p: any) => acc + (Number(p.payment_amount) || 0), 0) || Number(b.grand_total || 0);
          net += amt;
        } else {
          net -= Number(b.grand_total || 0);
        }
      });

      balances.set(String(party.id), {
        balance: net,
        isDr: net >= 0
      });
    });

    return balances;
  }, [parties, salesData, purchaseData]);

  // Total receivables & payables across parties
  const partyAggregates = useMemo(() => {
    let totalReceivablesDr = 0;
    let totalPayablesCr = 0;
    filteredPartiesList.forEach((p: any) => {
      const balInfo = partyBalances.get(String(p.id)) || { balance: 0, isDr: true };
      if (balInfo.balance > 0) totalReceivablesDr += balInfo.balance;
      else if (balInfo.balance < 0) totalPayablesCr += Math.abs(balInfo.balance);
    });
    return { totalReceivablesDr, totalPayablesCr };
  }, [filteredPartiesList, partyBalances]);

  // Detailed Ledger Calculation for the Selected Party
  const selectedPartyLedger = useMemo(() => {
    if (!selectedParty) return { rows: [], totalDebit: 0, totalCredit: 0, finalBalance: 0 };

    const isDebtor = selectedParty.party_type === 'customer' || selectedParty.is_customer === true;
    const openingBalanceVal = Number(selectedParty.balance) || 0;
    let runningBalance = isDebtor ? openingBalanceVal : -openingBalanceVal;

    const rows: any[] = [];

    // Opening Balance Row
    rows.push({
      date: '-',
      transaction: 'Opening Balance',
      referenceNumber: '-',
      debit: openingBalanceVal !== 0 ? (isDebtor ? openingBalanceVal : 0) : 0,
      credit: openingBalanceVal !== 0 ? (isDebtor ? 0 : openingBalanceVal) : 0,
      balance: runningBalance
    });

    const allNormalized = [
      ...(purchaseData || []).map((b: any) => ({ ...normalizeBill(b), source: 'purchase_bills' })),
      ...(salesData || []).map((s: any) => ({ ...normalizeBill(s), source: 'sales_invoices' }))
    ].filter(Boolean);

    const partyTransactions = allNormalized.filter((v: any) => isTransactionForParty(v, selectedParty));

    interface LedgerEvent {
      date: string;
      transaction: string;
      referenceNumber: string;
      debit: number;
      credit: number;
      sortTime: number;
    }

    const events: LedgerEvent[] = [];

    partyTransactions.forEach((t: any) => {
      const amount = Number(t.grand_total) || 0;
      const docNo = t.invoice_number || t.bill_number || t.challan_number || '-';
      const tDate = t.date || '';
      const sortTime = tDate ? new Date(tDate).getTime() : 0;

      const isPaymentVoucher = t.items_raw?.is_payment_voucher === true || 
                               t.items?.is_payment_voucher === true ||
                               t.voucher_type === 'Receipt' || 
                               t.voucher_type === 'Payment' ||
                               t.items_raw?.voucher_type === 'Receipt' || 
                               t.items_raw?.voucher_type === 'Payment';

      const isReceipt = isPaymentVoucher && (
        t.items_raw?.voucher_type === 'Receipt' || 
        t.voucher_type === 'Receipt' || 
        t.source === 'sales_invoices' ||
        t.type === 'Sale' ||
        (t.invoice_number && t.invoice_number.startsWith('REC-'))
      );

      const isSale = !isPaymentVoucher && (t.type === 'Sale' || t.source === 'sales_invoices');

      if (isPaymentVoucher) {
        // Standalone Payment or Receipt Voucher
        const pDetailsRaw = t.items_raw?.payment_details || t.payment_details;
        const payments = Array.isArray(pDetailsRaw) ? pDetailsRaw : (pDetailsRaw ? [pDetailsRaw] : [{
          payment_amount: amount,
          payment_date: tDate,
          payment_method: 'Cash'
        }]);

        payments.forEach((p: any) => {
          const pAmount = Number(p.payment_amount) || amount;
          const pDate = p.payment_date || tDate;
          const pTime = pDate ? new Date(pDate).getTime() : sortTime;

          if (isReceipt) {
            // Receipt: Customer paid -> Credits the party
            events.push({
              date: pDate,
              transaction: 'Receipt',
              referenceNumber: docNo,
              debit: 0,
              credit: pAmount,
              sortTime: pTime
            });
          } else {
            // Payment: We paid supplier -> Debits the party
            events.push({
              date: pDate,
              transaction: 'Payment',
              referenceNumber: docNo,
              debit: pAmount,
              credit: 0,
              sortTime: pTime
            });
          }
        });
      } else {
        // Sales Invoice or Purchase Bill
        if (isSale) {
          // Sales: Debits the party
          events.push({
            date: tDate,
            transaction: 'Sales Invoice',
            referenceNumber: docNo,
            debit: amount,
            credit: 0,
            sortTime
          });
        } else {
          // Purchase: Credits the party
          events.push({
            date: tDate,
            transaction: 'Purchase Bill',
            referenceNumber: docNo,
            debit: 0,
            credit: amount,
            sortTime
          });
        }

        // Embed any payments recorded directly on invoice/bill
        const pDetailsRaw = t.items_raw?.payment_details || t.payment_details;
        if (pDetailsRaw) {
          const pArray = Array.isArray(pDetailsRaw) ? pDetailsRaw : [pDetailsRaw];
          pArray.forEach((p: any) => {
            const pAmount = Number(p.payment_amount) || 0;
            if (pAmount > 0) {
              const pDate = p.payment_date || tDate;
              const pTime = pDate ? new Date(pDate).getTime() : sortTime;
              if (isSale) {
                events.push({
                  date: pDate,
                  transaction: 'Receipt',
                  referenceNumber: docNo !== '-' ? `Ref: ${docNo}` : 'Receipt',
                  debit: 0,
                  credit: pAmount,
                  sortTime: pTime + 1
                });
              } else {
                events.push({
                  date: pDate,
                  transaction: 'Payment',
                  referenceNumber: docNo !== '-' ? `Ref: ${docNo}` : 'Payment',
                  debit: pAmount,
                  credit: 0,
                  sortTime: pTime + 1
                });
              }
            }
          });
        }
      }
    });

    // Sort chronologically
    events.sort((a, b) => a.sortTime - b.sortTime);

    let totalDebit = rows[0].debit;
    let totalCredit = rows[0].credit;

    events.forEach(evt => {
      runningBalance += (evt.debit - evt.credit);
      totalDebit += evt.debit;
      totalCredit += evt.credit;

      rows.push({
        date: evt.date ? formatDate(evt.date) : '-',
        transaction: evt.transaction,
        referenceNumber: evt.referenceNumber,
        debit: evt.debit,
        credit: evt.credit,
        balance: runningBalance
      });
    });

    return {
      rows,
      totalDebit,
      totalCredit,
      finalBalance: runningBalance
    };
  }, [selectedParty, salesData, purchaseData]);

  // 6. GSTR Summary calculation
  const gstrSummary = useMemo(() => {
    let outwardTaxable = 0;
    let outwardCgst = 0;
    let outwardSgst = 0;
    let outwardIgst = 0;
    let outwardTotalTax = 0;

    let inwardTaxable = 0;
    let inwardCgst = 0;
    let inwardSgst = 0;
    let inwardIgst = 0;
    let inwardTotalTax = 0;

    const rateBreakup: Record<number, { rate: number; outTaxable: number; outTax: number; inTaxable: number; inTax: number }> = {};

    processedSales.forEach((s: any) => {
      if (!matchesDateRange(s.date)) return;
      const taxable = Number(s.total_without_gst) || 0;
      const gst = Number(s.total_gst) || 0;
      outwardTaxable += taxable;
      outwardTotalTax += gst;

      const isInter = s.gst_type === 'Inter-State' || s.gst_type === 'IGST';
      if (isInter) {
        outwardIgst += gst;
      } else {
        outwardCgst += gst / 2;
        outwardSgst += gst / 2;
      }

      // Line items rates
      (s.items || []).forEach((item: any) => {
        const rate = parseFloat(item.tax_rate || item.gst || item.tax || 0);
        const itemTaxable = parseFloat(item.taxableAmount) || (parseFloat(item.qty || 1) * parseFloat(item.rate || 0));
        const itemTax = itemTaxable * (rate / 100);
        if (!rateBreakup[rate]) {
          rateBreakup[rate] = { rate, outTaxable: 0, outTax: 0, inTaxable: 0, inTax: 0 };
        }
        rateBreakup[rate].outTaxable += itemTaxable;
        rateBreakup[rate].outTax += itemTax;
      });
    });

    processedPurchases.forEach((b: any) => {
      if (!matchesDateRange(b.date)) return;
      const taxable = Number(b.total_without_gst) || 0;
      const gst = Number(b.total_gst) || 0;
      inwardTaxable += taxable;
      inwardTotalTax += gst;

      const isInter = b.gst_type === 'Inter-State' || b.gst_type === 'IGST';
      if (isInter) {
        inwardIgst += gst;
      } else {
        inwardCgst += gst / 2;
        inwardSgst += gst / 2;
      }

      (b.items || []).forEach((item: any) => {
        const rate = parseFloat(item.tax_rate || item.gst || item.tax || 0);
        const itemTaxable = parseFloat(item.taxableAmount) || (parseFloat(item.qty || 1) * parseFloat(item.rate || 0));
        const itemTax = itemTaxable * (rate / 100);
        if (!rateBreakup[rate]) {
          rateBreakup[rate] = { rate, outTaxable: 0, outTax: 0, inTaxable: 0, inTax: 0 };
        }
        rateBreakup[rate].inTaxable += itemTaxable;
        rateBreakup[rate].inTax += itemTax;
      });
    });

    const netTaxPayable = outwardTotalTax - inwardTotalTax;

    return {
      outwardTaxable,
      outwardCgst,
      outwardSgst,
      outwardIgst,
      outwardTotalTax,
      inwardTaxable,
      inwardCgst,
      inwardSgst,
      inwardIgst,
      inwardTotalTax,
      netTaxPayable,
      rates: Object.values(rateBreakup).sort((a, b) => a.rate - b.rate)
    };
  }, [processedSales, processedPurchases, dateRange]);

  // Filtered GSTR rate list by search query if any
  const filteredGstrRates = useMemo(() => {
    if (!searchQuery.trim()) return gstrSummary.rates;
    const q = searchQuery.toLowerCase().trim();
    return gstrSummary.rates.filter((r: any) => String(r.rate).includes(q));
  }, [gstrSummary.rates, searchQuery]);

  // Export Data Builder based on current view
  const currentExportData = useMemo(() => {
    if (activeTab === 'Sales Register') {
      return filteredSalesRegister.map((d: any) => ({
        'Date': formatDate(d.date),
        'Invoice #': d.invoice_number || d.bill_number,
        'Customer Name': d.customer_name || d.vendor_name,
        'Taxable Amount': Number(d.total_without_gst || 0).toFixed(2),
        'GST Amount': Number(d.total_gst || 0).toFixed(2),
        'Total Amount': Number(d.grand_total || 0).toFixed(2),
        'Status': d.status || 'Pending'
      }));
    }

    if (activeTab === 'Purchases Register') {
      return filteredPurchasesRegister.map((d: any) => ({
        'Date': formatDate(d.date),
        'Bill #': d.bill_number || d.invoice_number,
        'Vendor Name': d.vendor_name || d.customer_name,
        'Taxable Amount': Number(d.total_without_gst || 0).toFixed(2),
        'GST Amount': Number(d.total_gst || 0).toFixed(2),
        'Total Amount': Number(d.grand_total || 0).toFixed(2),
        'Status': d.status || 'Pending'
      }));
    }

    if (activeTab === 'Accounts Receivables') {
      return accountsReceivables.map((d: any) => ({
        'Date': formatDate(d.date),
        'Invoice #': d.invoice_number || d.bill_number,
        'Customer Name': d.customer_name,
        'Total Value': Number(d.grand_total || 0).toFixed(2),
        'Paid Amount': Number(d.totalPaid || 0).toFixed(2),
        'Pending Due': Number(d.outstanding || 0).toFixed(2),
        'Status': d.status || 'Pending'
      }));
    }

    if (activeTab === 'Accounts Payables') {
      return accountsPayables.map((d: any) => ({
        'Date': formatDate(d.date),
        'Bill #': d.bill_number || d.invoice_number,
        'Vendor Name': d.vendor_name,
        'Total Value': Number(d.grand_total || 0).toFixed(2),
        'Paid Amount': Number(d.totalPaid || 0).toFixed(2),
        'Pending Due': Number(d.outstanding || 0).toFixed(2),
        'Status': d.status || 'Pending'
      }));
    }

    if (activeTab === 'Party Ledgers') {
      if (selectedParty) {
        return selectedPartyLedger.rows.map((r: any) => ({
          'Date': r.date,
          'Transaction': r.transaction,
          'Reference Number': r.referenceNumber,
          'Debit': r.debit > 0 ? Number(r.debit).toFixed(2) : '-',
          'Credit': r.credit > 0 ? Number(r.credit).toFixed(2) : '-',
          'Balance': `${Number(Math.abs(r.balance)).toFixed(2)} ${r.balance === 0 ? 'Nil' : (r.balance > 0 ? 'Dr' : 'Cr')}`
        }));
      }

      return filteredPartiesList.map((p: any) => {
        const balInfo = partyBalances.get(String(p.id)) || { balance: 0, isDr: true };
        return {
          'Party Name': p.name,
          'Party Type': p.party_type || 'customer',
          'GSTIN': p.gstin || 'N/A',
          'Phone': p.phone || '-',
          'Opening Balance': Number(p.balance || 0).toFixed(2),
          'Current Balance': `${Number(Math.abs(balInfo.balance)).toFixed(2)} ${balInfo.balance === 0 ? 'Nil' : (balInfo.isDr ? 'Dr' : 'Cr')}`
        };
      });
    }

    if (activeTab === 'GSTR Summary') {
      return gstrSummary.rates.map((r: any) => ({
        'Tax Rate': `${r.rate}%`,
        'Sales Taxable': r.outTaxable.toFixed(2),
        'Sales Output Tax': r.outTax.toFixed(2),
        'Purchases Taxable': r.inTaxable.toFixed(2),
        'Purchases Input Tax': r.inTax.toFixed(2),
        'Net Tax': (r.outTax - r.inTax).toFixed(2)
      }));
    }

    return [];
  }, [
    activeTab, 
    filteredSalesRegister, 
    filteredPurchasesRegister, 
    accountsReceivables, 
    accountsPayables, 
    selectedParty, 
    selectedPartyLedger, 
    filteredPartiesList, 
    partyBalances, 
    gstrSummary
  ]);

  const handleExport = async (type: 'excel' | 'csv' | 'pdf') => {
    if (!currentExportData.length || !companyInfo) return;

    const headers = Object.keys(currentExportData[0]);
    const rows = currentExportData.map(obj => Object.values(obj));
    const title = activeTab === 'Party Ledgers' && selectedParty 
      ? `${selectedParty.name} - Statement of Account`
      : `${activeTab} Statement`;

    const config = {
      companyName: companyInfo.name,
      gstin: companyInfo.gstin || '',
      email: companyInfo.email || '',
      phone: companyInfo.phone || '',
      address: companyInfo.address || '',
      reportTitle: title,
      dateRange: dateRange.startDate && dateRange.endDate 
        ? `${dateRange.startDate} to ${dateRange.endDate}` 
        : 'All Time'
    };

    if (type === 'excel') await exportToExcel(headers, rows, config);
    else if (type === 'csv') exportToCSV(headers, rows, config);
    else if (type === 'pdf') {
      if (activeTab === 'Party Ledgers' && selectedParty) {
        setIsPartyLedgerPrintOpen(true);
      } else {
        triggerPrint();
      }
    }

    setIsExportModalOpen(false);
  };

  const handlePrintPartyLedger = () => {
    setIsPartyLedgerPrintOpen(true);
  };

  return (
    <>
      <ExportModal 
        isOpen={isExportModalOpen} 
        onClose={() => setIsExportModalOpen(false)} 
        onExport={handleExport} 
        reportName={activeTab === 'Party Ledgers' && selectedParty ? `${selectedParty.name} Ledger` : activeTab} 
      />

      {/* PIXEL-PERFECT PARTY LEDGER PRINT & PDF MODAL */}
      <PartyLedgerPrintModal
        isOpen={isPartyLedgerPrintOpen}
        onClose={() => setIsPartyLedgerPrintOpen(false)}
        party={selectedParty}
        companyInfo={companyInfo}
        ledgerRows={selectedPartyLedger.rows}
        dateRange={{ startDate: dateRange.startDate || undefined, endDate: dateRange.endDate || undefined }}
      />

      <ReportsEngineShell
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          setSelectedParty(null);
        }}
        headerDateFilter={
          activeTab !== 'Party Ledgers' ? (
            <DateFilter onFilterChange={setDateRange} />
          ) : undefined
        }
        onExportClick={() => verifyAction('Export Statement', () => setIsExportModalOpen(true))}
        isExportDisabled={currentExportData.length === 0}
        pendingReceivablesCount={accountsReceivables.length}
        pendingPayablesCount={accountsPayables.length}
      >
        {/* ==================================================================== */}
        {/* VIEW 1: SALES REGISTER                                               */}
        {/* ==================================================================== */}
        {activeTab === 'Sales Register' && (
          <div className="flex flex-col h-full">
            <ReportViewHeader
              title="Sales Register"
              subtitle="Complete outward sales invoices and tax breakdown"
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              searchPlaceholder="Search invoice or customer..."
            />

            <ReportKpiGrid
              items={[
                {
                  label: 'Total Invoices',
                  value: String(filteredSalesRegister.length),
                  subtitle: 'Sales recorded in period'
                },
                {
                  label: 'Taxable Turnover',
                  value: formatCurrency(salesTotals.taxable),
                  subtitle: 'Excluding taxes'
                },
                {
                  label: 'Output GST',
                  value: formatCurrency(salesTotals.gst),
                  subtitle: 'CGST + SGST + IGST',
                  valueColorClass: 'text-primary'
                },
                {
                  label: 'Grand Total',
                  value: formatCurrency(salesTotals.grandTotal),
                  subtitle: 'Gross outward sales',
                  valueColorClass: 'text-emerald-600 dark:text-emerald-400'
                }
              ]}
            />

            <ReportTable
              loading={loading}
              isEmpty={filteredSalesRegister.length === 0}
              emptyMessage="No sales invoices found for the selected period."
            >
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-slate-500 font-semibold uppercase tracking-wider">
                  <th className="py-3 px-4 w-12 text-center">Sr</th>
                  <th className="py-3 px-4 w-28">Date</th>
                  <th className="py-3 px-4 w-36">Invoice #</th>
                  <th className="py-3 px-4">Customer Name</th>
                  <th className="py-3 px-4 text-right w-32">Taxable</th>
                  <th className="py-3 px-4 text-right w-28">GST</th>
                  <th className="py-3 px-4 text-right w-36">Total Amount</th>
                  <th className="py-3 px-4 text-center w-24">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
                {filteredSalesRegister.map((inv: any, idx: number) => (
                  <tr key={inv.id || idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="py-3 px-4 text-center text-slate-400 font-mono">{idx + 1}</td>
                    <td className="py-3 px-4 font-mono text-slate-600 dark:text-slate-400">{formatDate(inv.date)}</td>
                    <td className="py-3 px-4 font-mono font-semibold">{inv.invoice_number || inv.bill_number}</td>
                    <td className="py-3 px-4 font-semibold uppercase">{inv.customer_name || inv.vendor_name}</td>
                    <td className="py-3 px-4 text-right font-mono">{formatCurrency(inv.total_without_gst)}</td>
                    <td className="py-3 px-4 text-right font-mono">{formatCurrency(inv.total_gst)}</td>
                    <td className="py-3 px-4 text-right font-mono font-bold">{formatCurrency(inv.grand_total)}</td>
                    <td className="py-3 px-4 text-center">
                      <span className={`text-[11px] font-semibold ${
                        inv.status === 'Paid' 
                          ? 'text-emerald-600 dark:text-emerald-400' 
                          : 'text-amber-600 dark:text-amber-400'
                      }`}>
                        {inv.status || 'Pending'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </ReportTable>

            <ReportTotalsBar>
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
                <div className="text-slate-500 dark:text-slate-400">
                  Total <span className="font-semibold text-slate-700 dark:text-slate-200">{filteredSalesRegister.length}</span> invoices in period
                </div>
                <div className="flex flex-wrap items-center gap-6">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 mr-2">Taxable:</span>
                    <span className="font-mono font-semibold text-slate-800 dark:text-slate-100">{formatCurrency(salesTotals.taxable)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 mr-2">GST:</span>
                    <span className="font-mono font-semibold text-primary">{formatCurrency(salesTotals.gst)}</span>
                  </div>
                  <div className="border-l border-slate-300 dark:border-slate-700 pl-4">
                    <span className="text-[10px] uppercase font-bold text-slate-500 mr-2">Grand Total:</span>
                    <span className="font-mono font-bold text-sm text-emerald-600 dark:text-emerald-400">{formatCurrency(salesTotals.grandTotal)}</span>
                  </div>
                </div>
              </div>
            </ReportTotalsBar>
          </div>
        )}

        {/* ==================================================================== */}
        {/* VIEW 2: PURCHASES REGISTER                                           */}
        {/* ==================================================================== */}
        {activeTab === 'Purchases Register' && (
          <div className="flex flex-col h-full">
            <ReportViewHeader
              title="Purchases Register"
              subtitle="Complete inward purchase bills and ITC breakdown"
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              searchPlaceholder="Search bill or vendor..."
            />

            <ReportKpiGrid
              items={[
                {
                  label: 'Total Bills',
                  value: String(filteredPurchasesRegister.length),
                  subtitle: 'Purchase bills in period'
                },
                {
                  label: 'Taxable Inward',
                  value: formatCurrency(purchaseTotals.taxable),
                  subtitle: 'Excluding taxes'
                },
                {
                  label: 'Input Tax Credit',
                  value: formatCurrency(purchaseTotals.gst),
                  subtitle: 'Eligible ITC claimed',
                  valueColorClass: 'text-primary'
                },
                {
                  label: 'Total Purchases',
                  value: formatCurrency(purchaseTotals.grandTotal),
                  subtitle: 'Gross inward purchases',
                  valueColorClass: 'text-slate-900 dark:text-white'
                }
              ]}
            />

            <ReportTable
              loading={loading}
              isEmpty={filteredPurchasesRegister.length === 0}
              emptyMessage="No purchase bills found for the selected period."
            >
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-slate-500 font-semibold uppercase tracking-wider">
                  <th className="py-3 px-4 w-12 text-center">Sr</th>
                  <th className="py-3 px-4 w-28">Date</th>
                  <th className="py-3 px-4 w-36">Bill #</th>
                  <th className="py-3 px-4">Vendor Name</th>
                  <th className="py-3 px-4 text-right w-32">Taxable</th>
                  <th className="py-3 px-4 text-right w-28">GST</th>
                  <th className="py-3 px-4 text-right w-36">Total Amount</th>
                  <th className="py-3 px-4 text-center w-24">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
                {filteredPurchasesRegister.map((b: any, idx: number) => (
                  <tr key={b.id || idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="py-3 px-4 text-center text-slate-400 font-mono">{idx + 1}</td>
                    <td className="py-3 px-4 font-mono text-slate-600 dark:text-slate-400">{formatDate(b.date)}</td>
                    <td className="py-3 px-4 font-mono font-semibold">{b.bill_number || b.invoice_number}</td>
                    <td className="py-3 px-4 font-semibold uppercase">{b.vendor_name || b.customer_name}</td>
                    <td className="py-3 px-4 text-right font-mono">{formatCurrency(b.total_without_gst)}</td>
                    <td className="py-3 px-4 text-right font-mono">{formatCurrency(b.total_gst)}</td>
                    <td className="py-3 px-4 text-right font-mono font-bold">{formatCurrency(b.grand_total)}</td>
                    <td className="py-3 px-4 text-center">
                      <span className={`text-[11px] font-semibold ${
                        b.status === 'Paid' 
                          ? 'text-emerald-600 dark:text-emerald-400' 
                          : 'text-amber-600 dark:text-amber-400'
                      }`}>
                        {b.status || 'Pending'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </ReportTable>

            <ReportTotalsBar>
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
                <div className="text-slate-500 dark:text-slate-400">
                  Total <span className="font-semibold text-slate-700 dark:text-slate-200">{filteredPurchasesRegister.length}</span> purchase bills
                </div>
                <div className="flex flex-wrap items-center gap-6">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 mr-2">Taxable:</span>
                    <span className="font-mono font-semibold text-slate-800 dark:text-slate-100">{formatCurrency(purchaseTotals.taxable)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 mr-2">Input GST:</span>
                    <span className="font-mono font-semibold text-primary">{formatCurrency(purchaseTotals.gst)}</span>
                  </div>
                  <div className="border-l border-slate-300 dark:border-slate-700 pl-4">
                    <span className="text-[10px] uppercase font-bold text-slate-500 mr-2">Grand Total:</span>
                    <span className="font-mono font-bold text-sm text-slate-900 dark:text-white">{formatCurrency(purchaseTotals.grandTotal)}</span>
                  </div>
                </div>
              </div>
            </ReportTotalsBar>
          </div>
        )}

        {/* ==================================================================== */}
        {/* VIEW 3: ACCOUNTS RECEIVABLES                                         */}
        {/* ==================================================================== */}
        {activeTab === 'Accounts Receivables' && (
          <div className="flex flex-col h-full">
            <ReportViewHeader
              title="Accounts Receivables"
              subtitle="Unpaid and pending customer sales invoices requiring payment collection"
              badge={
                <span className="text-[11px] font-mono text-amber-600 dark:text-amber-400 font-bold ml-1">
                  ({accountsReceivables.length} Pending)
                </span>
              }
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              searchPlaceholder="Search customer or invoice..."
            />

            <ReportKpiGrid
              items={[
                {
                  label: 'Pending Invoices',
                  value: String(accountsReceivables.length),
                  subtitle: 'Invoices due for collection'
                },
                {
                  label: 'Invoiced Value',
                  value: formatCurrency(receivableTotals.invoiced),
                  subtitle: 'Total billed to customers'
                },
                {
                  label: 'Amount Collected',
                  value: formatCurrency(receivableTotals.paid),
                  subtitle: 'Partial receipts recorded',
                  valueColorClass: 'text-emerald-600 dark:text-emerald-400'
                },
                {
                  label: 'Pending Due',
                  value: formatCurrency(receivableTotals.outstanding),
                  subtitle: 'Uncollected receivables',
                  valueColorClass: 'text-rose-600 dark:text-rose-400'
                }
              ]}
            />

            <ReportTable
              loading={loading}
              isEmpty={accountsReceivables.length === 0}
              emptyMessage="No pending sales invoices found. All customer receivables are settled!"
            >
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-slate-500 font-semibold uppercase tracking-wider">
                  <th className="py-3 px-4 w-12 text-center">Sr</th>
                  <th className="py-3 px-4 w-28">Date</th>
                  <th className="py-3 px-4 w-36">Invoice #</th>
                  <th className="py-3 px-4">Customer Name</th>
                  <th className="py-3 px-4 text-right w-32">Invoice Total</th>
                  <th className="py-3 px-4 text-right w-32">Paid Amount</th>
                  <th className="py-3 px-4 text-right w-36">Pending Due</th>
                  <th className="py-3 px-4 text-center w-24">Status</th>
                  <th className="py-3 px-4 text-center w-20">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
                {accountsReceivables.map((inv: any, idx: number) => (
                  <tr key={inv.id || idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="py-3 px-4 text-center text-slate-400 font-mono">{idx + 1}</td>
                    <td className="py-3 px-4 font-mono text-slate-600 dark:text-slate-400">{formatDate(inv.date)}</td>
                    <td className="py-3 px-4 font-mono font-semibold">{inv.invoice_number || inv.bill_number}</td>
                    <td className="py-3 px-4 font-semibold uppercase">{inv.customer_name}</td>
                    <td className="py-3 px-4 text-right font-mono">{formatCurrency(inv.grand_total)}</td>
                    <td className="py-3 px-4 text-right font-mono text-emerald-600 dark:text-emerald-400">{formatCurrency(inv.totalPaid)}</td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-rose-600 dark:text-rose-400">{formatCurrency(inv.outstanding)}</td>
                    <td className="py-3 px-4 text-center">
                      <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                        Pending
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                      <ActionMenu
                        items={[
                          {
                            label: 'Settle Payment',
                            icon: ArrowDownLeft,
                            variant: 'success',
                            onClick: () => {
                              setSettlePayment({
                                isOpen: true,
                                type: 'Receipt',
                                partyName: inv.customer_name || inv.vendor_name || '',
                                billId: inv.id,
                                amount: Number(inv.outstanding ?? inv.grand_total ?? 0)
                              });
                            }
                          }
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </ReportTable>

            <ReportTotalsBar>
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
                <div className="text-slate-500 dark:text-slate-400">
                  <span className="font-semibold text-slate-700 dark:text-slate-200">{accountsReceivables.length}</span> outstanding invoices
                </div>
                <div className="flex flex-wrap items-center gap-6">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 mr-2">Invoiced:</span>
                    <span className="font-mono font-semibold text-slate-800 dark:text-slate-100">{formatCurrency(receivableTotals.invoiced)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 mr-2">Collected:</span>
                    <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">{formatCurrency(receivableTotals.paid)}</span>
                  </div>
                  <div className="border-l border-slate-300 dark:border-slate-700 pl-4">
                    <span className="text-[10px] uppercase font-bold text-slate-500 mr-2">Total Due:</span>
                    <span className="font-mono font-bold text-sm text-rose-600 dark:text-rose-400">{formatCurrency(receivableTotals.outstanding)}</span>
                  </div>
                </div>
              </div>
            </ReportTotalsBar>
          </div>
        )}

        {/* ==================================================================== */}
        {/* VIEW 4: ACCOUNTS PAYABLES                                            */}
        {/* ==================================================================== */}
        {activeTab === 'Accounts Payables' && (
          <div className="flex flex-col h-full">
            <ReportViewHeader
              title="Accounts Payables"
              subtitle="Unpaid and pending supplier purchase bills requiring payment release"
              badge={
                <span className="text-[11px] font-mono text-rose-600 dark:text-rose-400 font-bold ml-1">
                  ({accountsPayables.length} Pending)
                </span>
              }
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              searchPlaceholder="Search vendor or bill..."
            />

            <ReportKpiGrid
              items={[
                {
                  label: 'Pending Bills',
                  value: String(accountsPayables.length),
                  subtitle: 'Bills awaiting payment'
                },
                {
                  label: 'Billed Value',
                  value: formatCurrency(payableTotals.billed),
                  subtitle: 'Total billed by vendors'
                },
                {
                  label: 'Amount Paid',
                  value: formatCurrency(payableTotals.paid),
                  subtitle: 'Partial payments released',
                  valueColorClass: 'text-emerald-600 dark:text-emerald-400'
                },
                {
                  label: 'Pending Due',
                  value: formatCurrency(payableTotals.outstanding),
                  subtitle: 'Outstanding payable liability',
                  valueColorClass: 'text-rose-600 dark:text-rose-400'
                }
              ]}
            />

            <ReportTable
              loading={loading}
              isEmpty={accountsPayables.length === 0}
              emptyMessage="No pending purchase bills found. All supplier payables are cleared!"
            >
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-slate-500 font-semibold uppercase tracking-wider">
                  <th className="py-3 px-4 w-12 text-center">Sr</th>
                  <th className="py-3 px-4 w-28">Date</th>
                  <th className="py-3 px-4 w-36">Bill #</th>
                  <th className="py-3 px-4">Vendor Name</th>
                  <th className="py-3 px-4 text-right w-32">Bill Total</th>
                  <th className="py-3 px-4 text-right w-32">Paid Amount</th>
                  <th className="py-3 px-4 text-right w-36">Pending Due</th>
                  <th className="py-3 px-4 text-center w-24">Status</th>
                  <th className="py-3 px-4 text-center w-20">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
                {accountsPayables.map((b: any, idx: number) => (
                  <tr key={b.id || idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="py-3 px-4 text-center text-slate-400 font-mono">{idx + 1}</td>
                    <td className="py-3 px-4 font-mono text-slate-600 dark:text-slate-400">{formatDate(b.date)}</td>
                    <td className="py-3 px-4 font-mono font-semibold">{b.bill_number || b.invoice_number}</td>
                    <td className="py-3 px-4 font-semibold uppercase">{b.vendor_name}</td>
                    <td className="py-3 px-4 text-right font-mono">{formatCurrency(b.grand_total)}</td>
                    <td className="py-3 px-4 text-right font-mono text-emerald-600 dark:text-emerald-400">{formatCurrency(b.totalPaid)}</td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-rose-600 dark:text-rose-400">{formatCurrency(b.outstanding)}</td>
                    <td className="py-3 px-4 text-center">
                      <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                        Pending
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                      <ActionMenu
                        items={[
                          {
                            label: 'Settle Payment',
                            icon: ArrowUpCircle,
                            variant: 'success',
                            onClick: () => {
                              setSettlePayment({
                                isOpen: true,
                                type: 'Payment',
                                partyName: b.vendor_name || b.customer_name || '',
                                billId: b.id,
                                amount: Number(b.outstanding ?? b.grand_total ?? 0)
                              });
                            }
                          }
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </ReportTable>

            <ReportTotalsBar>
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
                <div className="text-slate-500 dark:text-slate-400">
                  <span className="font-semibold text-slate-700 dark:text-slate-200">{accountsPayables.length}</span> outstanding purchase bills
                </div>
                <div className="flex flex-wrap items-center gap-6">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 mr-2">Billed:</span>
                    <span className="font-mono font-semibold text-slate-800 dark:text-slate-100">{formatCurrency(payableTotals.billed)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 mr-2">Paid:</span>
                    <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">{formatCurrency(payableTotals.paid)}</span>
                  </div>
                  <div className="border-l border-slate-300 dark:border-slate-700 pl-4">
                    <span className="text-[10px] uppercase font-bold text-slate-500 mr-2">Total Due:</span>
                    <span className="font-mono font-bold text-sm text-rose-600 dark:text-rose-400">{formatCurrency(payableTotals.outstanding)}</span>
                  </div>
                </div>
              </div>
            </ReportTotalsBar>
          </div>
        )}

        {/* ==================================================================== */}
        {/* VIEW 5: PARTY LEDGERS                                                */}
        {/* ==================================================================== */}
        {activeTab === 'Party Ledgers' && (
          <div className="flex flex-col h-full">
            {!selectedParty ? (
              /* State A: Party Directory Listing */
              <div className="flex flex-col h-full">
                <ReportViewHeader
                  title="Party Ledgers"
                  subtitle="Select any party account below to inspect their full statement of account"
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  searchPlaceholder="Search party name, GSTIN..."
                  filterControl={
                    <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg text-xs font-semibold shrink-0">
                      <button
                        type="button"
                        onClick={() => setPartyTypeFilter('customer')}
                        className={`px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
                          partyTypeFilter === 'customer' 
                            ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs font-bold' 
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                        }`}
                      >
                        Customers
                      </button>
                      <button
                        type="button"
                        onClick={() => setPartyTypeFilter('vendor')}
                        className={`px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
                          partyTypeFilter === 'vendor' 
                            ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs font-bold' 
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                        }`}
                      >
                        Vendors
                      </button>
                      <button
                        type="button"
                        onClick={() => setPartyTypeFilter('both')}
                        className={`px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
                          partyTypeFilter === 'both' 
                            ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs font-bold' 
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                        }`}
                      >
                        Both
                      </button>
                    </div>
                  }
                />

                <ReportKpiGrid
                  items={[
                    {
                      label: 'Total Parties',
                      value: String(filteredPartiesList.length),
                      subtitle: 'Active party accounts'
                    },
                    {
                      label: 'Total Receivables (Dr)',
                      value: formatCurrency(partyAggregates.totalReceivablesDr),
                      subtitle: 'Receivable from customers',
                      valueColorClass: 'text-blue-600 dark:text-blue-400'
                    },
                    {
                      label: 'Total Payables (Cr)',
                      value: formatCurrency(partyAggregates.totalPayablesCr),
                      subtitle: 'Payable to vendors',
                      valueColorClass: 'text-amber-600 dark:text-amber-500'
                    },
                    {
                      label: 'Net Exposure',
                      value: formatCurrency(Math.abs(partyAggregates.totalReceivablesDr - partyAggregates.totalPayablesCr)),
                      subtitle: partyAggregates.totalReceivablesDr >= partyAggregates.totalPayablesCr ? 'Net Receivable' : 'Net Payable',
                      valueColorClass: 'text-slate-900 dark:text-white'
                    }
                  ]}
                />

                <ReportTable
                  loading={loading}
                  isEmpty={filteredPartiesList.length === 0}
                  emptyMessage="No parties found matching the selected filter."
                >
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-slate-500 font-semibold uppercase tracking-wider">
                      <th className="py-3 px-4 w-12 text-center">Sr</th>
                      <th className="py-3 px-4">Party Name</th>
                      <th className="py-3 px-4 w-28">Type</th>
                      <th className="py-3 px-4 w-36">GSTIN</th>
                      <th className="py-3 px-4 w-32">Phone</th>
                      <th className="py-3 px-4 text-right w-32">Opening Bal</th>
                      <th className="py-3 px-4 text-right w-40">Current Ledger Balance</th>
                      <th className="py-3 px-4 text-center w-28">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
                    {filteredPartiesList.map((p: any, idx: number) => {
                      const balInfo = partyBalances.get(String(p.id)) || { balance: 0, isDr: true };
                      const isCust = p.party_type === 'customer' || p.is_customer === true;

                      return (
                        <tr 
                          key={p.id || idx} 
                          onClick={() => setSelectedParty(p)}
                          className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
                        >
                          <td className="py-3 px-4 text-center text-slate-400 font-mono">{idx + 1}</td>
                          <td className="py-3 px-4 font-bold text-slate-900 dark:text-white uppercase">{p.name}</td>
                          <td className="py-3 px-4">
                            <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                              {p.party_type === 'both' ? 'Both' : (isCust ? 'Customer' : 'Vendor')}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-mono text-slate-500 text-[11px]">{p.gstin || '-'}</td>
                          <td className="py-3 px-4 font-mono text-slate-500 text-[11px]">{p.phone || '-'}</td>
                          <td className="py-3 px-4 text-right font-mono">{formatCurrency(p.balance || 0)}</td>
                          <td className="py-3 px-4 text-right font-mono font-bold">
                            <span className={balInfo.balance > 0 ? 'text-blue-600 dark:text-blue-400' : (balInfo.balance < 0 ? 'text-amber-600 dark:text-amber-500' : 'text-slate-400')}>
                              {formatCurrency(Math.abs(balInfo.balance))}
                              <span className="text-[10px] ml-1 uppercase font-semibold">
                                {balInfo.balance === 0 ? 'Nil' : (balInfo.isDr ? 'Dr' : 'Cr')}
                              </span>
                            </span>
                          </td>
                          <td className="py-3 px-4 text-center">
                            <button 
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedParty(p);
                              }}
                              className="px-2.5 py-1 bg-primary text-white rounded text-xs font-semibold hover:bg-primary-dark transition-colors cursor-pointer shadow-2xs"
                            >
                              View Ledger
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </ReportTable>

                <ReportTotalsBar>
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
                    <div className="text-slate-500 dark:text-slate-400">
                      Total <span className="font-semibold text-slate-700 dark:text-slate-200">{filteredPartiesList.length}</span> parties displayed
                    </div>
                    <div className="flex flex-wrap items-center gap-6">
                      <div>
                        <span className="text-[10px] uppercase font-bold text-slate-400 mr-2">Total Receivables:</span>
                        <span className="font-mono font-semibold text-blue-600 dark:text-blue-400">{formatCurrency(partyAggregates.totalReceivablesDr)}</span>
                      </div>
                      <div>
                        <span className="text-[10px] uppercase font-bold text-slate-400 mr-2">Total Payables:</span>
                        <span className="font-mono font-semibold text-amber-600 dark:text-amber-500">{formatCurrency(partyAggregates.totalPayablesCr)}</span>
                      </div>
                    </div>
                  </div>
                </ReportTotalsBar>
              </div>
            ) : (
              /* State B: Selected Party Detailed Account Ledger */
              <div className="flex flex-col h-full">
                <ReportViewHeader
                  onBack={() => setSelectedParty(null)}
                  backLabel="Back to Parties"
                  title={selectedParty.name}
                  subtitle={`GSTIN: ${selectedParty.gstin || 'URD (Unregistered)'}${selectedParty.phone ? ` • Phone: ${selectedParty.phone}` : ''}`}
                  badge={
                    <span className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400 ml-1">
                      {selectedParty.party_type === 'both' ? 'Customer & Vendor' : (selectedParty.party_type === 'customer' || selectedParty.is_customer ? 'Customer' : 'Vendor')}
                    </span>
                  }
                  actionButton={
                    <button
                      type="button"
                      onClick={handlePrintPartyLedger}
                      className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-semibold flex items-center cursor-pointer shadow-2xs"
                    >
                      <Printer className="w-3.5 h-3.5 mr-1.5 text-primary" /> Print Ledger
                    </button>
                  }
                />

                <ReportKpiGrid
                  items={[
                    {
                      label: 'Opening Balance',
                      value: formatCurrency(Math.abs(Number(selectedParty.balance) || 0)),
                      subtitle: Number(selectedParty.balance) === 0 ? 'Nil' : ((selectedParty.party_type === 'customer' || selectedParty.is_customer) ? 'Dr (Receivable)' : 'Cr (Payable)')
                    },
                    {
                      label: 'Total Debit',
                      value: formatCurrency(selectedPartyLedger.totalDebit),
                      subtitle: 'Invoiced debits / payments',
                      valueColorClass: 'text-rose-600 dark:text-rose-400'
                    },
                    {
                      label: 'Total Credit',
                      value: formatCurrency(selectedPartyLedger.totalCredit),
                      subtitle: 'Receipts / bills credited',
                      valueColorClass: 'text-emerald-600 dark:text-emerald-400'
                    },
                    {
                      label: 'Net Balance',
                      value: formatCurrency(Math.abs(selectedPartyLedger.finalBalance)),
                      subtitle: selectedPartyLedger.finalBalance === 0 ? 'Nil' : (selectedPartyLedger.finalBalance > 0 ? 'Dr (Receivable)' : 'Cr (Payable)'),
                      valueColorClass: selectedPartyLedger.finalBalance > 0 ? 'text-blue-600 dark:text-blue-400' : (selectedPartyLedger.finalBalance < 0 ? 'text-amber-600 dark:text-amber-500' : 'text-slate-500')
                    }
                  ]}
                />

                {/* Table with columns: Date, Transaction, Reference Number (show bill number here), Debit, Credit, Balance */}
                <ReportTable
                  loading={false}
                  isEmpty={selectedPartyLedger.rows.length === 0}
                  emptyMessage="No ledger entries found for this party."
                  minWidth="min-w-[750px]"
                >
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-slate-500 font-semibold uppercase tracking-wider">
                      <th className="py-3 px-4 w-32">Date</th>
                      <th className="py-3 px-4">Transaction</th>
                      <th className="py-3 px-4 w-44">Reference Number</th>
                      <th className="py-3 px-4 text-right w-36">Debit</th>
                      <th className="py-3 px-4 text-right w-36">Credit</th>
                      <th className="py-3 px-4 text-right w-44 bg-slate-100/40 dark:bg-slate-800/40">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
                    {selectedPartyLedger.rows.map((row: any, idx: number) => {
                      const isDr = row.balance > 0;
                      const isCr = row.balance < 0;

                      return (
                        <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                          <td className="py-3 px-4 font-mono text-slate-500 dark:text-slate-400">{row.date}</td>
                          <td className="py-3 px-4 font-semibold">
                            <span className="flex items-center">
                              {row.debit > 0 ? (
                                <ArrowUpRight className="w-3.5 h-3.5 text-rose-500 mr-1.5 shrink-0" />
                              ) : row.credit > 0 ? (
                                <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-500 mr-1.5 shrink-0" />
                              ) : null}
                              <span>{row.transaction}</span>
                            </span>
                          </td>
                          <td className="py-3 px-4 font-mono font-bold text-slate-700 dark:text-slate-300">
                            {row.referenceNumber}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-semibold text-rose-600 dark:text-rose-400">
                            {row.debit > 0 ? formatCurrency(row.debit, false) : '-'}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                            {row.credit > 0 ? formatCurrency(row.credit, false) : '-'}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-bold bg-slate-50/50 dark:bg-slate-800/20">
                            {formatCurrency(Math.abs(row.balance), false)}
                            <span className={`text-[10px] ml-1 uppercase font-bold ${
                              isDr ? 'text-blue-600 dark:text-blue-400' : isCr ? 'text-amber-600 dark:text-amber-500' : 'text-slate-400'
                            }`}>
                              {row.balance === 0 ? 'Nil' : (isDr ? 'Dr' : 'Cr')}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </ReportTable>

                {/* Bottom of the section: show total debit, total credit, and below them, show total balance */}
                <ReportTotalsBar>
                  {/* Row 1: Total Debit and Total Credit */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg flex items-center justify-between">
                      <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        Total Debit
                      </span>
                      <span className="text-base font-mono font-bold text-rose-600 dark:text-rose-400">
                        {formatCurrency(selectedPartyLedger.totalDebit)}
                      </span>
                    </div>
                    <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg flex items-center justify-between">
                      <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        Total Credit
                      </span>
                      <span className="text-base font-mono font-bold text-emerald-600 dark:text-emerald-400">
                        {formatCurrency(selectedPartyLedger.totalCredit)}
                      </span>
                    </div>
                  </div>

                  {/* Row 2: Total Balance (Below them) */}
                  <div className="p-3.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg flex items-center justify-between shadow-2xs">
                    <div>
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-widest block">
                        Total Balance
                      </span>
                      <span className="text-[10px] text-slate-400 font-medium">
                        {selectedPartyLedger.finalBalance === 0 ? 'Account settled' : (selectedPartyLedger.finalBalance > 0 ? 'Receivable from customer' : 'Payable to supplier')}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className={`text-xl font-mono font-extrabold ${
                        selectedPartyLedger.finalBalance > 0 
                          ? 'text-blue-600 dark:text-blue-400' 
                          : (selectedPartyLedger.finalBalance < 0 ? 'text-amber-600 dark:text-amber-500' : 'text-slate-500')
                      }`}>
                        {formatCurrency(Math.abs(selectedPartyLedger.finalBalance))}
                        <span className="text-xs ml-1.5 uppercase font-bold">
                          {selectedPartyLedger.finalBalance === 0 ? 'Nil' : (selectedPartyLedger.finalBalance > 0 ? 'Dr' : 'Cr')}
                        </span>
                      </span>
                    </div>
                  </div>
                </ReportTotalsBar>
              </div>
            )}
          </div>
        )}

        {/* ==================================================================== */}
        {/* VIEW 6: GSTR SUMMARY                                                 */}
        {/* ==================================================================== */}
        {activeTab === 'GSTR Summary' && (
          <div className="flex flex-col h-full">
            <ReportViewHeader
              title="GSTR Summary"
              subtitle="Outward sales tax liabilities vs inward purchase tax credits (ITC)"
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              searchPlaceholder="Filter by tax rate %..."
            />

            <ReportKpiGrid
              items={[
                {
                  label: 'Outward Tax (Sales)',
                  value: formatCurrency(gstrSummary.outwardTotalTax),
                  subtitle: `Taxable: ${formatCurrency(gstrSummary.outwardTaxable)}`,
                  valueColorClass: 'text-slate-900 dark:text-white'
                },
                {
                  label: 'Input Tax Credit (ITC)',
                  value: formatCurrency(gstrSummary.inwardTotalTax),
                  subtitle: `Taxable: ${formatCurrency(gstrSummary.inwardTaxable)}`,
                  valueColorClass: 'text-emerald-600 dark:text-emerald-400'
                },
                {
                  label: 'Net Tax Liability',
                  value: formatCurrency(Math.abs(gstrSummary.netTaxPayable)),
                  subtitle: gstrSummary.netTaxPayable > 0 ? 'Payable to Government' : 'ITC Carried Forward',
                  valueColorClass: gstrSummary.netTaxPayable > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'
                }
              ]}
            />

            <ReportTable
              loading={loading}
              isEmpty={filteredGstrRates.length === 0}
              emptyMessage="No GST transactions found for the selected period."
              minWidth="min-w-[650px]"
            >
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-slate-500 font-semibold uppercase tracking-wider">
                  <th className="py-3 px-4 w-28">Tax Rate</th>
                  <th className="py-3 px-4 text-right">Sales Taxable</th>
                  <th className="py-3 px-4 text-right">Output GST</th>
                  <th className="py-3 px-4 text-right">Purchase Taxable</th>
                  <th className="py-3 px-4 text-right">Input GST (ITC)</th>
                  <th className="py-3 px-4 text-right font-bold w-36">Net GST</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
                {filteredGstrRates.map((r: any, idx: number) => {
                  const netGst = r.outTax - r.inTax;
                  return (
                    <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="py-3 px-4 font-bold">{r.rate}%</td>
                      <td className="py-3 px-4 text-right font-mono">{formatCurrency(r.outTaxable)}</td>
                      <td className="py-3 px-4 text-right font-mono text-slate-900 dark:text-white font-medium">{formatCurrency(r.outTax)}</td>
                      <td className="py-3 px-4 text-right font-mono">{formatCurrency(r.inTaxable)}</td>
                      <td className="py-3 px-4 text-right font-mono text-emerald-600 dark:text-emerald-400 font-medium">{formatCurrency(r.inTax)}</td>
                      <td className={`py-3 px-4 text-right font-mono font-bold ${netGst > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {formatCurrency(netGst)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </ReportTable>

            <ReportTotalsBar>
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
                <div className="text-slate-500 dark:text-slate-400">
                  Rate-wise tax audit summary for {gstrSummary.rates.length} active GST slabs
                </div>
                <div className="flex flex-wrap items-center gap-6">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 mr-2">Total Output GST:</span>
                    <span className="font-mono font-semibold text-slate-900 dark:text-white">{formatCurrency(gstrSummary.outwardTotalTax)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 mr-2">Total ITC:</span>
                    <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">{formatCurrency(gstrSummary.inwardTotalTax)}</span>
                  </div>
                  <div className="border-l border-slate-300 dark:border-slate-700 pl-4">
                    <span className="text-[10px] uppercase font-bold text-slate-500 mr-2">Net Tax:</span>
                    <span className={`font-mono font-bold text-sm ${gstrSummary.netTaxPayable > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                      {formatCurrency(Math.abs(gstrSummary.netTaxPayable))}
                    </span>
                  </div>
                </div>
              </div>
            </ReportTotalsBar>
          </div>
        )}
      </ReportsEngineShell>

      {settlePayment?.isOpen && (
        <PaymentVoucherModal
          isOpen={settlePayment.isOpen}
          onClose={() => setSettlePayment(null)}
          initialType={settlePayment.type}
          initialPartyName={settlePayment.partyName}
          initialBillId={settlePayment.billId}
          initialAmount={settlePayment.amount}
          onSuccess={() => {
            setSettlePayment(null);
            loadData();
          }}
        />
      )}
    </>
  );
};

export default Reports;
