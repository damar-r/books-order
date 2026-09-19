/**
 * calc.js
 * Engine perhitungan incentive agent.
 *
 * Konsep:
 * - Threshold: daftar tingkat pencapaian (TH0..TH4), tiap tingkat punya cutoff
 *   persentase achievement (mis. TH0=0%, TH1=50%, TH2=75%, TH3=100%, TH4=125%).
 * - Rate incentive per produk berbeda-beda di tiap threshold.
 * - Threshold yang "aktif" untuk seorang agent = threshold tertinggi yang
 *   cutoff-nya masih <= achievement agent (achievement = total revenue / target).
 * - Incentive = SUM( revenue_produk * rate_produk_di_threshold_aktif )
 *
 * Reverse calculation:
 * - Agent tahu revenue saat ini per produk (baseline) dan mau tahu berapa
 *   tambahan revenue (di produk yang paling banyak dia jual) supaya incentive
 *   yang didapat = incentive yang diinginkan.
 * - Karena threshold aktif tergantung achievement (yang tergantung revenue),
 *   kita coba tiap threshold sebagai asumsi "threshold akhir", hitung berapa
 *   tambahan revenue dibutuhkan supaya incentive tercapai DENGAN asumsi itu,
 *   lalu cek apakah achievement hasil akhir benar2 jatuh di band threshold itu.
 *   Hanya solusi yang konsisten yang ditampilkan.
 */

/** Urutkan daftar threshold berdasarkan cutoff ascending. */
function sortedThresholds(thresholds) {
  return [...thresholds].sort((a, b) => a.cutoff - b.cutoff);
}

/** Cari threshold aktif berdasarkan % achievement (0.75 = 75%, dst). */
function getActiveThreshold(thresholds, achievement) {
  const sorted = sortedThresholds(thresholds);
  let active = sorted[0];
  for (const th of sorted) {
    if (achievement >= th.cutoff) {
      active = th;
    }
  }
  return active;
}

/** Band [cutoffBawah, cutoffAtas) untuk sebuah threshold key. */
function thresholdBand(thresholds, key) {
  const sorted = sortedThresholds(thresholds);
  const idx = sorted.findIndex((t) => t.key === key);
  const lower = sorted[idx].cutoff;
  const upper = idx + 1 < sorted.length ? sorted[idx + 1].cutoff : Infinity;
  return { lower, upper };
}

/**
 * Forward calculation: dari revenue per produk -> incentive.
 * @param {Object} params
 * @param {Object<string, number>} params.revenueByProduct - revenue per nama produk
 * @param {number} params.target - target revenue minggu ini
 * @param {Array<{key:string, cutoff:number}>} params.thresholds
 * @param {Object<string, Object<string, number>>} params.rates - rates[productName][thresholdKey] = rate
 */
function calculateIncentive({ revenueByProduct, target, thresholds, rates }) {
  const totalRevenue = Object.values(revenueByProduct).reduce((a, b) => a + b, 0);
  const achievement = target > 0 ? totalRevenue / target : 0;
  const activeThreshold = getActiveThreshold(thresholds, achievement);

  let incentive = 0;
  const breakdown = {};
  for (const [product, revenue] of Object.entries(revenueByProduct)) {
    const rate = (rates[product] && rates[product][activeThreshold.key]) || 0;
    const productIncentive = revenue * rate;
    incentive += productIncentive;
    breakdown[product] = { revenue, rate, incentive: productIncentive };
  }

  return {
    totalRevenue,
    achievement,
    activeThreshold,
    incentive,
    breakdown,
  };
}

/**
 * Reverse calculation: dari incentive yang diinginkan -> tambahan revenue
 * per produk yang dibutuhkan, diprioritaskan ke produk dengan baseline
 * revenue terbesar (produk yang paling banyak dijual agent).
 *
 * @param {Object} params
 * @param {Object<string, number>} params.baselineRevenue - revenue aktual saat ini per produk
 * @param {number} params.target
 * @param {number} params.desiredIncentive
 * @param {Array<{key:string, cutoff:number}>} params.thresholds
 * @param {Object<string, Object<string, number>>} params.rates
 * @returns {Object} hasil dengan daftar solusi yang valid per threshold, dan `recommended`
 */
