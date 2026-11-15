import { sequelize } from '../config/db.js';
import { Registration } from '../models/index.js';
import { Employee } from '../models/employee.js';
import { nowLocal } from './walkinPass.js';

export const empCodeOf = (seq, year) => `EMP-${year}-${String(seq).padStart(4, '0')}`;

/* Adds one person to the registry and gives the next automatic ID of that company.
   The company row is locked while the number is chosen, so two people can never get the same ID. */
export async function addEmployee(orgId, data) {
  return sequelize.transaction(async (t) => {
    await Registration.findByPk(orgId, { attributes: ['id'], transaction: t, lock: t.LOCK.UPDATE });
    const last = (await Employee.max('seq', { where: { orgId }, transaction: t })) || 0;
    const seq = last + 1;
    const year = nowLocal().date.slice(0, 4);
    return Employee.create({ ...data, orgId, seq, empCode: empCodeOf(seq, year) }, { transaction: t });
  });
}

// When an applicant is moved to "Hired" they join the registry once (the application id is unique). Never throws.
export async function ensureEmployeeFromApplication(app, job, actor) {
  try {
    if (await Employee.findOne({ where: { applicationId: app.id }, attributes: ['id'] })) return null;
    const months = Number(job?.probationMonths || 0);
    return await addEmployee(app.orgId, {
      name: app.candidateName, email: app.candidateEmail, phone: app.candidatePhone || null,
      department: job?.department || null, designation: job?.title || null,
      joiningDate: nowLocal().date, probationMonths: months, status: months > 0 ? 'probation' : 'active',
      source: 'hired', applicationId: app.id, jobId: app.jobId, candidateUserId: app.candidateUserId,
      createdById: actor?.id, createdByName: actor?.name,
    });
  } catch (e) {
    console.error('could not add the hired candidate to the employee registry:', e.message);
    return null;
  }
}
