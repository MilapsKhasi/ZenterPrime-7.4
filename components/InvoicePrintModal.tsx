import React, { useEffect, useState, useRef } from 'react';
import { Printer, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getActiveCompanyId, getAppSettings, parseInvoiceItems } from '../utils/helpers';

interface InvoicePrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: any;
}

export function numberToWords(num: number): string {
  if (isNaN(num) || num === 0) return 'Rupees Zero only...';

  const a = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'
  ];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const inWords = (n: number): string => {
    if (n < 20) return a[n];
    if (n < 100) return b[Math.floor(n / 10)] + (n % 10 !== 0 ? ' ' + a[n % 10] : '');
    if (n < 1000) return a[Math.floor(n / 100)] + ' Hundred' + (n % 100 !== 0 ? ' ' + inWords(n % 100) : '');
    if (n < 100000) return inWords(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 !== 0 ? ' ' + inWords(n % 1000) : '');
    if (n < 10000000) return inWords(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 !== 0 ? ' ' + inWords(n % 100000) : '');
    return inWords(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 !== 0 ? ' ' + inWords(n % 10000000) : '');
  };

  const integerPart = Math.floor(Math.abs(num));
  const decimalPart = Math.round((Math.abs(num) - integerPart) * 100);

  let str = 'Rupees ' + inWords(integerPart);
  if (decimalPart > 0) {
    str += ' and ' + inWords(decimalPart) + ' Paise';
  }
  str += ' only...';
  return str;
}

const formatInvoiceDate = (dStr: string) => {
  if (!dStr) return '';
  const d = new Date(dStr);
  if (isNaN(d.getTime())) return dStr;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = String(d.getFullYear()).slice(-2);
  return `${day}/${month}/${year}`;
};

