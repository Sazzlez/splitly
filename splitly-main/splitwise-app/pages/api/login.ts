import type { NextApiRequest, NextApiResponse } from 'next';
import { getUsers } from '@/lib/sheets';
import { createToken } from '@/lib/auth';
import bcrypt from 'bcryptjs';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  const { userId, password } = req.body;
  if (!userId || !password) return res.status(400).json({ error: 'Fehlende Daten' });

  try {
    const users = await getUsers();
    const user = users.find((u) => u.id === userId);
    if (!user) return res.status(401).json({ error: 'Benutzer nicht gefunden' });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Falsches Passwort' });

    const token = await createToken(user.id, user.name);
    res.json({ token, user: { id: user.id, name: user.name } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Login fehlgeschlagen' });
  }
}
