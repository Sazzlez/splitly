import type { NextApiRequest, NextApiResponse } from 'next';
import { getExpenses, addExpense, updateExpense, deleteExpense } from '@/lib/sheets';
import { verifyToken } from '@/lib/auth';
import { v4 as uuidv4 } from 'uuid';

type Participant = { userId: string; percent: number };

function isValidParticipantList(value: unknown): value is Participant[] {
  if (!Array.isArray(value) || !value.length) return false;

  const uniqueIds = new Set<string>();
  let total = 0;

  for (const item of value) {
    if (!item || typeof item !== 'object') return false;
    if (typeof item.userId !== 'string' || !item.userId) return false;
    if (uniqueIds.has(item.userId)) return false;
    if (!Number.isFinite(item.percent) || item.percent <= 0 || item.percent > 100) return false;

    uniqueIds.add(item.userId);
    total += item.percent;
  }

  return Math.abs(total - 100) <= 0.1;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Nicht angemeldet' });

  const payload = await verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Ungültiger Token' });

  if (req.method === 'GET') {
    const eventId = req.query.eventId as string | undefined;
    try {
      return res.json(await getExpenses(eventId));
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Fehler beim Laden' });
    }
  }

  if (req.method === 'POST') {
    const description = String(req.body?.description || '').trim();
    const amount = Number(req.body?.amount);
    const paidBy = String(req.body?.paidBy || '');
    const participants = req.body?.participants;
    const eventId = String(req.body?.eventId || '');

    if (!description || !paidBy || !Number.isFinite(amount) || amount <= 0 || !isValidParticipantList(participants)) {
      return res.status(400).json({ error: 'Ungültige Ausgabedaten' });
    }

    if (!eventId) {
      return res.status(400).json({ error: 'Event-ID fehlt' });
    }

    try {
      const expense = {
        id: uuidv4(),
        description,
        amount,
        paidBy,
        date: new Date().toISOString(),
        participants,
        createdBy: payload.userId,
        eventId,
      };

      await addExpense(expense);
      return res.json(expense);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Ausgabe konnte nicht gespeichert werden' });
    }
  }

  if (req.method === 'PUT') {
    const id = String(req.body?.id || '');
    const description = typeof req.body?.description === 'string' ? req.body.description.trim() : undefined;
    const amount = req.body?.amount !== undefined ? Number(req.body.amount) : undefined;
    const paidBy = typeof req.body?.paidBy === 'string' ? req.body.paidBy : undefined;
    const participants = req.body?.participants;

    if (!id) return res.status(400).json({ error: 'ID fehlt' });
    if (amount !== undefined && (!Number.isFinite(amount) || amount <= 0)) {
      return res.status(400).json({ error: 'Ungültiger Betrag' });
    }
    if (participants !== undefined && !isValidParticipantList(participants)) {
      return res.status(400).json({ error: 'Ungültige Aufteilung' });
    }

    try {
      const allExpenses = await getExpenses();
      const expense = allExpenses.find((item) => item.id === id);

      if (!expense) return res.status(404).json({ error: 'Ausgabe nicht gefunden' });
      if (expense.paidBy !== payload.userId) {
        return res.status(403).json({ error: 'Nur die zahlende Person darf diese Ausgabe bearbeiten' });
      }

      await updateExpense(id, { description, amount, paidBy, participants });
      return res.json({ ok: true });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Aktualisierung fehlgeschlagen' });
    }
  }

  if (req.method === 'DELETE') {
    const id = String(req.body?.id || '');
    if (!id) return res.status(400).json({ error: 'ID fehlt' });

    try {
      const allExpenses = await getExpenses();
      const expense = allExpenses.find((item) => item.id === id);

      if (!expense) return res.status(404).json({ error: 'Ausgabe nicht gefunden' });
      if (expense.paidBy !== payload.userId) {
        return res.status(403).json({ error: 'Nur die zahlende Person darf diese Ausgabe löschen' });
      }

      await deleteExpense(id);
      return res.json({ ok: true });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Löschen fehlgeschlagen' });
    }
  }

  return res.status(405).end();
}
