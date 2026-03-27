import { SignJWT, jwtVerify } from 'jose';

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback-secret-change-me');

export async function createToken(userId: string, userName: string) {
  return new SignJWT({ userId, userName })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(SECRET);
}

export async function verifyToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return payload as { userId: string; userName: string };
  } catch {
    return null;
  }
}
