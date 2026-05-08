import type { NextApiRequest, NextApiResponse } from 'next';
import { getUsers, updateUser } from '@/lib/sheets';
import { verifyToken, createToken } from '@/lib/auth';
import bcrypt from 'bcryptjs';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PUT') return res.status(405).end();

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Nicht angemeldet' });

  const payload = await verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Ungültiger Token' });

  const { name, currentPassword, newPassword } = req.body as {
    name?: string;
    currentPassword?: string;
    newPassword?: string;
  };

  try {
    const users = await getUsers();
    const user = users.find((u) => u.id === payload.userId);
    if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden' });

    const fields: { name?: string; passwordHash?: string } = {};

    if (name && name.trim() && name.trim() !== user.name) {
      const nameTaken = users.some(
        (u) => u.id !== user.id && u.name.toLowerCase() === name.trim().toLowerCase(),
      );
      if (nameTaken) return res.status(400).json({ error: 'Name bereits vergeben' });
      fields.name = name.trim();
    }

    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'Aktuelles Passwort fehlt' });
      }
      const valid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!valid) return res.status(401).json({ error: 'Aktuelles Passwort falsch' });
      if (newPassword.length < 4) {
        return res.status(400).json({ error: 'Neues Passwort zu kurz (min. 4 Zeichen)' });
      }
      fields.passwordHash = await bcrypt.hash(newPassword, 10);
    }

    if (!Object.keys(fields).length) {
      return res.status(400).json({ error: 'Keine Änderungen' });
    }

    await updateUser(payload.userId, fields);

    const newName = fields.name ?? user.name;
    const newToken = await createToken(payload.userId, newName);

    return res.json({ token: newToken, user: { id: payload.userId, name: newName } });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Profil-Update fehlgeschlagen' });
  }
}
