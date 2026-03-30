import type { NextApiRequest, NextApiResponse } from 'next';
import { toggleSettledPair, getExpenses } from '@/lib/sheets';
import { verifyToken } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Nicht angemeldet' });
  const payload = await verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Ungültiger Token' });

  const { id, debtorUserId } = req.body;
  if (!id || !debtorUserId) {
    return res.status(400).json({ error: 'ID oder Schuldner fehlt' });
  }

  try {
    const all = await getExpenses();
    const exp = all.find((e) => e.id === id);
    if (!exp) return res.status(404).json({ error: 'Ausgabe nicht gefunden' });
    if (exp.paidBy !== payload.userId) {
      return res.status(403).json({ error: 'Nur der Zahler kann eine Schuld als beglichen markieren' });
    }

    const isValidDebtor = exp.participants.some((participant) => participant.userId === debtorUserId && participant.userId !== exp.paidBy);
    if (!isValidDebtor) {
      return res.status(400).json({ error: 'Ungültiger Schuldner' });
    }

    const settledBy = await toggleSettledPair(id, debtorUserId);
    return res.json({ settledBy });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Fehler beim Aktualisieren' });
  }
}
