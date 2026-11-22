import type { PublicBrandingProjection } from '../studio/studio.service.js';

export type InvoiceStudioProjection = PublicBrandingProjection & {
  tagline?: string | null;
};

export interface InvoiceQuoteItem {
  id: string;
  description: string;
  quantity: number;
  unitPricePoisha: number;
  lineTotalPoisha: number;
}

export interface InvoicePaymentRow {
  id: string;
  type: string;
  method: string;
  amountPoisha: number;
  currency: string;
  transactionRef: string | null;
  verifiedAt: Date | string | null;
  reason: string | null;
  createdAt: Date | string;
}

export interface InvoiceAdjustmentRow {
  id: string;
  type: string;
  amountPoisha: number;
  reason: string;
  createdAt: Date | string;
}

export interface BookingInvoiceReceiptData {
  studio: InvoiceStudioProjection;
  booking: {
    id: string;
    reference: string;
    status: string;
    eventTitle: string;
    eventTypeName: string | null;
    eventDate: Date | string | null;
    clientName: string;
    clientPhone: string;
    clientEmail: string | null;
    currency: string;
    agreedTotalPoisha: number;
    confirmedAt: Date | string | null;
    createdAt: Date | string;
  };
  quote: {
    reference: string;
    versionNumber: number;
    acceptedAt: Date | string | null;
    acceptedBy: string | null;
    acceptedChannel: string | null;
    terms: string | null;
    subtotalPoisha: number;
    discountPoisha: number;
    totalPoisha: number;
    items: InvoiceQuoteItem[];
  };
  ledger: {
    agreedTotalPoisha: number;
    approvedCreditNotesPoisha: number;
    effectiveAgreedChargePoisha: number;
    verifiedReceiptsPoisha: number;
    pendingReceiptsPoisha: number;
    completedRefundsPoisha: number;
    outstandingDuePoisha: number;
    customerCreditPoisha: number;
    requiredAdvancePoisha: number;
    isAdvanceMet: boolean;
  };
  payments: InvoicePaymentRow[];
  adjustments: InvoiceAdjustmentRow[];
  generatedAt: string;
}

/**
 * Formats integer poisha amounts without IEEE-754 floating-point arithmetic.
 */
export function formatPoishaExact(poisha: number, currency = 'BDT'): string {
  const value = BigInt(Math.trunc(poisha));
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / 100n;
  const frac = abs % 100n;
  const wholeFormatted = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fracFormatted = frac === 0n ? '' : `.${frac.toString().padStart(2, '0')}`;
  const sign = negative ? '-' : '';
  return `${sign}${currency} ${wholeFormatted}${fracFormatted}`;
}

/**
 * Validates theme hex colors and falls back to a neutral dark/accent palette.
 */
export function safeHexColor(candidate: string | undefined, fallback: string): string {
  if (!candidate) {
    return fallback;
  }
  const trimmed = candidate.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed : fallback;
}

function formatDateInTimezone(
  value: Date | string | null | undefined,
  timezone: string,
  includeTime = false,
): string {
  if (!value) {
    return 'TBD';
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'TBD';
  }
  const options: Intl.DateTimeFormatOptions = includeTime
    ? {
        timeZone: timezone || 'UTC',
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }
    : {
        timeZone: timezone || 'UTC',
        year: 'numeric',
        month: 'short',
        day: '2-digit',
      };
  try {
    return new Intl.DateTimeFormat('en-GB', options).format(parsed);
  } catch {
    return parsed.toISOString().slice(0, 10);
  }
}

/**
 * Generates an A4 PDF Invoice & Official Money Receipt from the server receipt projection.
 */
