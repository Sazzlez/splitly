import type { NextApiRequest, NextApiResponse } from 'next';
import { getUsers, updateUser } from '@/lib/sheets';
import { verifyToken } from '@/lib/auth';
import { isAdmin } from '@/lib/admin';
import bcrypt from 'bcryptjs';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PUT') return res.status(405).end();

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Nicht angemeldet' });

  const payload = await verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Ungültiger Token' });

  if (!isAdmin(payload.userId)) {
    return res.status(403).json({ error: 'Keine Admin-Rechte' });
  }

  const { userId, newPassword } = req.body as { userId?: string; newPassword?: string };

  if (!userId || !newPassword) {
    return res.status(400).json({ error: 'User-ID und Passwort erforderlich' });
  }

  if (newPassword.length < 4) {
    return res.status(400).json({ error: 'Passwort muss mindestens 4 Zeichen haben' });
  }

  try {
    const users = await getUsers();
    const target = users.find((u) => u.id === userId);
    if (!target) return res.status(404).json({ error: 'Benutzer nicht gefunden' });

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await updateUser(userId, { passwordHash });

    return res.json({ ok: true, userName: target.name });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Reset fehlgeschlagen' });
  }
}
