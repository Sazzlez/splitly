import type { NextApiRequest, NextApiResponse } from 'next';
import { getUsers, addUser } from '@/lib/sheets';
import { createToken } from '@/lib/auth';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  const { name, password } = req.body;
  if (!name || !password) return res.status(400).json({ error: 'Name und Passwort erforderlich' });

  try {
    const users = await getUsers();
    if (users.find((u) => u.name.toLowerCase() === name.toLowerCase())) {
      return res.status(409).json({ error: 'Name bereits vergeben' });
    }
    const id = uuidv4();
    const hash = await bcrypt.hash(password, 10);
    await addUser(id, name, hash);
    const token = await createToken(id, name);
    res.json({ token, user: { id, name } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Registrierung fehlgeschlagen' });
  }
}
