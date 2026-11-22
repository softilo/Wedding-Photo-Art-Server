import { Prisma } from '../../generated/prisma/client.js';

export interface QuoteDeliverableItemInput {
  description: string;
  quantity: number;
}

export function formatQuoteItemDeliverableLabel(description: string, quantity: number): string {
  const trimmed = description.trim();
  if (!trimmed) return '';
  if (quantity > 1 && !/^\d+\s*[x×]\s*/i.test(trimmed)) {
    return `${quantity}x ${trimmed}`;
  }
  return trimmed;
}

export function normalizeDeliverableKey(label: string): string {
  return label
    .trim()
    .replace(/^\d+\s*[x×]\s*/i, '')
    .toLowerCase();
}

function addDaysUtc(baseDate: Date, days: number): Date {
  return new Date(baseDate.getTime() + days * 86_400_000);
}

/**
 * Provisions deliverables for a booking idempotently from accepted quote items
 * first, then fills any remaining category deliverable templates without duplicating.
 */
export async function provisionDeliverablesFromQuoteAndTemplatesTx(
  tx: Prisma.TransactionClient,
  params: {
    bookingId: string;
    eventTypeId: string | null;
    eventDate: Date | null;
    quoteItems?: QuoteDeliverableItemInput[];
  },
) {
  if (
    typeof tx.deliverable?.findMany !== 'function' ||
    (typeof tx.deliverable?.create !== 'function' &&
      typeof tx.deliverable?.createManyAndReturn !== 'function')
  ) {
    return [];
  }

  const baseDate = params.eventDate ?? new Date();
  const [labelTemplates, existingDeliverables] = await Promise.all([
    typeof tx.deliverableLabel?.findMany === 'function'
      ? tx.deliverableLabel.findMany({
          where: {
            isActive: true,
            eventTypeId: params.eventTypeId ?? null,
          },
          orderBy: { defaultDueDays: 'asc' },
        })
      : Promise.resolve([]),
    tx.deliverable.findMany({
      where: { bookingId: params.bookingId },
      select: { label: true },
    }),
  ]);

  const seenExact = new Set<string>();
  const seenNormalized = new Set<string>();

  const markSeen = (label: string) => {
    const exact = label.trim().toLowerCase();
    const norm = normalizeDeliverableKey(label);
    if (exact) seenExact.add(exact);
    if (norm) seenNormalized.add(norm);
  };

  const hasSeen = (label: string) => {
    const exact = label.trim().toLowerCase();
    const norm = normalizeDeliverableKey(label);
    return (exact && seenExact.has(exact)) || (norm && seenNormalized.has(norm));
  };

  for (const existing of existingDeliverables) {
    markSeen(existing.label);
  }

  const templateByNormalized = new Map<string, (typeof labelTemplates)[number]>();
  for (const tpl of labelTemplates) {
    const norm = normalizeDeliverableKey(tpl.label);
    if (norm && !templateByNormalized.has(norm)) {
      templateByNormalized.set(norm, tpl);
    }
  }

  const pendingCreates: Array<{
    bookingId: string;
    label: string;
    dueAt: Date;
    notes: string;
  }> = [];

  for (const item of params.quoteItems ?? []) {
    const label = formatQuoteItemDeliverableLabel(item.description, item.quantity);
    if (!label || hasSeen(label)) {
      continue;
    }
    const matchedTemplate = templateByNormalized.get(normalizeDeliverableKey(label));
    const dueDays = matchedTemplate?.defaultDueDays ?? 14;
    pendingCreates.push({
      bookingId: params.bookingId,
      label,
      dueAt: addDaysUtc(baseDate, dueDays),
      notes: matchedTemplate
        ? `Auto-created from quote item (+${dueDays}d rule)`
        : 'Auto-created from quote item',
    });
    markSeen(label);
  }

  for (const tpl of labelTemplates) {
    const label = tpl.label.trim();
    if (!label || hasSeen(label)) {
      continue;
    }
    pendingCreates.push({
      bookingId: params.bookingId,
      label,
      dueAt: addDaysUtc(baseDate, tpl.defaultDueDays),
      notes: `Auto-created from template (+${tpl.defaultDueDays}d)`,
    });
    markSeen(label);
  }

  if (pendingCreates.length === 0) {
    return [];
  }

  if (typeof tx.deliverable.createManyAndReturn === 'function') {
    return tx.deliverable.createManyAndReturn({
      data: pendingCreates,
    });
  }

  return Promise.all(
    pendingCreates.map((data) =>
      tx.deliverable.create({
        data,
      }),
    ),
  );
}
