import { Op } from 'sequelize';
import { Employee } from '../models/employee.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { str, audit } from '../utils/helpers.js';
import { nowLocal } from '../utils/walkinPass.js';
import { addEmployee } from '../utils/employeeRegistry.js';

/* Employee registry of one company (Owner and HR Manager). */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[0-9+\-\s()]{7,20}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = ['probation', 'active', 'notice', 'exited'];
const bad = (m) => new HttpError(400, m);

export const validateEmployeeId = (req, res, next, id) => (UUID_RE.test(id) ? next() : res.status(404).json({ message: 'Employee not found.' }));

const orgOf = (req) => {
  if (!req.user.registrationId) throw new HttpError(403, 'Your account is not linked to a company.');
  return req.user.registrationId;
};

function probationEnds(e) {
  if (!e.joiningDate || !e.probationMonths) return null;
  const d = new Date(`${e.joiningDate}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + e.probationMonths);
  return d.toISOString().slice(0, 10);
}

const shape = (e) => ({
  id: e.id, empCode: e.empCode, name: e.name, email: e.email || '', phone: e.phone || '', department: e.department || '', designation: e.designation || '',
  joiningDate: e.joiningDate, probationMonths: e.probationMonths || 0, probationEnds: probationEnds(e), status: e.status, source: e.source,
  applicationId: e.applicationId || null, notes: e.notes || '', exitDate: e.exitDate, exitReason: e.exitReason || '', createdAt: e.createdAt, createdByName: e.createdByName || '',
});

function clean(b, { partial }) {
  const out = {};
  if (!partial || b.name !== undefined) { const n = str(b.name, 120); if (n.length < 2) throw bad('Enter the name (at least 2 letters).'); out.name = n; }
  if (b.email !== undefined) { const e = str(b.email, 150).toLowerCase(); if (e && !EMAIL_RE.test(e)) throw bad('Enter a valid email.'); out.email = e || null; }
  if (b.phone !== undefined) { const p = str(b.phone, 30); if (p && !PHONE_RE.test(p)) throw bad('Enter a valid phone number.'); out.phone = p || null; }
  if (b.department !== undefined) out.department = str(b.department, 80) || null;
  if (b.designation !== undefined) out.designation = str(b.designation, 100) || null;
  if (b.notes !== undefined) out.notes = str(b.notes, 2000) || null;
  if (b.joiningDate !== undefined) {
    const d = str(b.joiningDate, 10);
    if (d && (!DATE_RE.test(d) || Number.isNaN(Date.parse(d)))) throw bad('Choose a valid joining date.');
    out.joiningDate = d || null;
  }
  if (b.probationMonths !== undefined) {
    const m = Number(b.probationMonths);
    if (!Number.isInteger(m) || m < 0 || m > 24) throw bad('Probation must be 0 to 24 months.');
    out.probationMonths = m;
  }
  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status)) throw bad('Choose a valid status.');
    out.status = b.status;
  }
  return out;
}

export const listEmployees = asyncHandler(async (req, res) => {
  const orgId = orgOf(req);
  const where = { orgId };
  if (STATUSES.includes(req.query.status)) where.status = req.query.status;
  const q = str(req.query.q, 60).replace(/[%_]/g, '');
  if (q) where[Op.or] = [{ name: { [Op.like]: `%${q}%` } }, { email: { [Op.like]: `%${q}%` } }, { empCode: { [Op.like]: `%${q}%` } }, { department: { [Op.like]: `%${q}%` } }, { designation: { [Op.like]: `%${q}%` } }];
  const rows = await Employee.findAll({ where, order: [['seq', 'DESC']], limit: 1000 });
  const all = await Employee.findAll({ where: { orgId }, attributes: ['status', 'department'], raw: true });
  const counts = { total: all.length, probation: 0, active: 0, notice: 0, exited: 0 };
  all.forEach((r) => { counts[r.status] += 1; });
  const departments = [...new Set(all.map((r) => r.department).filter(Boolean))].sort();
  res.json({ items: rows.map(shape), counts, departments });
});

export const createEmployee = asyncHandler(async (req, res) => {
  const orgId = orgOf(req);
  const data = clean(req.body || {}, { partial: false });
  if (!data.joiningDate) data.joiningDate = nowLocal().date;
  if (data.email && (await Employee.count({ where: { orgId, email: data.email, status: { [Op.ne]: 'exited' } } }))) throw new HttpError(409, 'An employee with this email is already in the registry.');
  const emp = await addEmployee(orgId, {
    status: 'active', ...data, source: 'manual', createdById: req.user.id, createdByName: req.user.name,
  });
  await audit({ actor: req.user, action: 'EMPLOYEE_ADDED', entity: 'Employee', entityId: emp.id, meta: { empCode: emp.empCode, name: emp.name }, req });
  res.status(201).json(shape(emp));
});

export const updateEmployee = asyncHandler(async (req, res) => {
  const emp = await Employee.findOne({ where: { id: req.params.id, orgId: orgOf(req) } });
  if (!emp) throw new HttpError(404, 'Employee not found.');
  const changes = clean(req.body || {}, { partial: true });
  if (changes.status === 'exited' || (changes.status && emp.status === 'exited')) {
    // leaving: write the date and reason; coming back: clear them
    if (changes.status === 'exited') {
      changes.exitDate = str(req.body?.exitDate, 10) || nowLocal().date;
      if (!DATE_RE.test(changes.exitDate)) throw bad('Choose a valid exit date.');
      changes.exitReason = str(req.body?.exitReason, 300) || null;
    } else { changes.exitDate = null; changes.exitReason = null; }
  }
  await emp.update(changes);
  await audit({ actor: req.user, action: changes.status && changes.status !== undefined ? 'EMPLOYEE_STATUS' : 'EMPLOYEE_UPDATED', entity: 'Employee', entityId: emp.id, meta: { empCode: emp.empCode, fields: Object.keys(changes) }, req });
  res.json(shape(emp));
});
