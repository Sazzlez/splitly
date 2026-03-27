import type { NextApiRequest, NextApiResponse } from 'next';
import { getUsers } from '@/lib/sheets';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  try {
    const users = await getUsers();
    res.json(users.map((u) => ({ id: u.id, name: u.name })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Fehler beim Laden der Benutzer' });
  }
}