function calculateRequiredRevenue({ baselineRevenue, target, desiredIncentive, thresholds, rates }) {
  const products = Object.keys(baselineRevenue);
  const totalBaseline = products.reduce((sum, p) => sum + (baselineRevenue[p] || 0), 0);
  const baselineAchievement = target > 0 ? totalBaseline / target : 0;

  // Cek dulu: apakah incentive yang diinginkan sudah tercapai dengan revenue saat ini?
  const currentResult = calculateIncentive({ revenueByProduct: baselineRevenue, target, thresholds, rates });
  if (currentResult.incentive >= desiredIncentive) {
    return {
      alreadyAchieved: true,
      current: currentResult,
      solutions: [],
      recommended: null,
    };
  }

  // Urutkan produk berdasarkan baseline revenue terbesar -> terkecil (prioritas alokasi)
  const priorityOrder = [...products].sort(
    (a, b) => (baselineRevenue[b] || 0) - (baselineRevenue[a] || 0)
  );

  const sorted = sortedThresholds(thresholds);
  const solutions = [];

  for (const th of sorted) {
    // Incentive yang sudah didapat dari baseline revenue, DIHITUNG di rate threshold ini
    const baselineIncentiveAtThisTier = products.reduce((sum, p) => {
      const rate = (rates[p] && rates[p][th.key]) || 0;
      return sum + (baselineRevenue[p] || 0) * rate;
    }, 0);

    let remainingIncentiveNeeded = desiredIncentive - baselineIncentiveAtThisTier;
    if (remainingIncentiveNeeded < 0) remainingIncentiveNeeded = 0;

    // Alokasikan tambahan revenue ke produk berprioritas (baseline terbesar dulu)
    // yang punya rate > 0 di threshold ini. Kalau produk prioritas #1 rate-nya 0,
    // lanjut ke produk berikutnya.
    const extraByProduct = {};
    for (const p of products) extraByProduct[p] = 0;

    let allocationTarget = null;
    for (const p of priorityOrder) {
      const rate = (rates[p] && rates[p][th.key]) || 0;
      if (rate > 0) {
        allocationTarget = p;
        break;
      }
    }

    let feasible = true;
    if (remainingIncentiveNeeded > 0) {
      if (!allocationTarget) {
        feasible = false; // tidak ada produk dengan rate > 0 di threshold ini
      } else {
        const rate = rates[allocationTarget][th.key];
        extraByProduct[allocationTarget] = remainingIncentiveNeeded / rate;
      }
    }

    const extraTotal = Object.values(extraByProduct).reduce((a, b) => a + b, 0);
    const finalTotalRevenue = totalBaseline + extraTotal;
    const finalAchievement = target > 0 ? finalTotalRevenue / target : 0;
    const band = thresholdBand(thresholds, th.key);

    // Solusi hanya valid kalau achievement akhir benar2 berada di band threshold ini
    const consistent = finalAchievement >= band.lower && finalAchievement < band.upper;

    if (feasible && consistent) {
      solutions.push({
        thresholdKey: th.key,
        thresholdCutoff: th.cutoff,
        allocationTarget,
        extraByProduct,
        extraTotal,
        finalTotalRevenue,
        finalAchievement,
        finalRevenueByProduct: Object.fromEntries(
          products.map((p) => [p, (baselineRevenue[p] || 0) + extraByProduct[p]])
        ),
      });
    }
  }

  // Rekomendasi: solusi dengan tambahan revenue paling kecil (paling efisien)
  const recommended =
    solutions.length > 0
      ? solutions.reduce((best, s) => (s.extraTotal < best.extraTotal ? s : best))
      : null;

  return {
    alreadyAchieved: false,
    current: currentResult,
    baselineAchievement,
    solutions,
    recommended,
  };
}

if (typeof module !== 'undefined') {
  module.exports = {
    getActiveThreshold,
    thresholdBand,
    calculateIncentive,
    calculateRequiredRevenue,
    sortedThresholds,
  };
}
