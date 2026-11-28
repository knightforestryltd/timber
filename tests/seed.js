'use strict';
// An established company in the mock backend, created through the same API the pages use.
const { createRuntime } = require('./gasmock');
function seedCompany(script) {
  const rt = createRuntime({ script });
  const r = rt.post({ svc: 'sync' }, { action: 'setPassword', newPassword: 'secret1', deviceName: 'Seeder', dev: 'SEED' });
  const key = r.key, at = r.adminToken;
  const S = (svc, b) => rt.post({ svc, k: key }, Object.assign({ dev: 'SEED', adminToken: at }, b));
  S('sync', { action: 'saveSettings', settings: {
    companyName: 'Test Forestry', gst: 5, speed: 80, fuelPrice: 1.6, apiKey: 'FAKEKEY',
    locations: [
      { id: 'L1', name: 'North Block', address: '53.6, -113.4', species: [{ name: 'Spruce', costPerTonne: 20, marginPct: 50, pricePerTonne: 40, tonnesPerCord: 1.5, costPerCord: 30, pricePerCord: 90 }] },
      { id: 'Y1', name: 'Home Yard', address: '53.5, -113.5', species: [{ name: 'Birch', costPerTonne: 30, marginPct: 50, pricePerTonne: 60, tonnesPerCord: 1.6, costPerCord: 48, pricePerCord: 120 }] }],
    units: [{ id: 'TU1', name: 'Tandem', costHourly: 100, marginPct: 20, hourly: 120, fuel: 45, tonnes: 20, hours: 1, plate: 'ABC123', config: 'Tandem', aliases: [] }], money: { employerCostPct: 10 }, homeBase: '53.5, -113.5' } });
  S('sync', { action: 'saveProfile', profile: { name: 'Test Forestry', email: 'office@example.test', phone: '780-555-0000', addr: '1 Mill Rd, Testville AB', gst: '12345 RT0001' } });
  S('trucks', { action: 'saveUnit', unit: { name: 'Tandem', type: 'truck', trackHours: 'no', currentOdo: 100000 } });
  S('trucks', { action: 'saveUnit', unit: { name: 'Loader', type: 'equipment', trackHours: 'yes', currentHours: 500 } });
  S('drivers', { action: 'adminSaveDriver', driver: { name: 'Dave', passcode: '1234', roles: ['driver'] } });
  S('drivers', { action: 'adminSaveDriver', driver: { name: 'Mo', passcode: '4321', roles: ['mechanic'] } });
  S('yards', { action: 'add', yard: 'Home Yard', species: 'Birch', type: 'In', tonnes: 40, pricePerTonne: 30, entryId: 'SEED1', product: 'Logs' });
  return { rt, key, at, S };
}
module.exports = { seedCompany };