export async function buildBookingInvoicePdf(
  receipt: BookingInvoiceReceiptData,
): Promise<Buffer> {
  const { default: PDFDocument } = await import('pdfkit');
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 44,
      info: {
        Title: `Invoice ${receipt.booking.reference} - ${receipt.studio.displayName}`,
        Author: receipt.studio.displayName,
        Subject: `Booking Invoice & Money Receipt (${receipt.booking.reference})`,
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const primaryColor = safeHexColor(receipt.studio.themeTokens?.primaryColor, '#111827');
    const accentColor = safeHexColor(receipt.studio.themeTokens?.accentColor, '#b45309');
    const inkColor = '#111827';
    const mutedColor = '#4b5563';
    const borderColor = '#e5e7eb';
    const softBg = '#f9fafb';

    const pageWidth = doc.page.width;
    const margin = 44;
    const contentWidth = pageWidth - margin * 2;
    const tz = receipt.studio.timezone || 'Asia/Dhaka';
    const currency = receipt.booking.currency || receipt.studio.currency || 'BDT';

    const ensureSpace = (neededHeight: number) => {
      if (doc.y + neededHeight > doc.page.height - 56) {
        doc.addPage();
      }
    };

    // Top Studio Header Banner
    doc.rect(margin, margin, contentWidth, 4).fill(accentColor);

    const headerY = margin + 16;
    doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(18);
    doc.text(receipt.studio.displayName, margin, headerY, { width: 320 });

    if (receipt.studio.tagline) {
      doc.fillColor(mutedColor).font('Helvetica').fontSize(9.5);
      doc.text(receipt.studio.tagline, margin, doc.y + 2, { width: 320 });
    }

    const contactParts = [
      receipt.studio.contactDetails?.phone,
      receipt.studio.contactDetails?.email,
      receipt.studio.contactDetails?.address,
      receipt.studio.contactDetails?.website,
    ].filter((part): part is string => Boolean(part && part.trim()));

    if (contactParts.length > 0) {
      doc.fillColor(mutedColor).font('Helvetica').fontSize(8.5);
      doc.text(contactParts.join('  •  '), margin, doc.y + 4, { width: 320 });
    }
    const leftHeaderBottom = doc.y;

    // Right Invoice Title & Status Box
    doc.fillColor(inkColor).font('Helvetica-Bold').fontSize(15);
    doc.text('INVOICE & RECEIPT', margin + 320, headerY, {
      width: contentWidth - 320,
      align: 'right',
    });

    doc.fillColor(mutedColor).font('Helvetica-Bold').fontSize(9.5);
    doc.text(receipt.booking.reference, margin + 320, headerY + 20, {
      width: contentWidth - 320,
      align: 'right',
    });

    doc.fillColor(mutedColor).font('Helvetica').fontSize(8.5);
    doc.text(
      `Status: ${receipt.booking.status}   |   Generated: ${formatDateInTimezone(receipt.generatedAt, tz)}`,
      margin + 320,
      headerY + 34,
      { width: contentWidth - 320, align: 'right' },
    );

    const dividerY = Math.max(leftHeaderBottom, headerY + 52) + 12;
    doc
      .moveTo(margin, dividerY)
      .lineTo(margin + contentWidth, dividerY)
      .lineWidth(1)
      .strokeColor(borderColor)
      .stroke();

    // Two-column Client & Event / Quote Info Cards (dynamic height to prevent text overlap)
    const infoTop = dividerY + 14;
    const colGap = 16;
    const colWidth = (contentWidth - colGap) / 2;
    const innerWidth = colWidth - 24;
    const rightColX = margin + colWidth + colGap;

    const eventTypeLabel = receipt.booking.eventTypeName ?? 'Event Service';
    const eventDateLabel = formatDateInTimezone(receipt.booking.eventDate, tz);
    const eventMetaText = `${eventTypeLabel}  •  Date: ${eventDateLabel}`;
    const quoteMetaText = `Accepted Quote: ${receipt.quote.reference} (v${receipt.quote.versionNumber})`;
    const confirmedText = receipt.booking.confirmedAt
      ? `Confirmed: ${formatDateInTimezone(receipt.booking.confirmedAt, tz, true)}`
      : null;

    doc.font('Helvetica-Bold').fontSize(10.5);
    const clientNameH = doc.heightOfString(receipt.booking.clientName, { width: innerWidth });
    const eventTitleH = doc.heightOfString(receipt.booking.eventTitle, { width: innerWidth });

    doc.font('Helvetica').fontSize(9);
    const phoneH = doc.heightOfString(`Phone: ${receipt.booking.clientPhone}`, {
      width: innerWidth,
    });
    const emailH = receipt.booking.clientEmail
      ? doc.heightOfString(`Email: ${receipt.booking.clientEmail}`, { width: innerWidth })
      : 0;
    const eventMetaH = doc.heightOfString(eventMetaText, { width: innerWidth });
    const quoteMetaH = doc.heightOfString(quoteMetaText, { width: innerWidth });
    const confirmedH = confirmedText
      ? doc.heightOfString(confirmedText, { width: innerWidth })
      : 0;

    const leftBoxHeight =
      24 + clientNameH + 4 + phoneH + (emailH ? 3 + emailH : 0) + 12;
    const rightBoxHeight =
      24 + eventTitleH + 4 + eventMetaH + 3 + quoteMetaH + (confirmedH ? 3 + confirmedH : 0) + 12;
    const infoBoxHeight = Math.max(82, leftBoxHeight, rightBoxHeight);

    // Left Card: Billed To Client
    doc.roundedRect(margin, infoTop, colWidth, infoBoxHeight, 4).fillAndStroke(softBg, borderColor);
    let leftY = infoTop + 10;
    doc.fillColor(mutedColor).font('Helvetica-Bold').fontSize(8);
    doc.text('BILLED TO CLIENT', margin + 12, leftY);
    leftY += 14;
    doc.fillColor(inkColor).font('Helvetica-Bold').fontSize(10.5);
    doc.text(receipt.booking.clientName, margin + 12, leftY, { width: innerWidth });
    leftY += clientNameH + 4;
    doc.fillColor(mutedColor).font('Helvetica').fontSize(9);
    doc.text(`Phone: ${receipt.booking.clientPhone}`, margin + 12, leftY, {
      width: innerWidth,
    });
    leftY += phoneH + 3;
    if (receipt.booking.clientEmail) {
      doc.text(`Email: ${receipt.booking.clientEmail}`, margin + 12, leftY, {
        width: innerWidth,
      });
    }

    // Right Card: Event & Quote Snapshot
    doc
      .roundedRect(rightColX, infoTop, colWidth, infoBoxHeight, 4)
      .fillAndStroke(softBg, borderColor);
    let rightY = infoTop + 10;
    doc.fillColor(mutedColor).font('Helvetica-Bold').fontSize(8);
    doc.text('EVENT & QUOTE SNAPSHOT', rightColX + 12, rightY);
    rightY += 14;
    doc.fillColor(inkColor).font('Helvetica-Bold').fontSize(10.5);
    doc.text(receipt.booking.eventTitle, rightColX + 12, rightY, {
      width: innerWidth,
    });
    rightY += eventTitleH + 4;
    doc.fillColor(mutedColor).font('Helvetica').fontSize(9);
    doc.text(eventMetaText, rightColX + 12, rightY, {
      width: innerWidth,
    });
    rightY += eventMetaH + 3;
    doc.text(quoteMetaText, rightColX + 12, rightY, { width: innerWidth });
    rightY += quoteMetaH + 3;
    if (confirmedText) {
      doc.text(confirmedText, rightColX + 12, rightY, { width: innerWidth });
    }

    doc.y = infoTop + infoBoxHeight + 16;

    // Line Items Table
    ensureSpace(64);
    doc.fillColor(inkColor).font('Helvetica-Bold').fontSize(10.5);
    doc.text('AGREED SERVICES & PACKAGES', margin, doc.y);
    doc.y += 6;

    const tableHeaderY = doc.y;
    const descColW = contentWidth - 210;
    const qtyColX = margin + descColW;
    const qtyColW = 45;
    const unitColX = qtyColX + qtyColW;
    const unitColW = 80;
    const totalColX = unitColX + unitColW;
    const totalColW = 85;

    doc.rect(margin, tableHeaderY, contentWidth, 22).fill(primaryColor);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8.5);
    doc.text('Description', margin + 8, tableHeaderY + 7, { width: descColW - 12 });
    doc.text('Qty', qtyColX, tableHeaderY + 7, { width: qtyColW - 6, align: 'right' });
    doc.text('Unit Price', unitColX, tableHeaderY + 7, { width: unitColW - 8, align: 'right' });
    doc.text('Line Total', totalColX, tableHeaderY + 7, { width: totalColW - 8, align: 'right' });
    doc.y = tableHeaderY + 22;

    for (let idx = 0; idx < receipt.quote.items.length; idx += 1) {
      const item = receipt.quote.items[idx];
      const textHeight = doc
        .font('Helvetica')
        .fontSize(9)
        .heightOfString(item.description, { width: descColW - 16 });
      const rowHeight = Math.max(22, textHeight + 12);

      ensureSpace(rowHeight + 4);
      const rowY = doc.y;

      if (idx % 2 === 1) {
        doc.rect(margin, rowY, contentWidth, rowHeight).fill(softBg);
      }

      doc.fillColor(inkColor).font('Helvetica').fontSize(9);
      doc.text(item.description, margin + 8, rowY + 6, { width: descColW - 16 });
      doc.text(String(item.quantity), qtyColX, rowY + 6, { width: qtyColW - 6, align: 'right' });
      doc.text(formatPoishaExact(item.unitPricePoisha, currency), unitColX, rowY + 6, {
        width: unitColW - 8,
        align: 'right',
      });
      doc.font('Helvetica-Bold');
      doc.text(formatPoishaExact(item.lineTotalPoisha, currency), totalColX, rowY + 6, {
        width: totalColW - 8,
        align: 'right',
      });

      doc
        .moveTo(margin, rowY + rowHeight)
        .lineTo(margin + contentWidth, rowY + rowHeight)
        .lineWidth(0.5)
        .strokeColor(borderColor)
        .stroke();

      doc.y = rowY + rowHeight;
    }

    doc.y += 14;

    // Summary Totals & Advance Policy Box (Right-aligned) + Accepted Metadata (Left)
    ensureSpace(140);
    const summaryStartY = doc.y;
    const summaryBoxW = 240;
    const summaryBoxX = margin + contentWidth - summaryBoxW;
    const leftMetaW = contentWidth - summaryBoxW - 20;

    // Left Column: Acceptance + Terms
    doc.fillColor(inkColor).font('Helvetica-Bold').fontSize(9.5);
    doc.text('QUOTE ACCEPTANCE & POLICY', margin, summaryStartY, { width: leftMetaW });
    doc.fillColor(mutedColor).font('Helvetica').fontSize(8.5);
    doc.text(
      `Accepted by ${receipt.quote.acceptedBy ?? receipt.booking.clientName} via ${receipt.quote.acceptedChannel ?? 'STUDIO'} on ${formatDateInTimezone(receipt.quote.acceptedAt, tz, true)}`,
      margin,
      doc.y + 4,
      { width: leftMetaW },
    );

    const advanceStatusText = receipt.ledger.isAdvanceMet
      ? `Advance Requirement Met (Required: ${formatPoishaExact(receipt.ledger.requiredAdvancePoisha, currency)})`
      : `Advance Pending (Required: ${formatPoishaExact(receipt.ledger.requiredAdvancePoisha, currency)})`;
    doc.fillColor(receipt.ledger.isAdvanceMet ? '#047857' : accentColor).font('Helvetica-Bold').fontSize(8.5);
    doc.text(advanceStatusText, margin, doc.y + 6, { width: leftMetaW });

    if (receipt.quote.terms) {
      doc.fillColor(mutedColor).font('Helvetica-Bold').fontSize(8);
      doc.text('TERMS & CONDITIONS', margin, doc.y + 10, { width: leftMetaW });
      doc.fillColor(mutedColor).font('Helvetica').fontSize(8);
      doc.text(receipt.quote.terms, margin, doc.y + 2, { width: leftMetaW });
    }
    const leftMetaBottom = doc.y;

    // Right Column: Exact Integer Poisha Totals
    const summaryRows: Array<{ label: string; value: string; bold?: boolean; highlight?: string }> = [
      { label: 'Quote Subtotal', value: formatPoishaExact(receipt.quote.subtotalPoisha, currency) },
    ];
    if (receipt.quote.discountPoisha > 0) {
      summaryRows.push({
        label: 'Quote Discount',
        value: `- ${formatPoishaExact(receipt.quote.discountPoisha, currency)}`,
      });
    }
    if (receipt.ledger.approvedCreditNotesPoisha > 0) {
      summaryRows.push({
        label: 'Approved Credit Notes',
        value: `- ${formatPoishaExact(receipt.ledger.approvedCreditNotesPoisha, currency)}`,
      });
    }
    summaryRows.push({
      label: 'Effective Agreed Charge',
      value: formatPoishaExact(receipt.ledger.effectiveAgreedChargePoisha, currency),
      bold: true,
    });
    summaryRows.push({
      label: 'Verified Receipts',
      value: `- ${formatPoishaExact(receipt.ledger.verifiedReceiptsPoisha, currency)}`,
    });
    if (receipt.ledger.completedRefundsPoisha > 0) {
      summaryRows.push({
        label: 'Completed Refunds',
        value: `+ ${formatPoishaExact(receipt.ledger.completedRefundsPoisha, currency)}`,
      });
    }
    if (receipt.ledger.pendingReceiptsPoisha > 0) {
      summaryRows.push({
        label: 'Pending Verification',
        value: formatPoishaExact(receipt.ledger.pendingReceiptsPoisha, currency),
      });
    }

    const boxRowsHeight = summaryRows.length * 18 + 38;
    doc.roundedRect(summaryBoxX, summaryStartY, summaryBoxW, boxRowsHeight, 4).fillAndStroke(softBg, borderColor);

    let ry = summaryStartY + 10;
    for (const row of summaryRows) {
      doc.fillColor(row.bold ? inkColor : mutedColor).font(row.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5);
      doc.text(row.label, summaryBoxX + 10, ry, { width: 125 });
      doc.text(row.value, summaryBoxX + 135, ry, { width: 95, align: 'right' });
      ry += 18;
    }

    doc
      .moveTo(summaryBoxX + 10, ry)
      .lineTo(summaryBoxX + summaryBoxW - 10, ry)
      .lineWidth(0.8)
      .strokeColor(borderColor)
      .stroke();

    ry += 8;
    const isCredit = receipt.ledger.customerCreditPoisha > 0;
    const balanceLabel = isCredit ? 'Customer Credit' : 'Balance Due';
    const balanceValue = isCredit
      ? formatPoishaExact(receipt.ledger.customerCreditPoisha, currency)
      : formatPoishaExact(receipt.ledger.outstandingDuePoisha, currency);

    doc.fillColor(isCredit ? '#047857' : primaryColor).font('Helvetica-Bold').fontSize(10.5);
    doc.text(balanceLabel, summaryBoxX + 10, ry, { width: 115 });
    doc.text(balanceValue, summaryBoxX + 125, ry, { width: 105, align: 'right' });

    doc.y = Math.max(leftMetaBottom, summaryStartY + boxRowsHeight) + 18;

    // Payments & Refunds Ledger Table (if any)
    if (receipt.payments.length > 0) {
      ensureSpace(64);
      doc.fillColor(inkColor).font('Helvetica-Bold').fontSize(10.5);
      doc.text('PAYMENT & REFUND LEDGER', margin, doc.y);
      doc.y += 6;

      const payHeaderY = doc.y;
      doc.rect(margin, payHeaderY, contentWidth, 20).fill('#f3f4f6');
      doc.fillColor(mutedColor).font('Helvetica-Bold').fontSize(8);
      doc.text('Recorded At', margin + 8, payHeaderY + 6, { width: 120 });
      doc.text('Type / Method', margin + 128, payHeaderY + 6, { width: 115 });
      doc.text('Reference', margin + 245, payHeaderY + 6, { width: 105 });
      doc.text('Verified At', margin + 350, payHeaderY + 6, { width: 80 });
      doc.text('Amount', margin + 430, payHeaderY + 6, { width: contentWidth - 438, align: 'right' });
      doc.y = payHeaderY + 20;

      for (const payment of receipt.payments) {
        ensureSpace(24);
        const py = doc.y;
        doc.fillColor(inkColor).font('Helvetica').fontSize(8.5);
        doc.text(formatDateInTimezone(payment.createdAt, tz, true), margin + 8, py + 6, {
          width: 120,
        });
        doc.text(`${payment.type} (${payment.method})`, margin + 128, py + 6, { width: 115 });
        doc.text(payment.transactionRef ?? '-', margin + 245, py + 6, {
          width: 105,
          ellipsis: true,
        });
        doc.text(
          payment.verifiedAt ? formatDateInTimezone(payment.verifiedAt, tz) : 'VERIFIED',
          margin + 350,
          py + 6,
          { width: 80 },
        );
        doc.font('Helvetica-Bold');
        doc.text(formatPoishaExact(payment.amountPoisha, payment.currency || currency), margin + 430, py + 6, {
          width: contentWidth - 438,
          align: 'right',
        });

        doc
          .moveTo(margin, py + 21)
          .lineTo(margin + contentWidth, py + 21)
          .lineWidth(0.5)
          .strokeColor(borderColor)
          .stroke();
        doc.y = py + 21;
      }
      doc.y += 12;
    }

    // Approved Price Adjustments / Credit Notes (if any)
    if (receipt.adjustments.length > 0) {
      ensureSpace(56);
      doc.fillColor(inkColor).font('Helvetica-Bold').fontSize(10.5);
      doc.text('PRICE ADJUSTMENTS & CREDIT NOTES', margin, doc.y);
      doc.y += 6;

      for (const adj of receipt.adjustments) {
        ensureSpace(22);
        const ay = doc.y;
        doc.fillColor(mutedColor).font('Helvetica').fontSize(8.5);
        doc.text(
          `${adj.type} (${formatDateInTimezone(adj.createdAt, tz)}): ${adj.reason}`,
          margin + 8,
          ay + 4,
          { width: contentWidth - 130 },
        );
        doc.fillColor(inkColor).font('Helvetica-Bold').fontSize(8.5);
        doc.text(formatPoishaExact(adj.amountPoisha, currency), margin + contentWidth - 120, ay + 4, {
          width: 112,
          align: 'right',
        });
        doc.y = ay + 18;
      }
      doc.y += 10;
    }

    // Footer Note
    ensureSpace(32);
    doc.fillColor(mutedColor).font('Helvetica').fontSize(8);
    doc.text(
      `This document is an official system-generated invoice and money receipt issued by ${receipt.studio.displayName}. All monetary figures reflect verified ledger entries in ${currency}.`,
      margin,
      doc.y + 8,
      { width: contentWidth, align: 'center' },
    );

    doc.end();
  });
}
