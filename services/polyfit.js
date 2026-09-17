/**
 * Подгонка полиномов AHRI/EN12900 (10 коэффициентов) под физическую модель
 * объёмного компрессора. Используется для наполнения каталога моделями,
 * у которых нет готовых коэффициентов от производителя (Bitzer, Copeland и др.),
 * чтобы обеспечить работу всех типов компрессоров (спиральный/винтовой/поршневой).
 *
 * Модель:
 *   Q0 [кВт] = Vh [м³/ч] / 3600 · ηv · ρвс · Δh0
 *   N  [кВт] = Q0 / COP_pack
 *
 * Формула полинома: Y = C1+C2·S+C3·D+C4·S²+C5·S·D+C6·D²+C7·S³+C8·D·S²+C9·S·D²+C10·D³
 * S — t кипения (°C), D — t конденсации (°C).
 */
'use strict';

const refr = require('./refrigerants');

/** Объёмный КПД в зависимости от типа и степени сжатия */
function volumetricEff(type, ratio) {
  const c = type === 'screw' ? 0.035 : type === 'recip' ? 0.055 : 0.045; // scroll
  return Math.max(0.55, 1 - c * (ratio - 1));
}

/** Физическая модель: холодопроизводительность (кВт) в точке (tevap, tcond) */
function modelCapacity({ type, refrigerant, displacement, tEvap, tCond, dTsh = 10 }) {
  const pe = refr.psatBar(refrigerant, tEvap);
  const pc = refr.psatBar(refrigerant, tCond);
  const ratio = Math.max(pc / pe, 1.01);
  const etaV = volumetricEff(type, ratio);
  const rho = refr.rhoSuction(refrigerant, tEvap, dTsh);           // кг/м³
  const dh0 = refr.hVaporSuperheated(refrigerant, tEvap, tEvap + dTsh) -
              refr.hLiquid(refrigerant, tCond);                     // кДж/кг
  const mdot = (displacement / 3600) * etaV * rho;                  // кг/с
  return Math.max(mdot * dh0, 0.01);                                // кВт
}

/** Оценка COP с учётом степени сжатия (упрощённо) */
function modelCOP(type, ratio) {
  const base = type === 'screw' ? 3.4 : type === 'recip' ? 3.0 : 3.2;
  return Math.max(1.05, base - 0.09 * (ratio - 1) * (ratio - 1));
}

/** Полиномиальная база для точки (S, D) */
function basis(S, D) {
  return [1, S, D, S * S, S * D, D * D, S * S * S, D * S * S, S * D * D, D * D * D];
}

/** Решение системы линейных уравнений методом Гаусса с частичным выбором */
function solveLinear(M, v) {
  const n = v.length;
  const a = M.map((row, i) => [...row, v[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[piv][col])) piv = r;
    [a[col], a[piv]] = [a[piv], a[col]];
    const d = a[col][col] || 1e-12;
    for (let r = col + 1; r < n; r++) {
      const f = a[r][col] / d;
      for (let c = col; c <= n; c++) a[r][c] -= f * a[col][c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = a[r][n];
    for (let c = r + 1; c < n; c++) s -= a[r][c] * x[c];
    x[r] = s / (a[r][r] || 1e-12);
  }
  return x.map(v => +v.toFixed(10));
}

/** МНК-подгонка по сетке точек для произвольной функции f(S,D) */
function fitGrid(fn, tGrid, dGrid) {
  const A = [], b = [];
  for (const S of tGrid) for (const D of dGrid) { A.push(basis(S, D)); b.push(fn(S, D)); }
  const n = 10;
  const AtA = Array.from({ length: n }, () => new Array(n).fill(0));
  const Atb = new Array(n).fill(0);
  for (let r = 0; r < A.length; r++) {
    for (let i = 0; i < n; i++) {
      Atb[i] += A[r][i] * b[r];
      for (let j = 0; j < n; j++) AtA[i][j] += A[r][i] * A[r][j];
    }
  }
  return solveLinear(AtA, Atb);
}

/** Генерация коэффициентов capacity + power для модели */
function generatePolyCoeffs({ type, refrigerant, displacement, dTsh = 10 }) {
  const tGrid = [-40, -30, -20, -10, 0, 5];
  const dGrid = [20, 30, 40, 50, 55];
  const cap = fitGrid((S, D) => modelCapacity({ type, refrigerant, displacement, tEvap: S, tCond: D, dTsh }), tGrid, dGrid);
  const pow = fitGrid((S, D) => {
    const pe = refr.psatBar(refrigerant, S), pc = refr.psatBar(refrigerant, D);
    const ratio = Math.max(pc / pe, 1.01);
    return modelCapacity({ type, refrigerant, displacement, tEvap: S, tCond: D, dTsh }) / modelCOP(type, ratio);
  }, tGrid, dGrid);
  return { polyCapacity: cap, polyPower: pow };
}

module.exports = { modelCapacity, generatePolyCoeffs, fitGrid };
