import { prisma } from '../config/db';
import { sendMail } from './mail';

/** Creates an in-app notification and emails the user (best effort). */
export async function notify(userId: string, title: string, message: string) {
  try {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    await prisma.notification.create({ data: { userId, title, message } });
    if (u) await sendMail(u.email, title, message);
  } catch (e) {
    console.error('notify failed:', (e as Error).message);
  }
}
