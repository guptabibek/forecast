/**
 * Minimal linear-algebra helpers for the forecast models.
 *
 * These are intentionally dependency-free (pure TypeScript) so the engine has
 * no native build requirements. They cover what the Prophet and SARIMA models
 * need: solving a dense linear system and ridge-regularised least squares.
 */

/**
 * Solve the linear system A x = b using Gaussian elimination with partial
 * pivoting. `A` is an n×n matrix (row-major), `b` has length n.
 * Returns the solution vector, or null if the system is singular.
 */
export function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  // Work on copies so callers keep their inputs.
  const M = A.map((row) => row.slice());
  const x = b.slice();

  for (let col = 0; col < n; col++) {
    // Partial pivot: find the row with the largest magnitude in this column.
    let pivot = col;
    let maxAbs = Math.abs(M[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(M[r][col]);
      if (v > maxAbs) {
        maxAbs = v;
        pivot = r;
      }
    }

    if (maxAbs < 1e-12) {
      return null; // singular (or near-singular)
    }

    if (pivot !== col) {
      [M[col], M[pivot]] = [M[pivot], M[col]];
      [x[col], x[pivot]] = [x[pivot], x[col]];
    }

    // Eliminate below.
    for (let r = col + 1; r < n; r++) {
      const factor = M[r][col] / M[col][col];
      if (factor === 0) continue;
      for (let c = col; c < n; c++) {
        M[r][c] -= factor * M[col][c];
      }
      x[r] -= factor * x[col];
    }
  }

  // Back-substitution.
  const sol = new Array(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = x[row];
    for (let c = row + 1; c < n; c++) {
      sum -= M[row][c] * sol[c];
    }
    sol[row] = sum / M[row][row];
  }

  return sol;
}

/**
 * Ridge-regularised ordinary least squares.
 *
 * Solves (XᵀX + λI) β = Xᵀy for the coefficient vector β, given the design
 * matrix `X` (m rows × p columns) and target `y` (length m). The ridge penalty
 * λ stabilises the fit when columns are collinear (e.g. many changepoints or
 * Fourier terms). `penalizeIntercept = false` leaves column 0 unregularised.
 * Returns the coefficients, or a zero vector if the system is singular.
 */
export function ridgeRegression(
  X: number[][],
  y: number[],
  lambda = 1e-6,
  penalizeIntercept = false,
): number[] {
  const m = X.length;
  const p = m > 0 ? X[0].length : 0;
  if (m === 0 || p === 0) return new Array(p).fill(0);

  // Normal equations: XtX (p×p) and Xty (p).
  const XtX: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  const Xty: number[] = new Array(p).fill(0);

  for (let i = 0; i < m; i++) {
    const row = X[i];
    const yi = y[i];
    for (let a = 0; a < p; a++) {
      Xty[a] += row[a] * yi;
      for (let b = a; b < p; b++) {
        XtX[a][b] += row[a] * row[b];
      }
    }
  }
  // Mirror the symmetric lower triangle.
  for (let a = 0; a < p; a++) {
    for (let b = a + 1; b < p; b++) {
      XtX[b][a] = XtX[a][b];
    }
  }

  // Add the ridge penalty on the diagonal.
  for (let a = 0; a < p; a++) {
    if (a === 0 && !penalizeIntercept) continue;
    XtX[a][a] += lambda;
  }

  const beta = solveLinearSystem(XtX, Xty);
  return beta ?? new Array(p).fill(0);
}

/** Sample standard deviation of residuals (population form, guarded). */
export function residualStd(residuals: number[]): number {
  if (!residuals.length) return 0;
  const variance =
    residuals.reduce((sum, r) => sum + r * r, 0) / residuals.length;
  return Math.sqrt(Math.max(variance, 0));
}

/** Standard-normal z-score for the common confidence levels. */
export function zScore(level: number): number {
  if (level >= 99) return 2.576;
  if (level >= 95) return 1.96;
  if (level >= 90) return 1.645;
  return 1.28;
}
