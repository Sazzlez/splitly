import type { NextApiRequest, NextApiResponse } from 'next';
import { getExpenses, addExpense } from '@/lib/sheets';
import { verifyToken } from '@/lib/auth';
import { v4 as uuidv4 } from 'uuid';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Nicht angemeldet' });
  const payload = await verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Ungültiger Token' });

  if (req.method === 'GET') {
    try {
      const expenses = await getExpenses();
      return res.json(expenses);
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Fehler beim Laden' });
    }
  }

  if (req.method === 'POST') {
    const { description, amount, paidBy, participants } = req.body;
    if (!description || !amount || !paidBy || !participants?.length) {
      return res.status(400).json({ error: 'Fehlende Felder' });
    }
    const totalPercent = participants.reduce((s: number, p: any) => s + p.percent, 0);
    if (Math.abs(totalPercent - 100) > 0.01) {
      return res.status(400).json({ error: 'Prozentsumme muss 100 ergeben' });
    }
    try {
      const expense = {
        id: uuidv4(),
        description,
        amount: parseFloat(amount),
        paidBy,
        date: new Date().toISOString(),
        participants,
        createdBy: payload.userId,
      };
      await addExpense(expense);
      return res.json(expense);
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Ausgabe konnte nicht gespeichert werden' });
    }
  }

  res.status(405).end();
}
