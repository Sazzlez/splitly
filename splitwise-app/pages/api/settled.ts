import type { NextApiRequest, NextApiResponse } from 'next';
import { applyDebtSettlements, getExpenses } from '@/lib/sheets';
import { verifyToken } from '@/lib/auth';

type SettlementEntry = {
  id: string;
  debtorUserId: string;
  amount: number;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Nicht angemeldet' });

  const payload = await verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Ungültiger Token' });

  const action: 'settle' | 'unsettle' = req.body?.action === 'unsettle' ? 'unsettle' : 'settle';
  const settlements: SettlementEntry[] = Array.isArray(req.body?.settlements)
    ? req.body.settlements
    : req.body?.id && req.body?.debtorUserId && req.body?.amount
      ? [{ id: req.body.id, debtorUserId: req.body.debtorUserId, amount: req.body.amount }]
      : [];

  if (!settlements.length) {
    return res.status(400).json({ error: 'Keine gültigen Verrechnungsdaten erhalten' });
  }

  try {
    const allExpenses = await getExpenses();

    for (const settlement of settlements) {
      if (!settlement.id || !settlement.debtorUserId || !Number.isFinite(Number(settlement.amount)) || Number(settlement.amount) <= 0) {
        return res.status(400).json({ error: 'Ungültige Verrechnungsdaten' });
      }

      const expense = allExpenses.find((item) => item.id === settlement.id);
      if (!expense) return res.status(404).json({ error: 'Ausgabe nicht gefunden' });
      if (expense.paidBy !== payload.userId) {
        return res.status(403).json({ error: 'Nur die zahlende Person darf diese Verrechnung buchen' });
      }
    }

    const results = await applyDebtSettlements(settlements, action);
    return res.json({ ok: true, action, results });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Fehler beim Aktualisieren' });
  }
}
