import type { NextApiRequest, NextApiResponse } from 'next';
import { getEvents, addEvent, updateEventName, deleteEvent, addUserToEvent, getEventByCode, ensureEventsSheet } from '@/lib/sheets';
import { verifyToken } from '@/lib/auth';
import { v4 as uuidv4 } from 'uuid';

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Nicht angemeldet' });

  const payload = await verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Ungültiger Token' });

  if (req.method === 'GET') {
    try {
      const events = await getEvents(payload.userId);
      return res.json(events);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Fehler beim Laden der Events' });
    }
  }

  if (req.method === 'POST') {
    const { name, code: joinCode } = req.body as { name?: string; code?: string };

    // Join event by code
    if (joinCode) {
      try {
        const event = await getEventByCode(joinCode.trim());
        if (!event) return res.status(404).json({ error: 'Event nicht gefunden. Code prüfen.' });
        if (event.memberIds.includes(payload.userId)) {
          return res.json(event);
        }
        await addUserToEvent(event.id, payload.userId);
        const updated = await getEventByCode(joinCode.trim());
        return res.json(updated);
      } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Beitreten fehlgeschlagen' });
      }
    }

    // Create new event
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Event-Name fehlt' });
    }

    try {
      await ensureEventsSheet();
      const event = {
        id: uuidv4(),
        name: name.trim(),
        code: generateCode(),
        creatorId: payload.userId,
        memberIds: [payload.userId],
      };
      await addEvent(event);
      return res.json(event);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Event konnte nicht erstellt werden' });
    }
  }

  if (req.method === 'PUT') {
    const { id, name } = req.body as { id: string; name: string };
    if (!id || !name?.trim()) return res.status(400).json({ error: 'ID und Name fehlen' });

    try {
      const events = await getEvents(payload.userId);
      const event = events.find((e) => e.id === id);
      if (!event) return res.status(404).json({ error: 'Event nicht gefunden' });
      if (event.creatorId !== payload.userId) {
        return res.status(403).json({ error: 'Nur der Ersteller kann das Event umbenennen' });
      }
      await updateEventName(id, name.trim());
      return res.json({ ok: true });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Umbenennen fehlgeschlagen' });
    }
  }

  if (req.method === 'DELETE') {
    const { id } = req.body as { id: string };
    if (!id) return res.status(400).json({ error: 'ID fehlt' });

    try {
      const events = await getEvents(payload.userId);
      const event = events.find((e) => e.id === id);
      if (!event) return res.status(404).json({ error: 'Event nicht gefunden' });
      if (event.creatorId !== payload.userId) {
        return res.status(403).json({ error: 'Nur der Ersteller kann das Event löschen' });
      }
      await deleteEvent(id);
      return res.json({ ok: true });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Löschen fehlgeschlagen' });
    }
  }

  return res.status(405).end();
}
