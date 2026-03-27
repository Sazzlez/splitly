import type { NextApiRequest, NextApiResponse } from 'next';
import { getExpenses, addExpense, updateExpense, deleteExpense } from '@/lib/sheets';
import { verifyToken } from '@/lib/auth';
import { v4 as uuidv4 } from 'uuid';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Nicht angemeldet' });
  const payload = await verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Ungültiger Token' });

  if (req.method === 'GET') {
    try {
      return res.json(await getExpenses());
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Fehler beim Laden' });
    }
  }

  if (req.method === 'POST') {
    const { description, amount, paidBy, participants } = req.body;
    if (!description || !amount || !paidBy || !participants?.length)
      return res.status(400).json({ error: 'Fehlende Felder' });
    const total = participants.reduce((s: number, p: any) => s + p.percent, 0);
    if (Math.abs(total - 100) > 0.01)
      return res.status(400).json({ error: 'Prozentsumme muss 100 ergeben' });
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

  if (req.method === 'PUT') {
    const { id, description, amount, paidBy, participants } = req.body;
    if (!id) return res.status(400).json({ error: 'ID fehlt' });
    try {
      const all = await getExpenses();
      const exp = all.find((e) => e.id === id);
      if (!exp) return res.status(404).json({ error: 'Ausgabe nicht gefunden' });
      if (exp.createdBy !== payload.userId)
        return res.status(403).json({ error: 'Keine Berechtigung' });
      if (participants) {
        const total = participants.reduce((s: number, p: any) => s + p.percent, 0);
        if (Math.abs(total - 100) > 0.01)
          return res.status(400).json({ error: 'Prozentsumme muss 100 ergeben' });
      }
      await updateExpense(id, {
        description,
        amount: amount ? parseFloat(amount) : undefined,
        paidBy,
        participants,
      });
      return res.json({ ok: true });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Aktualisierung fehlgeschlagen' });
    }
  }

  if (req.method === 'DELETE') {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'ID fehlt' });
    try {
      const all = await getExpenses();
      const exp = all.find((e) => e.id === id);
      if (!exp) return res.status(404).json({ error: 'Ausgabe nicht gefunden' });
      if (exp.createdBy !== payload.userId)
        return res.status(403).json({ error: 'Keine Berechtigung' });
      await deleteExpense(id);
      return res.json({ ok: true });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Löschen fehlgeschlagen' });
    }
  }

  res.status(405).end();
}
