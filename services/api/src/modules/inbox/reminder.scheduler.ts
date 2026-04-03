/**
 * Reminder scheduler — checks for unacknowledged inbox items and flags
 * CHS risk when response time exceeds thresholds.
 */

import { prisma } from "../../lib/prisma.js";

const REMINDER_48H_MS = 48 * 60 * 60 * 1000;
const CHS_RISK_5D_MS = 5 * 24 * 60 * 60 * 1000;

/** Process pending reminders: 48h nudge and 5d CHS risk flag. */
export async function processReminders(): Promise<{
  reminders48hSent: number;
  chsRisk5dFlagged: number;
}> {
  const now = new Date();
  const threshold48h = new Date(now.getTime() - REMINDER_48H_MS);
  const threshold5d = new Date(now.getTime() - CHS_RISK_5D_MS);

  const needs48h = await prisma.pRInboxItem.updateMany({
    where: {
      isAcknowledged: false,
      reminder48hSent: false,
      createdAt: { lt: threshold48h },
    },
    data: { reminder48hSent: true },
  });

  const needs5d = await prisma.pRInboxItem.updateMany({
    where: {
      isAcknowledged: false,
      chsRisk5dFlagged: false,
      createdAt: { lt: threshold5d },
    },
    data: { chsRisk5dFlagged: true },
  });

  return {
    reminders48hSent: needs48h.count,
    chsRisk5dFlagged: needs5d.count,
  };
}

/** Get counts of pending reminders for a user. */
export async function getReminderCounts(
  userId: string
): Promise<{
  unacknowledged: number;
  overdue48h: number;
  chsRisk: number;
}> {
  const [unacknowledged, overdue48h, chsRisk] = await Promise.all([
    prisma.pRInboxItem.count({
      where: { userId, isAcknowledged: false },
    }),
    prisma.pRInboxItem.count({
      where: { userId, isAcknowledged: false, reminder48hSent: true },
    }),
    prisma.pRInboxItem.count({
      where: { userId, isAcknowledged: false, chsRisk5dFlagged: true },
    }),
  ]);

  return { unacknowledged, overdue48h, chsRisk };
}
