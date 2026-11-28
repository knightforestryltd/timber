/* Knight Forestry v14 - Statistics engine (no screen code). Used by statistics.html and Quote's "Use real costs".
   Input: one svc=money summary + the Quote settings on this device. Every dollar is BEFORE GST; GST is kept apart.

   WHERE EACH DOLLAR COMES FROM (nothing is counted twice):
   - Sales: completed invoices (Loads Invoice Data) + manual invoices (Invoices tab), split into product / trucking / fuel surcharge.
   - Wood cost per load: (1) scale ticket Purchase $ (ticket # = Load ID); (2) pickup location: cost per tonne saved at booking x tonnes;
     (3) from a YARD: the yard's Out row for that load (weighted average cost). Yard In rows are stock, not cost.
   - Driver / yard wages: every shift, paid hours = start to end x the person's rate for that role; hours past the weekly overtime
     limit (pay week from the settings) x overtime multiplier; then + employer cost %.
   - Everything else: Expenses (fuel, work orders incl. mechanic labour, manual, recurring). GST paid is tracked apart. */
(function () {
  const num = v => { const n = Number(v); return isFinite(n) ? n : 0; };
  const r2 = n => Math.round(num(n) * 100) / 100;
  const day = v => { if (!v) return ''; if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return String(v); const d = new Date(typeof v === 'number' ? v : String(v)); if (isNaN(d)) return ''; return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const ms = v => { const t = typeof v === 'number' ? v : Date.parse(v); return isNaN(t) ? 0 : t; };
  const parse = s => { if (!s) return null; if (typeof s === 'object') return s; try { return JSON.parse(s); } catch (e) { return null; } };
  const toT = v => { const n = parseFloat(v); return n ? Math.round(n * 100) / 100 : 0; };   // loads' Net Tonnes is always tonnes
  const lc = s => String(s == null ? '' : s).trim().toLowerCase();

  function prep(S, qs) {
    qs = qs || {};
    const money = Object.assign({ employerCostPct: 12, otWeeklyHours: 50, otMultiplier: 1.5, weekStartsOn: 0 }, S.money || {}, qs.money || {});
    const emp = 1 + num(money.employerCostPct) / 100;
    const people = {}; (S.people || []).forEach(p => { people[String(p.id)] = p; });
    const rate = (pid, role) => { const p = people[String(pid)]; if (!p) return 0; const r = parse(p.rates) || {}; return r[role] != null && r[role] !== '' ? num(r[role]) : num(p.hourlyRate); };
    const unitsById = {}, unitsByName = {}; (S.units || []).forEach(u => { unitsById[String(u.id)] = u; unitsByName[lc(u.name)] = u; });
    const qUnit = name => (qs.units || []).find(u => u.name === name) || (qs.units || []).find(u => (u.aliases || []).includes(name));
    const spAt = (loc, sp) => { const l = (qs.locations || []).find(x => x.name === loc); return l && (l.species || []).find(x => x.name === sp); };
    const costFuel = qs.costFuelPrice != null && qs.costFuelPrice !== '' ? num(qs.costFuelPrice) : num(qs.fuelPrice);
    const yardNames = {}; (S.yards || []).forEach(r => { if (r.yard) yardNames[r.yard] = 1; });
    const tickets = {}; (S.tickets || []).forEach(t => { if (t && t[0]) tickets[lc(t[0])] = t; });
    const yardOut = {}; (S.yards || []).forEach(r => { if (r.type === 'Out' && r.loadId && r.status !== 'Void') (yardOut[lc(r.loadId)] = yardOut[lc(r.loadId)] || []).push(r); });

    /* ---- shifts: paid hours, overtime by pay week (across ALL roles of a person), wage incl. employer cost ---- */
    const weekStart = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); const back = (d.getDay() - num(money.weekStartsOn) + 7) % 7; d.setDate(d.getDate() - back); return d.getTime(); };
    const shifts = (S.shifts || []).filter(s => s.closedAt || s.status === 'Submitted').map(s => {
      const a = ms(s.startedAt), b = ms(s.closedAt) || a, paidH = b > a ? (b - a) / 3600000 : 0, km = s.endOdo !== '' && s.startOdo !== '' && num(s.endOdo) >= num(s.startOdo) ? num(s.endOdo) - num(s.startOdo) : 0;
      const role = s.type === 'yard' ? 'yard' : 'driver', u = unitsById[String(s.unitId)] || unitsByName[lc(s.unit)];
      return Object.assign({}, s, { a, b, paidH, km, role, rate: rate(s.driverId, role), unitKey: u ? String(u.id) : (s.unit || ''), unitName: u ? u.name : s.unit, date: day(a),
        fuelL: (s.fuel || []).reduce((t, f) => t + num(f.litres), 0), fuelCost: (s.fuel || []).reduce((t, f) => t + num(f.cost), 0) });
    }).sort((x, y) => x.a - y.a);
    const weekUsed = {};
    shifts.forEach(s => {
      const k = s.driverId + '|' + weekStart(s.a), used = weekUsed[k] || 0, limit = num(money.otWeeklyHours) || 1e9;
      const reg = Math.max(0, Math.min(s.paidH, limit - used)), ot = s.paidH - reg; weekUsed[k] = used + s.paidH;
      s.regH = reg; s.otH = ot; s.wageBase = reg * s.rate + ot * s.rate * num(money.otMultiplier || 1.5); s.wage = r2(s.wageBase * emp); s.otExtra = r2(ot * s.rate * (num(money.otMultiplier) - 1) * emp);
    });

    /* ---- loads: sales split, booking snapshot, wood cost ---- */
    const loads = (S.loads || []).map(l => {
      const inv = parse(l.invoiceData), m = inv && inv.model, bd = parse(l.bookingData) || {};
      const key = l.loadId || l.bookingId || (l.customerName + '|' + l.timestamp);
      const o = Object.assign({}, l, { key, bd, inv: m || null, invoicedAt: inv ? (num(inv.paidAt) || ms(l.timestamp)) : 0 });
      if (m) {
        let product = num(m.product), trucking = num(m.trucking), fsc = num(m.fsc);
        if (!(product || trucking || fsc)) {           // invoices made before v14: split from the printed lines
          (m.lines || []).forEach(x => { if (/^trip time/i.test(x.d)) trucking += num(x.a); else if (/fuel surcharge/i.test(x.d)) fsc += num(x.a); else product += num(x.a); });
          const tot = product + trucking + fsc; if (tot && Math.abs(tot - num(m.sub)) > 0.02) { const k = num(m.sub) / tot; product *= k; trucking *= k; fsc *= k; }
        }
        o.rev = { sub: r2(m.sub), product: r2(product), trucking: r2(trucking), fsc: r2(fsc), gst: r2(m.gst), total: r2(m.total) };
      }
      o.tActual = toT(l.netTonnes) || num(l.tonnes);
      // wood cost (cost of goods)
      const tk = tickets[lc(l.loadId)], outs = yardOut[lc(l.loadId)] || yardOut[lc(l.bookingId)] || [];
      if (tk && num(tk[7])) { o.wood = r2(tk[7]); o.woodSrc = 'scale ticket ' + tk[0]; }
      else if (yardNames[l.location] && outs.length) { o.wood = r2(outs.reduce((t, r) => t + (r.product === 'Split' ? num(r.cords) * num(r.costPerCord) : num(r.tonnes) * num(r.costPerTonne || r.pricePerTonne)), 0)); o.woodSrc = 'yard average cost'; }
      else { const sp = spAt(l.location, l.species), cpt = bd.spCostTonne != null && bd.spCostTonne !== '' ? num(bd.spCostTonne) : sp ? (sp.costPerTonne != null && sp.costPerTonne !== '' ? num(sp.costPerTonne) : num(sp.pricePerTonne)) : 0;
        o.wood = r2(cpt * o.tActual); o.woodSrc = bd.spCostTonne != null ? 'cost per tonne saved at booking' : 'cost per tonne in Quote settings'; }
      const qu = qUnit(l.truck);
      o.bookedCostH = bd.costHourly != null ? num(bd.costHourly) : qu ? num(qu.costHourly != null ? qu.costHourly : qu.hourly) : 0;
      o.bookedL100 = bd.fuelL100 != null ? num(bd.fuelL100) : qu ? num(qu.fuel) : 0;
      o.bookedFuelPrice = bd.costFuelPrice != null ? num(bd.costFuelPrice) : costFuel;
      o.billedH = l.billedHours !== '' && l.billedHours != null ? num(l.billedHours) : num(l.totalHours);
      o.unit = unitsById[String(l.unitId)] || null;
      return o;
    });
    const byKey = {}; loads.forEach(l => { byKey[lc(l.loadId)] = l; if (l.bookingId) byKey[lc(l.bookingId)] = l; });

    /* ---- shift -> loads: wage and fuel shared by trip hours (or km, or evenly); legs kept for comparisons ---- */
    shifts.forEach(s => {
      const trips = (s.trips || []).map(t => ({ t, l: byKey[lc(t.loadId)] })).filter(x => x.l);
      if (!trips.length) return;
      const hrs = x => { const g = x.t.legs || {}; return num(g.posH) + num(g.waitPickupH) + num(g.loadedH) + num(g.waitCustH) + num(g.returnH); };
      const kms = x => { const g = x.t.legs || {}; return num(g.posKm) + num(g.loadedKm) + num(g.returnKm); };
      const totH = trips.reduce((a, x) => a + hrs(x), 0), totK = trips.reduce((a, x) => a + kms(x), 0);
      trips.forEach(x => {
        const w = totH > 0 ? hrs(x) / totH : 1 / trips.length, wk = totK > 0 ? kms(x) / totK : (s.km > 0 && trips.every(y => num(y.l.km)) ? num(x.l.km) / trips.reduce((a, y) => a + num(y.l.km), 0) : w);
        const L = x.l; L.wageAlloc = r2((L.wageAlloc || 0) + s.wage * w); L.shiftHAlloc = (L.shiftHAlloc || 0) + s.paidH * w;
        if (s.fuelCost) { L.fuelActual = r2((L.fuelActual || 0) + s.fuelCost * wk); L.fuelLActual = (L.fuelLActual || 0) + s.fuelL * wk; }
        L.kmActual = (L.kmActual || 0) + (totK > 0 ? kms(x) : s.km * wk);
        L.legs = x.t.legs || null; L.stages = x.t.stages || []; L.shiftId = s.id; L.driver = s.driverName; L.shiftUnit = s.unitName; L.shiftUnitKey = s.unitKey;
        L.drivenH = (L.drivenH || 0) + (x.t.legs ? num(x.t.legs.loadedH) + num(x.t.legs.returnH) + num(x.t.legs.posH) : 0);
      });
    });

    /* ---- expenses ---- */
    const expenses = (S.expenses || []).filter(e => num(e.amount)).map(e => Object.assign({}, e, { d: day(e.date || e.at), amount: num(e.amount), gst: num(e.gst) }));
    const invoices = (S.invoices || []).map(iv => Object.assign({}, iv, { d: day(iv.at), rev: { sub: num(iv.sub), product: num(iv.product), trucking: num(iv.trucking), fsc: num(iv.fsc), gst: num(iv.gst), total: num(iv.total) } }));
    const payments = (S.payments || []).map(p => Object.assign({}, p, { d: day(p.paidAt), amount: num(p.amount) }));
    return { S, qs, money, emp, people, rate, unitsById, unitsByName, shifts, loads, expenses, invoices, payments, costFuel, yardNames, byKey, qUnit };
  }

  /* ---- everything in a date range [from, to] (yyyy-mm-dd) ---- */
  function period(M, from, to, opts) {
    opts = Object.assign({ overhead: true }, opts || {});
    const inR = d => d && d >= from && d <= to;
    const sales = [], costs = [];
    M.loads.forEach(l => { if (l.rev && inR(day(l.invoicedAt))) sales.push({ d: day(l.invoicedAt), kind: 'load', l, rev: l.rev, who: l.customerName, ref: l.loadId }); });
    M.invoices.forEach(iv => { if (inR(iv.d)) sales.push({ d: iv.d, kind: 'invoice', iv, rev: iv.rev, who: iv.customer, ref: iv.invoiceNo }); });
    sales.forEach(s => { if (s.l && s.l.wood) costs.push({ d: s.d, amount: s.l.wood, cat: 'Wood (cost of goods)', src: s.l.woodSrc, ref: s.l.loadId, loadKey: s.l.key, kind: 'wood' }); });
    M.shifts.forEach(s => { if (inR(s.date) && s.wage) costs.push({ d: s.date, amount: s.wage, cat: s.role === 'yard' ? 'Wages - yard' : 'Wages - drivers', src: s.driverName + ' ' + r2(s.paidH) + ' h' + (s.otH > 0 ? ' (' + r2(s.otH) + ' h overtime)' : ''), ref: s.id, shift: s, unitKey: s.unitKey, kind: 'wage' }); });
    M.expenses.forEach(e => { if (inR(e.d)) costs.push({ d: e.d, amount: e.amount, gst: e.gst, cat: e.category || 'Other', src: e.vendor || e.source, ref: e.id, exp: e, unitKey: e.unitId ? String(e.unitId) : '', loadKey: e.loadId || '', kind: e.source || 'manual' }); });
    const sum = (a, f) => r2(a.reduce((t, x) => t + num(f(x)), 0));
    const totals = { sales: sum(sales, s => s.rev.sub), product: sum(sales, s => s.rev.product), trucking: sum(sales, s => s.rev.trucking), fsc: sum(sales, s => s.rev.fsc), gstIn: sum(sales, s => s.rev.gst),
      costs: sum(costs, c => c.amount), gstOut: sum(costs, c => c.gst || 0),
      cashIn: sum(M.payments.filter(p => inR(p.d)), p => p.amount) };
    totals.profit = r2(totals.sales - totals.costs); totals.margin = totals.sales ? Math.round(totals.profit / totals.sales * 1000) / 10 : 0;
    const byCat = {}; costs.forEach(c => { byCat[c.cat] = r2((byCat[c.cat] || 0) + c.amount); });
    // per-load true profit
    const unitCostKm = unitCosts(M, from, to);
    const overheadPool = sum(costs.filter(c => c.kind !== 'wood' && c.kind !== 'wage' && c.kind !== 'fuel' && c.kind !== 'workorder' && !c.unitKey && !c.loadKey), c => c.amount);
    const invLoads = sales.filter(s => s.l), truckH = invLoads.reduce((t, s) => t + (s.l.billedH || 0), 0);
    const loadsOut = invLoads.map(s => {
      const l = s.l, uk = (l.unit && String(l.unit.id)) || l.shiftUnitKey || '', uc = unitCostKm[uk] || {};
      const fuelEst = r2(num(l.km) * 2 / 100 * l.bookedL100 * l.bookedFuelPrice), fuel = l.fuelActual != null ? l.fuelActual : fuelEst, km = l.kmActual || num(l.km) * 2;
      const truck = r2((uc.perKm || 0) * km), over = opts.overhead && truckH > 0 ? r2(overheadPool * (l.billedH || 0) / truckH) : 0;
      const profit = r2(l.rev.sub - (l.wood || 0) - (l.wageAlloc || 0) - fuel - truck - over);
      return { l, rev: l.rev.sub, wood: l.wood || 0, wage: l.wageAlloc || 0, fuel, fuelIsEst: l.fuelActual == null, truck, over, profit, km, empty: emptyOf(M, l, uc) };
    });
    return { from, to, sales, costs, totals, byCat, loads: loadsOut, overheadPool, unitCostKm };
  }
  // per unit: costs excl. fuel (repairs, parts, payments...) per km and per hour of shift time; fuel per km; wages per hour
  function unitCosts(M, from, to) {
    const inR = d => d && d >= from && d <= to, out = {};
    const u = k => (out[k] = out[k] || { km: 0, hours: 0, costs: 0, fuel: 0, wages: 0, fuelL: 0 });
    M.shifts.forEach(s => { if (!inR(s.date) || !s.unitKey || s.role === 'yard') return; const x = u(s.unitKey); x.km += s.km; x.hours += s.paidH; x.wages += s.wage; });
    M.expenses.forEach(e => { if (!inR(e.d) || !e.unitId) return; const x = u(String(e.unitId)); if (e.source === 'fuel') { x.fuel += e.amount; x.fuelL += num(String(e.note || '').split(' ')[0]); } else x.costs += e.amount; });
    Object.keys(out).forEach(k => { const x = out[k]; x.perKm = x.km ? x.costs / x.km : 0; x.perH = x.hours ? (x.costs + x.wages) / x.hours : 0; x.fuelPerKm = x.km ? x.fuel / x.km : 0; x.l100 = x.km && x.fuelL ? x.fuelL / x.km * 100 : 0; x.wagePerH = x.hours ? x.wages / x.hours : 0; });
    return out;
  }
  // unbilled ("empty") driving of one load: actual hours incl. empty legs minus the billed round trip
  function emptyOf(M, l, uc) {
    const g = l.legs; if (!g) return null;
    const actualH = num(g.posH) + num(g.waitPickupH) + num(g.loadedH) + num(g.waitCustH) + num(g.returnH), billed = l.billedH || num(l.totalHours);
    const emptyH = num(g.posH) + num(g.returnH), emptyKm = num(g.posKm) + num(g.returnKm), wageH = l.shiftHAlloc ? (l.wageAlloc || 0) / l.shiftHAlloc : 0;
    const fuelKm = uc && uc.fuelPerKm ? uc.fuelPerKm : (l.bookedL100 * l.bookedFuelPrice / 100);
    const emptyCost = r2(emptyH * wageH + emptyKm * (fuelKm + (uc ? uc.perKm || 0 : 0)));
    return { actualH: r2(actualH), billedH: r2(billed), unbilledH: r2(actualH - billed), emptyH: r2(emptyH), emptyKm: r2(emptyKm), emptyCost, posH: num(g.posH), chain: !!g.chain };
  }
  // the graph: sales / costs / profit per bucket (day, week or month)
  function series(M, view, anchor, opts) {
    const b = buckets(view, anchor, num(M.money.weekStartsOn));
    const all = period(M, b[0].from, b[b.length - 1].to, opts);
    b.forEach(x => {
      const s = all.sales.filter(y => y.d >= x.from && y.d <= x.to), c = all.costs.filter(y => y.d >= x.from && y.d <= x.to);
      x.sales = r2(s.reduce((t, y) => t + y.rev.sub, 0)); x.costs = r2(c.reduce((t, y) => t + y.amount, 0)); x.profit = r2(x.sales - x.costs); x.salesRows = s; x.costRows = c;
    });
    return { buckets: b, all };
  }
  function buckets(view, anchor, wso) {
    const a = new Date(anchor); a.setHours(12, 0, 0, 0); const out = [], D = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
    const ws = d => D(d, -((d.getDay() - wso + 7) % 7)), lab = d => d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
    if (view === 'week') { const s = ws(a); for (let i = 0; i < 7; i++) { const d = D(s, i); out.push({ from: day(d), to: day(d), label: d.toLocaleDateString('en-CA', { weekday: 'short' }) + ' ' + d.getDate() }); } }
    else if (view === 'month') { const m0 = new Date(a.getFullYear(), a.getMonth(), 1, 12), m1 = new Date(a.getFullYear(), a.getMonth() + 1, 0, 12); let s = ws(m0); while (s <= m1) { const e = D(s, 6); out.push({ from: day(s < m0 ? m0 : s), to: day(e > m1 ? m1 : e), label: lab(s < m0 ? m0 : s) }); s = D(s, 7); } }
    else if (view === 'quarter') { const q0 = new Date(a.getFullYear(), Math.floor(a.getMonth() / 3) * 3, 1, 12), q1 = new Date(q0.getFullYear(), q0.getMonth() + 3, 0, 12); let s = ws(q0); while (s <= q1 && out.length < 14) { const e = D(s, 6); out.push({ from: day(s < q0 ? q0 : s), to: day(e > q1 ? q1 : e), label: lab(s < q0 ? q0 : s) }); s = D(s, 7); } }
    else { for (let m = 0; m < 12; m++) { const s = new Date(a.getFullYear(), m, 1, 12), e = new Date(a.getFullYear(), m + 1, 0, 12); out.push({ from: day(s), to: day(e), label: s.toLocaleDateString('en-CA', { month: 'short' }) }); } }
    return out;
  }
  function shiftAnchor(view, anchor, dir) { const a = new Date(anchor); if (view === 'week') a.setDate(a.getDate() + 7 * dir); else if (view === 'month') a.setMonth(a.getMonth() + dir); else if (view === 'quarter') a.setMonth(a.getMonth() + 3 * dir); else a.setFullYear(a.getFullYear() + dir); return a; }
  // the actual cost per hour of a unit over the last N days (excl. fuel, which Quote prices separately): repairs + payments + driver wages / shift hours
  function realCostPerHour(M, unitName, days) {
    const to = day(Date.now()), from = day(Date.now() - (days || 90) * 86400000), u = M.unitsByName[lc(unitName)] || Object.values(M.unitsById).find(x => x.pricingUnit === unitName);
    const keys = Object.values(M.unitsById).filter(x => x.pricingUnit === unitName || lc(x.name) === lc(unitName)).map(x => String(x.id));
    const uc = unitCosts(M, from, to); let costs = 0, wages = 0, hours = 0;
    keys.forEach(k => { const x = uc[k]; if (x) { costs += x.costs; wages += x.wages; hours += x.hours; } });
    return { from, to, hours: r2(hours), costs: r2(costs), wages: r2(wages), perH: hours ? r2((costs + wages) / hours) : 0, units: keys.length, unit: u };
  }
  window.KFS = { prep, period, series, buckets, shiftAnchor, unitCosts, emptyOf, realCostPerHour, day, r2, num, ms, parse, toT };
})();
