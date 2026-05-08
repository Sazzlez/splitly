import type { NextApiRequest, NextApiResponse } from 'next';
import { toggleDebtSettled, getExpenses } from '@/lib/sheets';
import { verifyToken } from '@/lib/auth';

type SettlementEntry = {
  id: string;
  debtorUserId: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Nicht angemeldet' });

  const payload = await verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Ungültiger Token' });

  const { id, debtorUserId, entries } = req.body as {
    id?: string;
    debtorUserId?: string;
    entries?: SettlementEntry[];
  };

  try {
    const allExpenses = await getExpenses();

    if (Array.isArray(entries) && entries.length > 0) {
      const normalizedEntries = entries.filter(
        (entry): entry is SettlementEntry => !!entry?.id && !!entry?.debtorUserId,
      );

      if (!normalizedEntries.length) {
        return res.status(400).json({ error: 'Keine gültigen Schulden übergeben' });
      }

      const pairUsers = new Set<string>();

      for (const entry of normalizedEntries) {
        const expense = allExpenses.find((item) => item.id === entry.id);
        if (!expense) return res.status(404).json({ error: 'Ausgabe nicht gefunden' });

        const validDebtor = expense.participants.some(
          (participant) => participant.userId === entry.debtorUserId && participant.userId !== expense.paidBy,
        );
        if (!validDebtor) {
          return res.status(400).json({ error: 'Ungültiger Schuldposten' });
        }

        pairUsers.add(expense.paidBy);
        pairUsers.add(entry.debtorUserId);
      }

      if (!pairUsers.has(payload.userId)) {
        return res.status(403).json({ error: 'Keine Berechtigung für diese Schuld' });
      }

      const results = [];
      for (const entry of normalizedEntries) {
        results.push(await toggleDebtSettled(entry.id, entry.debtorUserId));
      }

      return res.json({ ok: true, results });
    }

    if (!id || !debtorUserId) {
      return res.status(400).json({ error: 'ID und Schuldner fehlen' });
    }

    const expense = allExpenses.find((item) => item.id === id);
    if (!expense) return res.status(404).json({ error: 'Ausgabe nicht gefunden' });
    if (expense.paidBy !== payload.userId) {
      return res.status(403).json({ error: 'Nur der Zahler kann eine Schuld als beglichen markieren' });
    }

    const result = await toggleDebtSettled(id, debtorUserId);
    return res.json(result);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Fehler beim Aktualisieren' });
  }
}
