/* Knight Forestry v14: yard stock per yard + species + product at WEIGHTED AVERAGE cost (same maths as the company script).
   Logs are counted in tonnes (cost per tonne), Split in cords (cost per cord). Pending and Void rows never count. */
(function () {
  var num = function (v) { var n = Number(v); return isFinite(n) ? n : 0; };
  var counts = function (r) { var s = String(r.status || ''); return s !== 'Pending' && s !== 'Void'; };
  function stock(rows, yard, species, product) {
    var split = product === 'Split', q = 0, val = 0, lastAvg = 0;
    rows.filter(function (r) { return r.yard === yard && String(r.species) === String(species) && String(r.product || 'Logs') === (split ? 'Split' : 'Logs') && counts(r); })
      .sort(function (a, b) { return new Date(a.timestamp) - new Date(b.timestamp); }).forEach(function (r) {
        var qty = split ? num(r.cords) : num(r.tonnes), unit = split ? (num(r.costPerCord) || num(r.pricePerCord)) : (num(r.costPerTonne) || num(r.pricePerTonne));
        if (r.type === 'Out') { var avg = q > 0 ? val / q : lastAvg; q -= qty; val -= qty * avg; if (q <= 0) val = 0; }
        else if (qty >= 0) { if (q < 0) { q += qty; val = Math.max(q, 0) * unit; } else { q += qty; val += qty * unit; } if (unit) lastAvg = unit; }
        else { var a2 = q > 0 ? val / q : lastAvg; q += qty; val += qty * a2; }
        if (q > 0) lastAvg = val / q || lastAvg;
      });
    return { qty: Math.round(q * 100) / 100, avg: q > 0 ? Math.round(val / q * 100) / 100 : Math.round(lastAvg * 100) / 100 };
  }
  // every yard|species|product -> { qty, avg }
  function all(rows) {
    var out = {}; (rows || []).forEach(function (r) { if (!r.yard || !r.species) return; var k = r.yard + '|' + r.species + '|' + (r.product || 'Logs'); if (!out[k]) out[k] = stock(rows, r.yard, r.species, r.product || 'Logs'); });
    return out;
  }
  window.kfStock = { stock: stock, all: all, counts: counts };
})();
