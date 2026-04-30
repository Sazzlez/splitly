import type { NextApiRequest, NextApiResponse } from 'next';
import { getUsers, addEvent, ensureEventsSheet, migrateExpensesToEvent, getEvents } from '@/lib/sheets';

const REBIRTH_EVENT_ID = 'c4f8a2b6-1d3e-4f50-8a9b-7c6d5e4f3a2b';
const REBIRTH_CREATOR_ID = 'fb0bb245-34e4-40ff-b9bb-150297887e18';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const secret = req.headers['x-migrate-secret'];
  if (secret !== (process.env.MIGRATE_SECRET || 'splitly-migrate-2026')) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    await ensureEventsSheet();

    // Check if Rebirth 2026 already exists
    const existingEvents = await getEvents(REBIRTH_CREATOR_ID);
    const alreadyExists = existingEvents.some((e) => e.id === REBIRTH_EVENT_ID);

    let eventCreated = false;
    if (!alreadyExists) {
      const users = await getUsers();
      const allUserIds = users.map((u) => u.id);

      await addEvent({
        id: REBIRTH_EVENT_ID,
        name: 'Rebirth 2026',
        code: 'RB2026',
        creatorId: REBIRTH_CREATOR_ID,
        memberIds: allUserIds,
      });
      eventCreated = true;
    }

    const migratedCount = await migrateExpensesToEvent(REBIRTH_EVENT_ID);

    return res.json({
      ok: true,
      eventCreated,
      expensesMigrated: migratedCount,
      eventId: REBIRTH_EVENT_ID,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: String(error) });
  }
}
