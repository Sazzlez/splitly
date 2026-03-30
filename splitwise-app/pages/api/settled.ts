import type { NextApiRequest, NextApiResponse } from 'next';
import { toggleDebtSettled, getExpenses } from '@/lib/sheets';
import { verifyToken } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Nicht angemeldet' });

  const payload = await verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Ungültiger Token' });

  const { id, debtorUserId } = req.body;
  if (!id || !debtorUserId) {
    return res.status(400).json({ error: 'ID und Schuldner fehlen' });
  }

  try {
    const allExpenses = await getExpenses();
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
