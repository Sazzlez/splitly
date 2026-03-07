import { Redis } from '@upstash/redis';
const kv = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const users = (await kv.get('users')) ?? [];
    return res.json(users);
  }

  if (req.method === 'POST') {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });

    const users = (await kv.get('users')) ?? [];
    const exists = users.find(
      (u) => u.name.toLowerCase() === name.trim().toLowerCase()
    );
    if (exists) return res.json(exists);

    const user = {
      id: `u_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: name.trim(),
      createdAt: new Date().toISOString(),
    };
    users.push(user);
    await kv.set('users', users);
    return res.status(201).json(user);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
