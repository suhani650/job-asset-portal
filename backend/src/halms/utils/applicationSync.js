import { JobApplication } from '../models/jobApplication.js';

/* A walk-in booking is an interview appointment. Whenever it changes (booked, rescheduled, checked in, absent,
   cancelled), the candidate's job application must say so too: that is what the candidate sees on
   "My Job Applications" and what the HR sees on the Applicants board.
   Never throws: a failure here must not break the booking itself. */

const LOCKED = ['offered', 'hired', 'rejected', 'withdrawn']; // the company already decided: do not move these

export async function applyWalkInEvent(applicationId, { stage, message = '', status = null, onlyFrom = null, by = 'Walk-in desk' }, transaction) {
  if (!applicationId) return;
  try {
    const app = await JobApplication.findByPk(applicationId, { transaction });
    if (!app || app.status === 'withdrawn') return;
    const patch = { history: [...(app.history || []), { stage: stage || app.status, at: new Date().toISOString(), by, message }] };
    const movable = !LOCKED.includes(app.status) && (!onlyFrom || onlyFrom.includes(app.status));
    if (status && movable && app.status !== status) patch.status = status;
    await app.update(patch, { transaction });
  } catch (e) {
    console.error('walk-in application sync failed:', e.message);
  }
}
