import { prisma } from "../../lib/prisma.js";
import type { Result } from "../../common/types/result.js";
import { ok, err } from "../../common/types/result.js";
import {
  notFound,
  validationError,
} from "../../common/errors/app-error.js";
import type { PlanTier, TransactionType } from "@prisma/client";

const PLAN_LIMITS: Record<PlanTier, number> = {
  free: 3,
  starter: 20,
  pro: Infinity,
};

export interface CreditBalance {
  balance: number;
  planTier: PlanTier;
  monthlyLimit: number | null;
}

export interface CreditTransactionItem {
  id: string;
  transactionType: TransactionType;
  amount: number;
  balanceAfter: number;
  referenceId: string | null;
  createdAt: Date;
}

/**
 * Get current credit balance and plan.
 */
export async function getBalance(
  userId: string
): Promise<Result<CreditBalance>> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });
  if (!user) return err(notFound("User not found"));

  const monthlyLimit =
    user.planTier === "pro" ? null : PLAN_LIMITS[user.planTier];

  return ok({
    balance: user.creditBalance,
    planTier: user.planTier,
    monthlyLimit,
  });
}

/**
 * Top up credits (purchase). Plan enforcement: Free 3, Starter 20/mo, Pro unlimited.
 */
export async function topUp(
  userId: string,
  amount: number
): Promise<Result<CreditBalance>> {
  if (amount < 1 || amount > 100) {
    return err(validationError("Top-up amount must be between 1 and 100"));
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
  });
  if (!user) return err(notFound("User not found"));

  const newBalance = user.creditBalance + amount;

  await prisma.$transaction([
    prisma.creditTransaction.create({
      data: {
        userId,
        transactionType: "top_up",
        amount,
        balanceAfter: newBalance,
      },
    }),
    prisma.user.update({
      where: { id: userId },
      data: { creditBalance: newBalance },
    }),
  ]);

  return getBalance(userId);
}

/**
 * Get credit transaction history.
 */
export async function getHistory(
  userId: string,
  limit = 50
): Promise<Result<CreditTransactionItem[]>> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });
  if (!user) return err(notFound("User not found"));

  const txns = await prisma.creditTransaction.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return ok(
    txns.map((t) => ({
      id: t.id,
      transactionType: t.transactionType,
      amount: t.amount,
      balanceAfter: t.balanceAfter,
      referenceId: t.referenceId,
      createdAt: t.createdAt,
    }))
  );
}