export const InvoicePrintModal: React.FC<InvoicePrintModalProps> = ({ isOpen, onClose, invoice }) => {
  const cid = getActiveCompanyId();
  const [company, setCompany] = useState<any>({});
  const [partnerInfo, setPartnerInfo] = useState<any>(null);
  const [customer, setCustomer] = useState<any>(null);
  const invoiceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen || !invoice) return;

    const fetchDetails = async () => {
      let currentComp: any = null;
      if (cid) {
        const { data: comp } = await supabase.from('companies').select('*').eq('id', cid).maybeSingle();
        currentComp = comp;
        if (comp) setCompany(comp);
      }

      const raw = invoice?.items_raw || invoice?.items || {};
      const savedPartner = raw?.partner_company;
      const settings = getAppSettings();
      const partnerId = savedPartner?.id || settings.partnerCompanyId || currentComp?.partner_company_id;

      if (savedPartner && savedPartner.gstin) {
        setPartnerInfo(savedPartner);
      } else if (partnerId) {
        const { data: pComp } = await supabase.from('companies').select('*').eq('id', partnerId).maybeSingle();
        if (pComp && pComp.gstin) {
          setPartnerInfo(pComp);
        } else if (settings.partnerCompanyGstin) {
          setPartnerInfo({
            id: settings.partnerCompanyId,
            name: settings.partnerCompanyName,
            gstin: settings.partnerCompanyGstin,
            address: settings.partnerCompanyAddress
          });
        }
      } else {
        setPartnerInfo(null);
      }

      const partyName = invoice.customer_name || invoice.vendor_name;
      if (partyName && cid) {
        let { data: cust } = await supabase.from('vendors').select('*').eq('company_id', cid).eq('name', partyName).eq('is_deleted', false).maybeSingle();
        if (!cust) {
          const res = await supabase.from('customers').select('*').eq('company_id', cid).eq('name', partyName).eq('is_deleted', false).maybeSingle();
          cust = res.data;
        }
        if (cust) setCustomer(cust);
      }
    };
    fetchDetails();
  }, [isOpen, invoice, cid]);

  if (!isOpen || !invoice) return null;

  const itemsRaw = invoice?.items_raw || invoice?.items || {};
  let lineItems: any[] = [];
  if (Array.isArray(invoice?.items)) {
    lineItems = invoice.items;
  } else {
    lineItems = parseInvoiceItems(itemsRaw);
  }

  let dutiesAndTaxes: any[] = [];
  if (Array.isArray(invoice?.duties_and_taxes)) {
    dutiesAndTaxes = invoice.duties_and_taxes;
  } else if (Array.isArray(itemsRaw?.duties_and_taxes)) {
    dutiesAndTaxes = itemsRaw.duties_and_taxes;
  } else if (Array.isArray(invoice?.items?.duties_and_taxes)) {
    dutiesAndTaxes = invoice.items.duties_and_taxes;
  }

  const payment = itemsRaw?.payment_details || invoice?.payment_details || {};

  const isConnectedToRd = Boolean(partnerInfo && partnerInfo.gstin && partnerInfo.gstin.trim().length > 0);
  const companyName = isConnectedToRd ? partnerInfo.name : (company?.name || 'JAGRUTI');
  const companyAddress = isConnectedToRd ? (partnerInfo.address || company?.address || '') : (company?.address || '');
  const companyPhone = company?.phone || partnerInfo?.phone || '';
  const companyGstin = isConnectedToRd ? partnerInfo.gstin : (company?.gstin || '');
  const hasGstin = Boolean(companyGstin && companyGstin.trim().length > 0 && companyGstin.toUpperCase() !== 'URD');

  const customerName = invoice.customer_name || invoice.vendor_name || customer?.name || 'KARAN';
  const customerAddress = customer?.address || '';
  const customerPhone = customer?.phone || '';
  const customerGstin = customer?.gstin || '';
  const customerState = customer?.state || '';
  const customerCountry = customer?.country || 'India';
  const customerStateCountry = [customerState, customerCountry].filter(Boolean).join(', ') || 'India';

  const shipToName = customerName;
  const shipToAddress = customer?.shipping_address || customerAddress;

  const invoiceNo = invoice.invoice_number || invoice.bill_number || '';
  const invoiceDate = invoice.date ? formatInvoiceDate(invoice.date) : '';
  const poNumber = payment?.po_number || invoice.po_number || itemsRaw?.po_number || '';
  const docTitle = itemsRaw?.is_delivery_challan || invoice?.is_delivery_challan ? 'Delivery Challan' : (hasGstin ? 'Tax Invoice' : 'Bill of Supply');

  const gstType = itemsRaw?.gst_type || invoice.gst_type || 'Intra-State';
  const isInterState = gstType === 'Inter-State' || gstType === 'IGST';

  let totalQty = 0;
  let totalAmount = 0;
  let totalCgst = 0;
  let totalSgst = 0;
  let totalIgst = 0;
  let totalSubtotal = 0;

  const calculatedItems = lineItems.map((item: any) => {
    const qty = parseFloat(item.qty !== undefined ? item.qty : (item.quantity !== undefined ? item.quantity : 0)) || 0;
    const rate = parseFloat(item.rate !== undefined ? item.rate : 0) || 0;
    const taxRate = hasGstin ? (parseFloat(item.tax !== undefined ? item.tax : (item.tax_rate !== undefined ? item.tax_rate : (item.gst || 0))) || 0) : 0;
    const amount = parseFloat(item.amount !== undefined ? item.amount : (item.taxableAmount !== undefined ? item.taxableAmount : 0)) || (qty * rate);

    let cgst = 0;
    let sgst = 0;
    let igst = 0;

    if (item.cgst !== undefined) {
      cgst = parseFloat(item.cgst) || 0;
    }
    if (item.sgst !== undefined) {
      sgst = parseFloat(item.sgst) || 0;
    }
    if (item.igst !== undefined) {
      igst = parseFloat(item.igst) || 0;
    }

    if (hasGstin && item.cgst === undefined && item.sgst === undefined && item.igst === undefined) {
      if (isInterState) {
        igst = amount * (taxRate / 100);
      } else {
        cgst = amount * (taxRate / 2 / 100);
        sgst = amount * (taxRate / 2 / 100);
      }
    }

    const subtotal = item.total !== undefined
      ? parseFloat(item.total)
      : (item.itemTotal !== undefined
        ? parseFloat(item.itemTotal)
        : (amount + (isInterState ? igst : (cgst + sgst))));

    totalQty += qty;
    totalAmount += amount;
    totalCgst += cgst;
    totalSgst += sgst;
    totalIgst += igst;
    totalSubtotal += subtotal;

    return {
      name: item.particulars || item.itemName || item.name || '',
      hsn: item.hsn || item.hsnCode || '',
      qty,
      rate,
      amount,
      taxRate,
      cgst,
      sgst,
      igst,
      subtotal
    };
  });

  const appliedCharges = dutiesAndTaxes.filter((d: any) => {
    const amt = parseFloat(d.amount) || 0;
    return amt !== 0 && !['CGST', 'SGST', 'IGST'].includes((d.name || '').toUpperCase());
  });

  const sumAdditionalCharges = appliedCharges.reduce((acc: number, d: any) => {
    const amt = parseFloat(d.amount) || 0;
    return acc + (d.type === 'Deduction' ? -Math.abs(amt) : amt);
  }, 0);

  const taxableVal = invoice.total_without_gst !== undefined ? parseFloat(invoice.total_without_gst) : totalAmount;
  const gstVal = hasGstin ? (invoice.total_gst !== undefined ? parseFloat(invoice.total_gst) : (isInterState ? totalIgst : (totalCgst + totalSgst))) : 0;
  const grandTotalVal = invoice.grand_total !== undefined && hasGstin ? parseFloat(invoice.grand_total) : (taxableVal + gstVal + sumAdditionalCharges);

  const bankName = payment?.bank_name || company?.bank_name || company?.raw_data?.bank_name || '';
  const bankHolder = payment?.account_holder || company?.account_holder || company?.account_name || company?.raw_data?.account_holder || '';
  const bankAccount = payment?.account_number || company?.account_number || company?.raw_data?.account_number || '';
  const bankIfsc = payment?.ifsc || company?.ifsc_code || company?.ifsc || company?.raw_data?.ifsc || '';

  const blankRowsNeeded = Math.max(0, 8 - calculatedItems.length);

  const handlePrint = () => {
    // Print feature disabled: not available on this device
  };

  return (
    <div className="invoice-print-backdrop fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-sm animate-fadeIn print:p-0 print:bg-white print:static print:inset-auto print:z-auto">
      <style dangerouslySetInnerHTML={{ __html: `
        @page {
          size: A4 portrait;
          margin: 0;
        }

        @media print {
          html, body {
            width: 210mm !important;
            height: 297mm !important;
            background: #ffffff !important;
            color: #000000 !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: hidden !important;
          }

          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            color-adjust: exact !important;
          }

          header, nav, aside, footer, .sidebar, .liquid-glass-header, .print-modal-header, .print\\:hidden, .toolbar, .no-print {
            display: none !important;
          }

          .invoice-print-backdrop {
            position: static !important;
            background: transparent !important;
            padding: 0 !important;
            margin: 0 !important;
            inset: auto !important;
            z-index: auto !important;
            overflow: visible !important;
            display: block !important;
            height: auto !important;
            max-height: none !important;
          }

          .invoice-print-container {
            position: static !important;
            border: none !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            max-height: none !important;
            height: auto !important;
            overflow: visible !important;
            background: transparent !important;
            width: 210mm !important;
            max-width: 210mm !important;
          }

          .invoice-print-scroll {
            overflow: visible !important;
            padding: 0 !important;
            margin: 0 !important;
            background: transparent !important;
            display: block !important;
          }

          .exact-a4-page {
            box-shadow: none !important;
            margin: 0 !important;
            border: none !important;
            width: 210mm !important;
            height: 297mm !important;
            min-height: 297mm !important;
            max-height: 297mm !important;
            padding: 10mm !important;
            box-sizing: border-box !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            display: flex !important;
            flex-direction: column !important;
            justify-content: space-between !important;
            overflow: hidden !important;
            background: #ffffff !important;
          }

          tr {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
        }

        /* Screen & Print Container Styles with Enhanced Readable Font Sizes */
        .exact-a4-page {
          width: 210mm;
          min-height: 297mm;
          height: 297mm;
          padding: 10mm;
          background: #ffffff;
          box-sizing: border-box;
          position: relative;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          font-size: 12.5px;
          line-height: 1.4;
          color: #1e293b;
        }

        .exact-a4-page .header-grid {
          display: table;
          width: 100%;
          border-bottom: 1px solid #e2e8f0;
          padding-bottom: 14px;
          margin-bottom: 14px;
        }

        .exact-a4-page .header-col-left {
          display: table-cell;
          width: 50%;
          vertical-align: top;
          padding-right: 16px;
        }

        .exact-a4-page .header-col-right {
          display: table-cell;
          width: 50%;
          vertical-align: top;
          padding-left: 20px;
          border-left: 1px solid #e2e8f0;
        }

        .exact-a4-page .company-title {
          font-size: 22px;
          font-weight: 800;
          color: #D32F2F;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 8px;
          line-height: 1.15;
        }

        .exact-a4-page .doc-title {
          font-size: 22px;
          font-weight: 800;
          color: #0f172a;
          letter-spacing: -0.2px;
          margin-bottom: 8px;
          line-height: 1.15;
        }

        .exact-a4-page .info-table {
          width: 100%;
          border-collapse: collapse;
        }

        .exact-a4-page .info-table td {
          padding: 3px 0;
          font-size: 12px;
          vertical-align: top;
        }

        .exact-a4-page .info-label {
          color: #64748b;
          font-weight: 400;
          width: 38%;
        }

        .exact-a4-page .info-value {
          color: #0f172a;
          font-weight: 500;
          text-align: right;
        }

        .exact-a4-page .info-value.bold {
          font-weight: 700;
          font-family: 'Roboto Mono', ui-monospace, monospace;
        }

        .exact-a4-page .party-card {
          border: 1px solid #D5E0EB;
          margin-bottom: 14px;
          background: #ffffff;
        }

        .exact-a4-page .party-card-header {
          display: table;
          width: 100%;
          background-color: #F4F8FA;
          border-bottom: 1px solid #D5E0EB;
        }

        .exact-a4-page .party-card-cell-header {
          display: table-cell;
          width: 50%;
          padding: 7px 12px;
          vertical-align: middle;
        }

        .exact-a4-page .party-card-cell-header:first-child {
          border-right: 1px solid #D5E0EB;
        }

        .exact-a4-page .party-card-header-inner {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .exact-a4-page .party-tag {
          color: #64748b;
          font-size: 11.5px;
        }

        .exact-a4-page .party-name {
          font-weight: 700;
          color: #0f172a;
          text-transform: uppercase;
          font-size: 12.5px;
        }

        .exact-a4-page .party-card-body {
          display: table;
          width: 100%;
        }

        .exact-a4-page .party-card-cell-body {
          display: table-cell;
          width: 50%;
          padding: 10px 12px;
          vertical-align: top;
        }

        .exact-a4-page .party-card-cell-body:first-child {
          border-right: 1px solid #D5E0EB;
        }

        .exact-a4-page .items-container {
          width: 100%;
          margin-bottom: 12px;
        }

        .exact-a4-page .items-table {
          width: 100%;
          table-layout: fixed;
          border-collapse: collapse;
        }

        .exact-a4-page .items-table th {
          background-color: #D32F2F !important;
          color: #ffffff !important;
          font-weight: 600;
          font-size: 11.5px;
          text-transform: uppercase;
          padding: 8px 6px;
          letter-spacing: 0.3px;
          border: none;
        }

        .exact-a4-page .items-table td {
          padding: 7px 6px;
          font-size: 12px;
          color: #1e293b;
          vertical-align: middle;
          border-bottom: 1px solid #f1f5f9;
        }

        .exact-a4-page .col-sr        { width: 5%;  text-align: center; }
        .exact-a4-page .col-desc      { width: 27%; text-align: left; }
        .exact-a4-page .col-hsn       { width: 9%;  text-align: center; font-family: monospace; }
        .exact-a4-page .col-qty       { width: 7%;  text-align: center; font-family: monospace; }
        .exact-a4-page .col-rate      { width: 9%;  text-align: right;  font-family: monospace; }
        .exact-a4-page .col-amt       { width: 11%; text-align: right;  font-family: monospace; }
        .exact-a4-page .col-tax       { width: 7%;  text-align: center; font-family: monospace; }
        .exact-a4-page .col-cgst      { width: 8%;  text-align: right;  font-family: monospace; }
        .exact-a4-page .col-sgst      { width: 8%;  text-align: right;  font-family: monospace; }
        .exact-a4-page .col-subtotal  { width: 9%;  text-align: right;  font-family: monospace; }

        .exact-a4-page .items-table tbody tr.empty-row td {
          border-bottom: 1px solid #f8fafc;
          height: 24px;
        }

        .exact-a4-page .items-table tfoot tr {
          background-color: #EBF3FA !important;
          border-top: 1px solid #D5E0EB;
          border-bottom: 1px solid #D5E0EB;
          font-weight: 700;
          color: #0f172a;
        }

        .exact-a4-page .items-table tfoot td {
          padding: 8px 6px;
          font-size: 12px;
          font-weight: 700;
          color: #0f172a;
          border: none;
        }

        .exact-a4-page .calc-section {
          display: table;
          width: 100%;
          margin-bottom: 12px;
        }

        .exact-a4-page .calc-left {
          display: table-cell;
          width: 50%;
          vertical-align: top;
          padding-right: 18px;
        }

        .exact-a4-page .calc-right {
          display: table-cell;
          width: 50%;
          vertical-align: top;
          padding-left: 18px;
        }

        .exact-a4-page .section-label-italic {
          font-size: 11.5px;
          font-style: italic;
          color: #64748b;
          margin-bottom: 4px;
        }

        .exact-a4-page .section-divider-line {
          border-bottom: 1px solid #cbd5e1;
          margin-bottom: 6px;
        }

        .exact-a4-page .words-container {
          font-size: 12px;
          font-weight: 700;
          color: #0f172a;
          line-height: 1.45;
        }

        .exact-a4-page .calc-table {
          width: 100%;
          border-collapse: collapse;
        }

        .exact-a4-page .calc-table td {
          padding: 3.5px 0;
          font-size: 12px;
        }

        .exact-a4-page .calc-table .label {
          color: #475569;
          font-weight: 500;
        }

        .exact-a4-page .calc-table .val {
          text-align: right;
          font-weight: 600;
          font-family: 'Roboto Mono', ui-monospace, monospace;
          color: #0f172a;
        }

        .exact-a4-page .grand-total-banner {
          background-color: #EBF3FA !important;
          border: 1px solid #D5E0EB;
          padding: 8px 12px;
          margin-top: 8px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-weight: 700;
          font-size: 13.5px;
          color: #0f172a;
        }

        .exact-a4-page .grand-total-amount {
          font-size: 14.5px;
          font-weight: 800;
          font-family: 'Roboto Mono', ui-monospace, monospace;
        }

        .exact-a4-page .footer-section {
          display: table;
          width: 100%;
          border-top: 1px solid #e2e8f0;
          padding-top: 12px;
          margin-top: auto;
        }

        .exact-a4-page .footer-left {
          display: table-cell;
          width: 50%;
          vertical-align: top;
          padding-right: 18px;
        }

        .exact-a4-page .footer-right {
          display: table-cell;
          width: 50%;
          vertical-align: bottom;
          text-align: right;
          padding-left: 18px;
        }

        .exact-a4-page .signatory-box {
          display: inline-block;
          text-align: center;
          width: 200px;
        }

        .exact-a4-page .signatory-company {
          font-size: 11.5px;
          font-style: italic;
          color: #64748b;
          margin-bottom: 38px;
          text-align: right;
        }

        .exact-a4-page .signatory-line {
          border-bottom: 1px solid #cbd5e1;
          margin-bottom: 4px;
        }

        .exact-a4-page .signatory-text {
          font-size: 11.5px;
          font-style: italic;
          color: #64748b;
        }
      `}} />

      <div className="invoice-print-container w-full max-w-[950px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[96vh] print:max-h-none print:border-none print:shadow-none print:rounded-none">
        
        <div className="print-modal-header flex items-center justify-between px-6 py-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shrink-0 print:hidden">
          <div className="flex-1" />
          
          <div className="flex items-center gap-4">
            <span className="text-base font-semibold text-slate-800 dark:text-slate-100">Print Preview</span>
            <div className="relative group inline-flex items-center">
              <button
                type="button"
                disabled
                className="flex items-center gap-2 bg-[#D32F2F]/70 text-white px-5 py-2 rounded-md font-semibold text-sm cursor-not-allowed shadow-none select-none transition-all"
                title="Print feature is currently not available in this device"
              >
                <span>Print Invoice</span>
                <Printer className="w-4 h-4" />
              </button>
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-slate-900/95 text-white text-xs font-normal rounded-md shadow-xl whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-50 border border-slate-700">
                Print feature is currently not available in this device
                <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-900/95" />
              </div>
            </div>
          </div>

          <div className="flex-1 flex justify-end">
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              title="Close Preview"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="invoice-print-scroll flex-1 overflow-y-auto p-4 sm:p-8 bg-slate-100/80 dark:bg-slate-950 flex justify-center print:p-0 print:bg-white print:overflow-visible">
          <div
            ref={invoiceRef}
            className="exact-a4-page shadow-lg print:shadow-none"
          >
            <div>
              <div className="header-grid">
                <div className="header-col-left">
                  <div className="company-title">{companyName}</div>
                  <table className="info-table">
                    <tbody>
                      <tr>
                        <td className="info-label">Phone</td>
                        <td className="info-value">{companyPhone || '—'}</td>
                      </tr>
                      <tr>
                        <td className="info-label">GSTIN</td>
                        <td className="info-value bold">{companyGstin || 'URD'}</td>
                      </tr>
                      <tr>
                        <td className="info-label">Address</td>
                        <td className="info-value">{companyAddress || '—'}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="header-col-right">
                  <div className="doc-title">{docTitle}</div>
                  <table className="info-table">
                    <tbody>
                      <tr>
                        <td className="info-label">Invoice Number</td>
                        <td className="info-value bold">{invoiceNo || '—'}</td>
                      </tr>
                      <tr>
                        <td className="info-label">Invoice Date</td>
                        <td className="info-value bold">{invoiceDate || '—'}</td>
                      </tr>
                      <tr>
                        <td className="info-label">Purchase Order Number</td>
                        <td className="info-value bold">{poNumber || '—'}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="party-card">
                <div className="party-card-header">
                  <div className="party-card-cell-header">
                    <div className="party-card-header-inner">
                      <span className="party-tag">Billed to</span>
                      <span className="party-name">{customerName}</span>
                    </div>
                  </div>
                  <div className="party-card-cell-header">
                    <div className="party-card-header-inner">
                      <span className="party-tag">Shipped to</span>
                      <span className="party-name">{shipToName}</span>
                    </div>
                  </div>
                </div>

                <div className="party-card-body">
                  <div className="party-card-cell-body">
                    <table className="info-table">
                      <tbody>
                        <tr>
                          <td className="info-label">GSTIN</td>
                          <td className="info-value bold">{customerGstin || '—'}</td>
                        </tr>
                        <tr>
                          <td className="info-label">Phone</td>
                          <td className="info-value">{customerPhone || '—'}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div className="party-card-cell-body">
                    <table className="info-table">
                      <tbody>
                        <tr>
                          <td className="info-label">Address</td>
                          <td className="info-value">{shipToAddress || '—'}</td>
                        </tr>
                        <tr>
                          <td className="info-label">State & Country</td>
                          <td className="info-value bold">{customerStateCountry}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="items-container">
                <table className="items-table">
                  <thead>
                    <tr>
                      <th className="col-sr">Sr</th>
                      <th className="col-desc">Particulars</th>
                      <th className="col-hsn">HSN</th>
                      <th className="col-qty">QTY</th>
                      <th className="col-rate">Rate</th>
                      <th className="col-amt">Amount</th>
                      {hasGstin ? (
                        <>
                          <th className="col-tax">Tax %</th>
                          <th className="col-cgst">{isInterState ? 'IGST' : 'CGST'}</th>
                          <th className="col-sgst">{isInterState ? '—' : 'SGST'}</th>
                        </>
                      ) : (
                        <>
                          <th className="col-tax">—</th>
                          <th className="col-cgst">—</th>
                          <th className="col-sgst">—</th>
                        </>
                      )}
                      <th className="col-subtotal">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calculatedItems.map((item: any, idx: number) => (
                      <tr key={`item-${idx}`}>
                        <td className="col-sr">{idx + 1}</td>
                        <td className="col-desc" style={{ fontWeight: 700 }}>{item.name}</td>
                        <td className="col-hsn">{item.hsn || '—'}</td>
                        <td className="col-qty">{item.qty}</td>
                        <td className="col-rate">{item.rate.toFixed(2)}</td>
                        <td className="col-amt">{item.amount.toFixed(2)}</td>
                        {hasGstin ? (
                          <>
                            <td className="col-tax">{item.taxRate}%</td>
                            <td className="col-cgst">{isInterState ? item.igst.toFixed(2) : item.cgst.toFixed(2)}</td>
                            <td className="col-sgst">{isInterState ? '—' : item.sgst.toFixed(2)}</td>
                          </>
                        ) : (
                          <>
                            <td className="col-tax">—</td>
                            <td className="col-cgst">—</td>
                            <td className="col-sgst">—</td>
                          </>
                        )}
                        <td className="col-subtotal" style={{ fontWeight: 700 }}>{item.subtotal.toFixed(2)}</td>
                      </tr>
                    ))}
                    {Array.from({ length: blankRowsNeeded }).map((_, idx) => (
                      <tr key={`blank-${idx}`} className="empty-row">
                        <td colSpan={10}>&nbsp;</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className="col-sr"></td>
                      <td className="col-desc" style={{ fontWeight: 700 }}>Total</td>
                      <td className="col-hsn"></td>
                      <td className="col-qty">{totalQty}</td>
                      <td className="col-rate"></td>
                      <td className="col-amt">{totalAmount.toFixed(2)}</td>
                      {hasGstin ? (
                        <>
                          <td className="col-tax"></td>
                          <td className="col-cgst">{isInterState ? totalIgst.toFixed(2) : totalCgst.toFixed(2)}</td>
                          <td className="col-sgst">{isInterState ? '—' : totalSgst.toFixed(2)}</td>
                        </>
                      ) : (
                        <>
                          <td className="col-tax"></td>
                          <td className="col-cgst"></td>
                          <td className="col-sgst"></td>
                        </>
                      )}
                      <td className="col-subtotal">{totalSubtotal.toFixed(2)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="calc-section">
                <div className="calc-left">
                  <div className="section-label-italic">Grand Total in words</div>
                  <div className="section-divider-line"></div>
                  <div className="words-container">
                    {numberToWords(grandTotalVal)}
                  </div>
                </div>

                <div className="calc-right">
                  <table className="calc-table">
                    <tbody>
                      <tr>
                        <td className="label">Taxable Amount</td>
                        <td className="val">{taxableVal.toFixed(2)}</td>
                      </tr>
                      {hasGstin && (
                        <tr>
                          <td className="label">GST Amount</td>
                          <td className="val">{gstVal.toFixed(2)}</td>
                        </tr>
                      )}
                      {appliedCharges.map((ch: any, idx: number) => (
                        <tr key={idx}>
                          <td className="label">{ch.name}</td>
                          <td className="val">
                            {ch.type === 'Deduction' ? `-${Math.abs(ch.amount).toFixed(2)}` : parseFloat(ch.amount || 0).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="grand-total-banner">
                    <span>Grand Total</span>
                    <span className="grand-total-amount">{grandTotalVal.toFixed(2)}</span>
                  </div>
                </div>
              </div>

            </div>

            <div className="footer-section">
              <div className="footer-left">
                <div className="section-label-italic">Bank Details</div>
                <div className="section-divider-line"></div>
                <table className="info-table">
                  <tbody>
                    <tr>
                      <td className="info-label">Bank</td>
                      <td className="info-value">{bankName || '—'}</td>
                    </tr>
                    <tr>
                      <td className="info-label">A/c Holder</td>
                      <td className="info-value">{bankHolder || companyName || '—'}</td>
                    </tr>
                    <tr>
                      <td className="info-label">A/c Number</td>
                      <td className="info-value bold">{bankAccount || '—'}</td>
                    </tr>
                    <tr>
                      <td className="info-label">IFSC Code</td>
                      <td className="info-value bold">{bankIfsc || '—'}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="footer-right">
                <div className="signatory-company">for {companyName}</div>
                <div className="signatory-box">
                  <div className="signatory-line"></div>
                  <div className="signatory-text">Authorized Signatory</div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
};

export default InvoicePrintModal;