import {
  formatPoishaExact,
  safeHexColor,
  type InvoiceQuoteItem,
  type InvoiceStudioProjection,
} from '../bookings/invoice-pdf.js';

export interface QuoteProposalPdfData {
  studio: InvoiceStudioProjection;
  quote: {
    id: string;
    reference: string;
    status: string;
    eventTitle: string;
    eventTypeName: string | null;
    requestedDate: Date | string | null;
    clientName: string;
    clientPhone: string;
    clientEmail: string | null;
    currency: string;
    createdAt: Date | string;
  };
  version: {
    versionNumber: number;
    status: string;
    subtotalPoisha: number;
    discountPoisha: number;
    totalPoisha: number;
    terms: string | null;
    validUntil: Date | string | null;
    createdAt: Date | string;
    items: InvoiceQuoteItem[];
  };
  generatedAt: string;
}

function formatDateTz(
  value: Date | string | null | undefined,
  timezone: string,
): string {
  if (!value) return 'TBD';
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'TBD';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone || 'UTC',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    }).format(parsed);
  } catch {
    return parsed.toISOString().slice(0, 10);
  }
}

/**
 * Generates an A4 PDF Price Quote / Estimate Invoice suitable for sending to a client prior to booking.
 */
export async function buildQuoteProposalPdf(data: QuoteProposalPdfData): Promise<Buffer> {
  const { default: PDFDocument } = await import('pdfkit');
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 44,
      info: {
        Title: `Quote ${data.quote.reference} v${data.version.versionNumber} - ${data.quote.eventTitle}`,
        Author: data.studio.displayName,
        Subject: 'Event Price Quote & Estimate Invoice',
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const primaryColor = safeHexColor(data.studio.themeTokens?.primaryColor, '#0F172A');
    const accentColor = safeHexColor(data.studio.themeTokens?.accentColor, '#4F46E5');
    const inkColor = '#0F172A';
    const mutedColor = '#475569';
    const borderColor = '#CBD5E1';
    const softFill = '#F8FAFC';

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const margin = 44;
    const contentWidth = pageWidth - margin * 2;
    const tz = data.studio.timezone || 'UTC';
    const currency = data.quote.currency || data.studio.currency || 'BDT';

    const ensureSpace = (neededHeight: number) => {
      if (doc.y + neededHeight > pageHeight - margin) {
        doc.addPage();
      }
    };

    // Top Accent Bar
    doc.rect(0, 0, pageWidth, 8).fill(accentColor);

    // Header Row
    const headerTop = 28;
    doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(20);
    doc.text(data.studio.displayName, margin, headerTop, { width: 280 });

    let leftY = doc.y + 4;
    const contactLines: string[] = [];
    if (data.studio.contactDetails?.phone) contactLines.push(`Phone: ${data.studio.contactDetails.phone}`);
    if (data.studio.contactDetails?.email) contactLines.push(`Email: ${data.studio.contactDetails.email}`);
    if (data.studio.contactDetails?.address) contactLines.push(data.studio.contactDetails.address);
    if (data.studio.contactDetails?.website) contactLines.push(data.studio.contactDetails.website);

    if (contactLines.length > 0) {
      doc.fillColor(mutedColor).font('Helvetica').fontSize(8.5);
      doc.text(contactLines.join('\n'), margin, leftY, { width: 270, lineGap: 2 });
      leftY = doc.y;
    }

    // Right Header Block (QUOTE / ESTIMATE INVOICE)
    const rightColX = pageWidth - margin - 210;
    doc.fillColor(accentColor).font('Helvetica-Bold').fontSize(15);
    doc.text('PRICE QUOTE / INVOICE', rightColX, headerTop, { width: 210, align: 'right' });

    doc.fillColor(inkColor).font('Helvetica-Bold').fontSize(10);
    doc.text(
      `Quote Ref: ${data.quote.reference} (v${data.version.versionNumber})`,
      rightColX,
      headerTop + 22,
      { width: 210, align: 'right' },
    );

    doc.fillColor(mutedColor).font('Helvetica').fontSize(8.5);
    const metaRight = [
      `Status: ${data.quote.status.replace(/_/g, ' ')}`,
      `Issued: ${formatDateTz(data.generatedAt, tz)}`,
      ...(data.version.validUntil
        ? [`Valid Until: ${formatDateTz(data.version.validUntil, tz)}`]
        : []),
    ].join('\n');
    doc.text(metaRight, rightColX, headerTop + 38, {
      width: 210,
      align: 'right',
      lineGap: 2,
    });
    const rightY = doc.y;

    const afterHeaderY = Math.max(leftY, rightY) + 14;
    doc
      .moveTo(margin, afterHeaderY)
      .lineTo(pageWidth - margin, afterHeaderY)
      .lineWidth(1)
      .strokeColor(borderColor)
      .stroke();
    doc.y = afterHeaderY + 14;

    // Client & Event Summary Cards
    const boxGap = 14;
    const boxWidth = (contentWidth - boxGap) / 2;
    const boxTop = doc.y;

    const clientLines = [
      data.quote.clientName,
      `Phone: ${data.quote.clientPhone}`,
      ...(data.quote.clientEmail ? [`Email: ${data.quote.clientEmail}`] : []),
    ];
    const eventLines = [
      data.quote.eventTitle,
      `Requested Date: ${formatDateTz(data.quote.requestedDate, tz)}`,
      ...(data.quote.eventTypeName ? [`Category: ${data.quote.eventTypeName}`] : []),
    ];

    doc.font('Helvetica').fontSize(9);
    const leftTextHeight = doc.heightOfString(clientLines.join('\n'), {
      width: boxWidth - 20,
      lineGap: 2,
    });
    const rightTextHeight = doc.heightOfString(eventLines.join('\n'), {
      width: boxWidth - 20,
      lineGap: 2,
    });
    const boxHeight = Math.max(70, Math.max(leftTextHeight, rightTextHeight) + 36);

    doc.roundedRect(margin, boxTop, boxWidth, boxHeight, 6).fillAndStroke(softFill, borderColor);
    doc
      .roundedRect(margin + boxWidth + boxGap, boxTop, boxWidth, boxHeight, 6)
      .fillAndStroke(softFill, borderColor);

    doc.fillColor(mutedColor).font('Helvetica-Bold').fontSize(8);
    doc.text('PREPARED FOR', margin + 10, boxTop + 10);
    doc.text('EVENT DETAILS', margin + boxWidth + boxGap + 10, boxTop + 10);

    doc.fillColor(inkColor).font('Helvetica-Bold').fontSize(10);
    doc.text(clientLines[0], margin + 10, boxTop + 23, { width: boxWidth - 20 });
    const cNameBottom = doc.y;
    doc.text(eventLines[0], margin + boxWidth + boxGap + 10, boxTop + 23, {
      width: boxWidth - 20,
    });
    const eNameBottom = doc.y;

    doc.fillColor(mutedColor).font('Helvetica').fontSize(8.5);
    if (clientLines.length > 1) {
      doc.text(clientLines.slice(1).join('\n'), margin + 10, cNameBottom + 2, {
        width: boxWidth - 20,
        lineGap: 2,
      });
    }
    if (eventLines.length > 1) {
      doc.text(eventLines.slice(1).join('\n'), margin + boxWidth + boxGap + 10, eNameBottom + 2, {
        width: boxWidth - 20,
        lineGap: 2,
      });
    }

    doc.y = boxTop + boxHeight + 18;

    // Itemized Services Table
    ensureSpace(80);
    doc.fillColor(inkColor).font('Helvetica-Bold').fontSize(10.5);
    doc.text('ITEMIZED QUOTE & COVERAGE', margin, doc.y);
    doc.y += 6;

    const colDescW = contentWidth - 230;
    const colQtyX = margin + colDescW + 10;
    const colUnitX = colQtyX + 46;
    const colTotalX = colUnitX + 86;

    const headerY = doc.y;
    doc.rect(margin, headerY, contentWidth, 22).fill(primaryColor);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8.5);
    doc.text('Service / Deliverable', margin + 8, headerY + 7, { width: colDescW - 8 });
    doc.text('Qty', colQtyX, headerY + 7, { width: 40, align: 'right' });
    doc.text('Unit Price', colUnitX, headerY + 7, { width: 80, align: 'right' });
    doc.text('Total', colTotalX, headerY + 7, {
      width: contentWidth - (colTotalX - margin) - 8,
      align: 'right',
    });
    doc.y = headerY + 22;

    const items = data.version.items;
    items.forEach((item, index) => {
      doc.font('Helvetica').fontSize(9);
      const descHeight = doc.heightOfString(item.description, { width: colDescW - 12 });
      const rowHeight = Math.max(22, descHeight + 12);
      ensureSpace(rowHeight + 4);

      const ry = doc.y;
      if (index % 2 === 1) {
        doc.rect(margin, ry, contentWidth, rowHeight).fill(softFill);
      }

      doc.fillColor(inkColor).font('Helvetica').fontSize(9);
      doc.text(item.description, margin + 8, ry + 6, { width: colDescW - 12 });
      doc.text(String(item.quantity), colQtyX, ry + 6, { width: 40, align: 'right' });
      doc.text(formatPoishaExact(item.unitPricePoisha, currency), colUnitX, ry + 6, {
        width: 80,
        align: 'right',
      });
      doc.font('Helvetica-Bold');
      doc.text(formatPoishaExact(item.lineTotalPoisha, currency), colTotalX, ry + 6, {
        width: contentWidth - (colTotalX - margin) - 8,
        align: 'right',
      });

      doc
        .moveTo(margin, ry + rowHeight)
        .lineTo(margin + contentWidth, ry + rowHeight)
        .lineWidth(0.5)
        .strokeColor(borderColor)
        .stroke();
      doc.y = ry + rowHeight;
    });

    doc.y += 14;

    // Totals Summary Card
    const summaryW = 240;
    const summaryX = margin + contentWidth - summaryW;
    const hasDiscount = data.version.discountPoisha > 0;
    const summaryH = hasDiscount ? 82 : 62;
    ensureSpace(summaryH + 20);

    const sy = doc.y;
    doc.roundedRect(summaryX, sy, summaryW, summaryH, 6).fillAndStroke(softFill, borderColor);

    let lineY = sy + 12;
    doc.fillColor(mutedColor).font('Helvetica').fontSize(9);
    doc.text('Subtotal', summaryX + 12, lineY);
    doc.fillColor(inkColor).font('Helvetica-Bold');
    doc.text(formatPoishaExact(data.version.subtotalPoisha, currency), summaryX + 100, lineY, {
      width: summaryW - 112,
      align: 'right',
    });

    if (hasDiscount) {
      lineY += 18;
      doc.fillColor(mutedColor).font('Helvetica').fontSize(9);
      doc.text('Discount', summaryX + 12, lineY);
      doc.fillColor('#B91C1C').font('Helvetica-Bold');
      doc.text(
        `-${formatPoishaExact(data.version.discountPoisha, currency)}`,
        summaryX + 100,
        lineY,
        {
          width: summaryW - 112,
          align: 'right',
        },
      );
    }

    lineY += 18;
    doc
      .moveTo(summaryX + 10, lineY)
      .lineTo(summaryX + summaryW - 10, lineY)
      .lineWidth(0.75)
      .strokeColor(borderColor)
      .stroke();

    lineY += 8;
    doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(10.5);
    doc.text('Quote Total', summaryX + 12, lineY);
    doc.text(formatPoishaExact(data.version.totalPoisha, currency), summaryX + 100, lineY, {
      width: summaryW - 112,
      align: 'right',
    });

    doc.y = sy + summaryH + 18;

    // Terms & Payment Schedule
    if (data.version.terms) {
      doc.font('Helvetica').fontSize(9);
      const termsHeight = doc.heightOfString(data.version.terms, {
        width: contentWidth - 24,
        lineGap: 2,
      });
      const boxH = termsHeight + 34;
      ensureSpace(boxH + 14);
      const ty = doc.y;
      doc.roundedRect(margin, ty, contentWidth, boxH, 6).fillAndStroke('#FFFFFF', borderColor);
      doc.fillColor(inkColor).font('Helvetica-Bold').fontSize(8.5);
      doc.text('TERMS & PAYMENT SCHEDULE', margin + 12, ty + 10);
      doc.fillColor(mutedColor).font('Helvetica').fontSize(9);
      doc.text(data.version.terms, margin + 12, ty + 24, {
        width: contentWidth - 24,
        lineGap: 2,
      });
      doc.y = ty + boxH + 14;
    }

    // Footer Note
    ensureSpace(32);
    doc.fillColor(mutedColor).font('Helvetica').fontSize(8);
    doc.text(
      `This quotation / estimate invoice was issued by ${data.studio.displayName}. Please confirm to lock your event date and generate an official booking & payment receipt.`,
      margin,
      doc.y + 8,
      { width: contentWidth, align: 'center' },
    );

    doc.end();
  });
}
