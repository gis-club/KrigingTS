/* eslint no-extend-native: ["error", { "exceptions": ["Array"] }] */

/**
 * 扩展 Array 原型，添加 kriging 算法依赖的工具方法。
 * 这些方法在 grid() 中被隐式调用（如 polygons[i].pip()、variogram.t.min()）。
 */
Array.prototype.max = function () {
  return Math.max.apply(null, this)
}
Array.prototype.min = function () {
  return Math.min.apply(null, this)
}
Array.prototype.mean = function () {
  let i, sum
  for (i = 0, sum = 0; i < this.length; i++) sum += this[i]
  return sum / this.length
}
/**
 * Point-in-Polygon（射线法）
 * 从点 (x, y) 向右发射一条射线，统计与多边形边的交叉次数，奇数次则在内部。
 * this 为 [[x0,y0], [x1,y1], ...] 形式的多边形顶点数组。
 */
Array.prototype.pip = function (x, y) {
  let i
  let j
  let c = false
  for (i = 0, j = this.length - 1; i < this.length; j = i++) {
    if (
      (this[i][1] > y) !== (this[j][1] > y) &&
      x <
        ((this[j][0] - this[i][0]) * (y - this[i][1])) /
          (this[j][1] - this[i][1]) +
          this[i][0]
    ) {
      c = !c
    }
  }
  return c
}

// ======================== 接口定义 ========================

/** 网格计算结果 */
interface IGrid {
  /** 二维数组 list[col][row]，存储每个格网点的预测值（undefined 表示在多边形外） */
  list: Array<Array<number>>;
  /** X 轴（经度）范围 [min, max] */
  xlim: Array<number>;
  /** Y 轴（纬度）范围 [min, max] */
  ylim: Array<number>;
  /** Z 轴（观测值）范围 [min, max] */
  zlim: Array<number>;
  /** 格网单元宽度（与输入 width 一致） */
  width: number;
}

/** 色阶映射项 */
interface IColor {
  min: number;
  max: number;
  color: string;
}

// ======================== 变差函数类 ========================

/**
 * VariogramClass —— 变差函数（Variogram）参数容器与模型计算。
 *
 * 变差函数描述空间相关性随距离衰减的规律，是 Kriging 的核心。
 * 支持三种理论模型：高斯（gaussian）、指数（exponential）、球面（spherical）。
 */
class VariogramClass {
  /** 观测值数组（z 值） */
  t: number[];
  /** 观测点 X 坐标（经度） */
  x: number[];
  /** 观测点 Y 坐标（纬度） */
  y: number[];
  /** 块金值（nugget）：距离为 0 时的半方差，反映微尺度变异和测量误差 */
  nugget: number;
  /** 变程（range）：空间相关性消失的距离阈值 */
  range: number;
  /** 基台值（sill）：半方差趋于稳定的上限值 */
  sill: number;
  /** 模型平滑系数，默认 1/3 */
  A: number;
  /** 观测点数量 */
  n: number;
  /** 逆 Gram 矩阵（n×n 展平为一维），用于预测时计算权重 */
  K: number[];
  /** 预测权重向量（n×1），M = K⁻¹ · t */
  M: number[];
  /** 模型类型标识：'gaussian' | 'exponential' | 'spherical' */
  model: string;

  constructor (
    t: Array<number>,
    x: Array<number>,
    y: Array<number>,
    model: string
  ) {
    this.t = t
    this.x = x
    this.y = y
    this.nugget = 0.0
    this.range = 0.0
    this.sill = 0.0
    this.A = 1 / 3
    this.n = 0
    this.K = [] as number[]
    this.M = [] as number[]
    this.model = model
  }

  /** 高斯变差函数模型：γ(h) = c0 + (c - c0)/a · (1 - exp(-(1/A)·(h/a)²)) */
  krigingVariogramGaussian (
    h: number,
    nugget: number,
    range: number,
    sill: number,
    A: number
  ) {
    return (
      nugget +
      ((sill - nugget) / range) *
        (1.0 - Math.exp(-(1.0 / A) * Math.pow(h / range, 2)))
    )
  }

  /** 指数变差函数模型：γ(h) = c0 + (c - c0)/a · (1 - exp(-(1/A)·(h/a))) */
  krigingVariogramExponential (
    h: number,
    nugget: number,
    range: number,
    sill: number,
    A: number
  ) {
    return (
      nugget +
      ((sill - nugget) / range) * (1.0 - Math.exp(-(1.0 / A) * (h / range)))
    )
  }

  /** 球面变差函数模型：γ(h) = c0 + (c - c0)/a · (1.5·(h/a) - 0.5·(h/a)³)，h > a 时取基台值 */
  krigingVariogramSpherical (
    h: number,
    nugget: number,
    range: number,
    sill: number
  ) {
    if (h > range) return nugget + (sill - nugget) / range
    return (
      nugget +
      ((sill - nugget) / range) *
        (1.5 * (h / range) - 0.5 * Math.pow(h / range, 3))
    )
  }

  /** 根据 model 类型分派调用对应的变差函数模型 */
  judgeType (h: number, nugget: number, range: number, sill: number, A: number) {
    switch (this.model) {
      case 'gaussian':
        return this.krigingVariogramGaussian(h, nugget, range, sill, A)
      case 'exponential':
        return this.krigingVariogramExponential(h, nugget, range, sill, A)
      case 'spherical':
        return this.krigingVariogramExponential(h, nugget, range, sill, A)
      default:
        return 0
    }
  }
}

// ======================== 克里金主类 ========================

/**
 * KrigingClass —— 克里金空间插值算法。
 *
 * 使用流程：
 *   1. train()   —— 根据观测数据拟合变差函数，构建 Gram 矩阵
 *   2. grid()    —— 在多边形区域内按网格逐点预测，使用射线法做 PIP 检测
 *   3. rasterGrid() —— 同 grid()，但使用 Canvas 位图做 PIP 检测，速度更快
 *   4. plot()    —— 将网格预测值渲染到 Canvas 画布上
 */
export default class KrigingClass {

  // ==================== 工具方法 ====================

  /** 创建长度为 n、每个元素均为 value 的数组 */
  createArrayWithValues = (value: number, n: number) => {
    const array = []
    for (let i = 0; i < n; i++) {
      array.push(value)
    }
    return array
  };

  // ==================== 矩阵运算 ====================
  // Kriging 核心依赖线性代数运算，以下均为一维展平的矩阵操作（行优先存储）。

  /** 生成 n×n 对角矩阵，对角线元素为 c */
  krigingMatrixDiag = (c: number, n: number) => {
    const Z = this.createArrayWithValues(0, n * n)
    for (let i = 0; i < n; i++) Z[i * n + i] = c
    return Z
  };

  /** 矩阵转置：n×m → m×n */
  krigingMatrixTranspose = (X: number[], n: number, m: number) => {
    let i
    let j
    const Z = Array(m * n)
    for (i = 0; i < n; i++) for (j = 0; j < m; j++) Z[j * n + i] = X[i * m + j]
    return Z
  };

  /** 矩阵标量乘法：X 的每个元素乘以 c（原地修改） */
  krigingMatrixScale = (X: number[], c: number, n: number, m: number) => {
    let i, j
    for (i = 0; i < n; i++) for (j = 0; j < m; j++) X[i * m + j] *= c
  };

  /** 矩阵加法：Z = X + Y */
  krigingMatrixAdd = (X: number[], Y: number[], n: number, m: number) => {
    let i
    let j
    const Z = Array(n * m)
    for (i = 0; i < n; i++) {
      for (j = 0; j < m; j++) Z[i * m + j] = X[i * m + j] + Y[i * m + j]
    }
    return Z
  };

  /** 矩阵乘法（朴素 O(n·m·p)）：Z(n×p) = X(n×m) · Y(m×p) */
  krigingMatrixMultiply = (
    X: number[],
    Y: number[],
    n: number,
    m: number,
    p: number
  ) => {
    let i
    let j
    let k
    const Z = Array(n * p)
    for (i = 0; i < n; i++) {
      for (j = 0; j < p; j++) {
        Z[i * p + j] = 0
        for (k = 0; k < m; k++) Z[i * p + j] += X[i * m + k] * Y[k * p + j]
      }
    }
    return Z
  };

  /**
   * Cholesky 分解（原地）。
   * 将对称正定矩阵 X 分解为 L·Lᵀ，结果存入 X 的下三角部分。
   * @returns 分解是否成功（矩阵不正定时返回 false）
   */
  krigingMatrixChol = (X: number[], n: number) => {
    let i
    let j
    let k
    const p = Array(n)
    for (i = 0; i < n; i++) p[i] = X[i * n + i]
    for (i = 0; i < n; i++) {
      for (j = 0; j < i; j++) p[i] -= X[i * n + j] * X[i * n + j]
      if (p[i] <= 0) return false
      p[i] = Math.sqrt(p[i])
      for (j = i + 1; j < n; j++) {
        for (k = 0; k < i; k++) X[j * n + i] -= X[j * n + k] * X[i * n + k]
        X[j * n + i] /= p[i]
      }
    }
    for (i = 0; i < n; i++) X[i * n + i] = p[i]
    return true
  };

  /**
   * Cholesky 逆矩阵（原地）。
   * 在 Cholesky 分解之后调用，将 L 变换为 (L·Lᵀ)⁻¹。
   */
  krigingMatrixChol2invl = (X: number[], n: number) => {
    let i, j, k, sum
    for (i = 0; i < n; i++) {
      X[i * n + i] = 1 / X[i * n + i]
      for (j = i + 1; j < n; j++) {
        sum = 0
        for (k = i; k < j; k++) sum -= X[j * n + k] * X[k * n + i]
        X[j * n + i] = sum / X[j * n + j]
      }
    }
    for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) X[i * n + j] = 0
    for (i = 0; i < n; i++) {
      X[i * n + i] *= X[i * n + i]
      for (k = i + 1; k < n; k++) X[i * n + i] += X[k * n + i] * X[k * n + i]
      for (j = i + 1; j < n; j++) {
        for (k = j; k < n; k++) X[i * n + j] += X[k * n + i] * X[k * n + j]
      }
    }
    for (i = 0; i < n; i++) for (j = 0; j < i; j++) X[i * n + j] = X[j * n + i]
  };

  /**
   * Gauss-Jordan 消元法求逆矩阵（原地），作为 Cholesky 分解失败时的备选方案。
   * @returns 是否成功（矩阵奇异时返回 false）
   */
  krigingMatrixSolve = (X: number[], n: number) => {
    const m = n
    const b = Array(n * n)
    const indxc = Array(n)
    const indxr = Array(n)
    const ipiv = Array(n)
    let i = 0
    let icol = 0
    let irow = 0
    let j = 0
    let k = 0
    let l = 0
    let ll = 0
    let big, dum, pivinv, temp

    for (i = 0; i < n; i++) {
      for (j = 0; j < n; j++) {
        if (i === j) b[i * n + j] = 1
        else b[i * n + j] = 0
      }
    }
    for (j = 0; j < n; j++) ipiv[j] = 0
    for (i = 0; i < n; i++) {
      big = 0
      for (j = 0; j < n; j++) {
        if (ipiv[j] !== 1) {
          for (k = 0; k < n; k++) {
            if (ipiv[k] === 0) {
              if (Math.abs(X[j * n + k]) >= big) {
                big = Math.abs(X[j * n + k])
                irow = j
                icol = k
              }
            }
          }
        }
      }
      ++ipiv[icol]

      if (irow !== icol) {
        for (l = 0; l < n; l++) {
          temp = X[irow * n + l]
          X[irow * n + l] = X[icol * n + l]
          X[icol * n + l] = temp
        }
        for (l = 0; l < m; l++) {
          temp = b[irow * n + l]
          b[irow * n + l] = b[icol * n + l]
          b[icol * n + l] = temp
        }
      }
      indxr[i] = irow
      indxc[i] = icol

      if (X[icol * n + icol] === 0) return false

      pivinv = 1 / X[icol * n + icol]
      X[icol * n + icol] = 1
      for (l = 0; l < n; l++) X[icol * n + l] *= pivinv
      for (l = 0; l < m; l++) b[icol * n + l] *= pivinv

      for (ll = 0; ll < n; ll++) {
        if (ll !== icol) {
          dum = X[ll * n + icol]
          X[ll * n + icol] = 0
          for (l = 0; l < n; l++) X[ll * n + l] -= X[icol * n + l] * dum
          for (l = 0; l < m; l++) b[ll * n + l] -= b[icol * n + l] * dum
        }
      }
    }
    for (l = n - 1; l >= 0; l--) {
      if (indxr[l] !== indxc[l]) {
        for (k = 0; k < n; k++) {
          temp = X[k * n + indxr[l]]
          X[k * n + indxr[l]] = X[k * n + indxc[l]]
          X[k * n + indxc[l]] = temp
        }
      }
    }

    return true
  };

  // ==================== 训练 ====================

  /**
   * 训练变差函数模型（贝叶斯先验高斯过程）。
   *
   * 步骤：
   *   1. 计算所有点对的距离和半方差
   *   2. 分箱统计，得到实验变差函数
   *   3. 最小二乘法拟合理论变差函数的 nugget 和 sill
   *   4. 构建 Gram 矩阵并求逆，得到预测权重 M
   *
   * @param t      观测值数组
   * @param x      X 坐标（经度）数组
   * @param y      Y 坐标（纬度）数组
   * @param model  变差函数模型类型：'gaussian' | 'exponential' | 'spherical'
   * @param sigma2 噪声方差（正则化项，防止 Gram 矩阵奇异）
   * @param alpha  先验精度（越大表示越信任数据，越小表示越信任先验）
   * @returns      拟合好的 VariogramClass 实例
   */
  train = (
    t: Array<number>,
    x: Array<number>,
    y: Array<number>,
    model: string,
    sigma2: number,
    alpha: number
  ) => {
    const variogram = new VariogramClass(t, x, y, model)

    // 计算所有点对的欧氏距离和观测值之差（半方差的原始数据）
    let i
    let j
    let k
    let l
    let n = t.length
    const distance = Array((n * n - n) / 2)
    for (i = 0, k = 0; i < n; i++) {
      for (j = 0; j < i; j++, k++) {
        distance[k] = Array(2)
        distance[k][0] = Math.pow(
          Math.pow(x[i] - x[j], 2) + Math.pow(y[i] - y[j], 2),
          0.5
        )
        distance[k][1] = Math.abs(t[i] - t[j])
      }
    }
    distance.sort(function (a, b) {
      return a[0] - b[0]
    })
    variogram.range = distance[(n * n - n) / 2 - 1][0]

    // 分箱统计：将距离分为 lags 个区间，计算每个区间的平均距离和平均半方差
    const lags = (n * n - n) / 2 > 30 ? 30 : (n * n - n) / 2
    const tolerance = variogram.range / lags
    const lag = this.createArrayWithValues(0, lags)
    const semi = this.createArrayWithValues(0, lags)
    if (lags < 30) {
      for (l = 0; l < lags; l++) {
        lag[l] = distance[l][0]
        semi[l] = distance[l][1]
      }
    } else {
      for (
        i = 0, j = 0, k = 0, l = 0;
        i < lags && j < (n * n - n) / 2;
        i++, k = 0
      ) {
        while (distance[j][0] <= (i + 1) * tolerance) {
          lag[l] += distance[j][0]
          semi[l] += distance[j][1]
          j++
          k++
          if (j >= (n * n - n) / 2) break
        }
        if (k > 0) {
          lag[l] /= k
          semi[l] /= k
          l++
        }
      }
      if (l < 2) return variogram
    }

    // 特征变换：将分箱后的 lag 映射到变差函数模型的特征空间
    n = l
    variogram.range = lag[n - 1] - lag[0]
    const X = this.createArrayWithValues(1, 2 * n)
    const Y = Array(n)
    const A = variogram.A
    for (i = 0; i < n; i++) {
      switch (model) {
        case 'gaussian':
          X[i * 2 + 1] =
            1.0 - Math.exp(-(1.0 / A) * Math.pow(lag[i] / variogram.range, 2))
          break
        case 'exponential':
          X[i * 2 + 1] =
            1.0 - Math.exp((-(1.0 / A) * lag[i]) / variogram.range)
          break
        case 'spherical':
          X[i * 2 + 1] =
            1.5 * (lag[i] / variogram.range) -
            0.5 * Math.pow(lag[i] / variogram.range, 3)
          break
      }
      Y[i] = semi[i]
    }

    // 最小二乘法拟合 nugget 和 sill：W = (XᵀX + λI)⁻¹ · Xᵀ · Y
    const Xt = this.krigingMatrixTranspose(X, n, 2)
    let Z = this.krigingMatrixMultiply(Xt, X, 2, n, 2)
    Z = this.krigingMatrixAdd(Z, this.krigingMatrixDiag(1 / alpha, 2), 2, 2)
    const cloneZ = Z.slice(0)
    if (this.krigingMatrixChol(Z, 2)) this.krigingMatrixChol2invl(Z, 2)
    else {
      this.krigingMatrixSolve(cloneZ, 2)
      Z = cloneZ
    }
    const W = this.krigingMatrixMultiply(
      this.krigingMatrixMultiply(Z, Xt, 2, 2, n),
      Y,
      2,
      n,
      1
    )

    // 从最小二乘解中提取变差函数参数
    variogram.nugget = W[0]
    variogram.sill = W[1] * variogram.range + variogram.nugget
    variogram.n = x.length

    // 构建 Gram 矩阵 K：K[i,j] = γ(d(i,j))，即所有观测点对之间的变差函数值
    n = x.length
    let K = Array(n * n)
    for (i = 0; i < n; i++) {
      for (j = 0; j < i; j++) {
        K[i * n + j] = variogram.judgeType(
          Math.pow(Math.pow(x[i] - x[j], 2) + Math.pow(y[i] - y[j], 2), 0.5),
          variogram.nugget,
          variogram.range,
          variogram.sill,
          variogram.A
        )
        K[j * n + i] = K[i * n + j]
      }
      K[i * n + i] = variogram.judgeType(
        0,
        variogram.nugget,
        variogram.range,
        variogram.sill,
        variogram.A
      )
    }

    // 加正则化项后求逆：C = (K + σ²I)⁻¹，再计算预测权重 M = C · t
    let C = this.krigingMatrixAdd(K, this.krigingMatrixDiag(sigma2, n), n, n)
    const cloneC = C.slice(0)
    if (this.krigingMatrixChol(C, n)) this.krigingMatrixChol2invl(C, n)
    else {
      this.krigingMatrixSolve(cloneC, n)
      C = cloneC
    }

    K = C.slice(0)
    const M = this.krigingMatrixMultiply(C, t, n, n, 1)
    variogram.K = K
    variogram.M = M

    return variogram
  };

  // ==================== 预测 ====================

  /**
   * 对单点 (x, y) 进行克里金预测。
   * 计算该点与所有观测点的变差函数值，再与权重 M 做内积。
   */
  predict = (x: number, y: number, variogram: VariogramClass) => {
    let i
    const k = Array(variogram.n)
    for (i = 0; i < variogram.n; i++) {
      k[i] = variogram.judgeType(
        Math.pow(
          Math.pow(x - variogram.x[i], 2) + Math.pow(y - variogram.y[i], 2),
          0.5
        ),
        variogram.nugget,
        variogram.range,
        variogram.sill,
        variogram.A
      )
    }
    return this.krigingMatrixMultiply(k, variogram.M, 1, variogram.n, 1)[0]
  };

  /**
   * 计算单点 (x, y) 的预测方差（用于评估预测不确定性）。
   * variance = γ(0) + kᵀ · K⁻¹ · k
   */
  variance = (x: number, y: number, variogram: VariogramClass) => {
    let i
    const k = Array(variogram.n)
    for (i = 0; i < variogram.n; i++) {
      k[i] = variogram.judgeType(
        Math.pow(
          Math.pow(x - variogram.x[i], 2) + Math.pow(y - variogram.y[i], 2),
          0.5
        ),
        variogram.nugget,
        variogram.range,
        variogram.sill,
        variogram.A
      )
    }
    return (
      variogram.judgeType(
        0,
        variogram.nugget,
        variogram.range,
        variogram.sill,
        variogram.A
      ) +
      this.krigingMatrixMultiply(
        this.krigingMatrixMultiply(k, variogram.K, 1, variogram.n, variogram.n),
        k,
        1,
        variogram.n,
        1
      )[0]
    )
  };

  // ==================== 网格生成 ====================

  /**
   * 标准网格生成（射线法 PIP）。
   *
   * 在 polygons 覆盖的范围内按 width 步长划分格网，
   * 对每个格网点用射线法（Array.prototype.pip）判断是否在多边形内部，
   * 在内部的点调用 predict() 计算预测值。
   *
   * @param polygons  多边形数组，每个多边形为 [[x,y], ...] 形式的顶点环
   * @param variogram train() 返回的变差函数对象
   * @param width     格网步长（单位与坐标一致，越小精度越高但计算量越大）
   * @returns         IGrid 网格结果
   */
  grid = (
    polygons: Array<Array<Array<number>>>,
    variogram: VariogramClass,
    width: number
  ) => {
    let i
    let j
    let k
    const n = polygons.length
    if (n === 0) return

    // 计算所有多边形的全局包围盒
    const xlim = [polygons[0][0][0], polygons[0][0][0]]
    const ylim = [polygons[0][0][1], polygons[0][0][1]]
    for (i = 0; i < n; i++) {
      for (j = 0; j < polygons[i].length; j++) {
        if (polygons[i][j][0] < xlim[0]) xlim[0] = polygons[i][j][0]
        if (polygons[i][j][0] > xlim[1]) xlim[1] = polygons[i][j][0]
        if (polygons[i][j][1] < ylim[0]) ylim[0] = polygons[i][j][1]
        if (polygons[i][j][1] > ylim[1]) ylim[1] = polygons[i][j][1]
      }
    }

    // 分配格网二维数组
    let xtarget, ytarget
    const a = Array(2)
    const b = Array(2)
    const lxlim = Array(2)
    const lylim = Array(2)
    const x = Math.ceil((xlim[1] - xlim[0]) / width)
    const y = Math.ceil((ylim[1] - ylim[0]) / width)

    const A: IGrid = {
      list: Array(x + 1),
      xlim: Array<number>(2),
      ylim: Array<number>(2),
      zlim: Array<number>(2),
      width: 0
    }
    for (i = 0; i <= x; i++) A.list[i] = Array(y + 1)

    // 逐个多边形处理
    for (i = 0; i < n; i++) {
      // 计算当前多边形的局部包围盒
      lxlim[0] = polygons[i][0][0]
      lxlim[1] = lxlim[0]
      lylim[0] = polygons[i][0][1]
      lylim[1] = lylim[0]
      for (j = 1; j < polygons[i].length; j++) {
        if (polygons[i][j][0] < lxlim[0]) lxlim[0] = polygons[i][j][0]
        if (polygons[i][j][0] > lxlim[1]) lxlim[1] = polygons[i][j][0]
        if (polygons[i][j][1] < lylim[0]) lylim[0] = polygons[i][j][1]
        if (polygons[i][j][1] > lylim[1]) lylim[1] = polygons[i][j][1]
      }

      // 将局部包围盒映射到格网索引范围
      a[0] = Math.floor(
        (lxlim[0] - ((lxlim[0] - xlim[0]) % width) - xlim[0]) / width
      )
      a[1] = Math.ceil(
        (lxlim[1] - ((lxlim[1] - xlim[1]) % width) - xlim[0]) / width
      )
      b[0] = Math.floor(
        (lylim[0] - ((lylim[0] - ylim[0]) % width) - ylim[0]) / width
      )
      b[1] = Math.ceil(
        (lylim[1] - ((lylim[1] - ylim[1]) % width) - ylim[0]) / width
      )

      // 遍历格网，射线法判定 + 预测
      for (j = a[0]; j <= a[1]; j++) {
        for (k = b[0]; k <= b[1]; k++) {
          xtarget = xlim[0] + j * width
          ytarget = ylim[0] + k * width
          if (polygons[i].pip(xtarget, ytarget)) {
            A.list[j][k] = this.predict(xtarget, ytarget, variogram)
          }
        }
      }
    }
    A.xlim = xlim
    A.ylim = ylim
    A.zlim = [variogram.t.min(), variogram.t.max()]
    A.width = width
    return A
  };

  // ==================== 位图加速 PIP ====================

  /**
   * 创建位图点-in-多边形查询函数。
   *
   * 原理：将多边形光栅化到一张离屏 Canvas 上（黑色填充多边形，绿色填充背景），
   * 然后读取像素数据缓存到 Uint8ClampedArray 中。
   * 查询时直接通过像素坐标索引读取 RGBA 值，O(1) 时间判定。
   *
   * 相比射线法（每次查询 O(v)，v 为多边形顶点数），
   * 位图法在大量格网点查询场景下有显著性能优势。
   *
   * @param width   位图宽度（像素），应覆盖格网 X 方向的索引范围
   * @param height  位图高度（像素），应覆盖格网 Y 方向的索引范围
   * @param polygon 多边形顶点，已转换为格网索引坐标 [[col, row], ...]
   * @returns       查询函数 (col, row) => boolean
   */
  private createBitmapPip = (width: number, height: number, polygon: number[][]) => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!

    // 背景填充绿色（非多边形区域标记）
    ctx.fillStyle = 'rgba(0, 255, 0, 255)'
    ctx.fillRect(0, 0, width, height)

    // 绘制多边形路径并填充黑色（多边形内部标记）
    ctx.beginPath()
    for (let i = 0; i < polygon.length; i++) {
      const [x, y] = polygon[i]
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.fillStyle = 'rgba(0, 0, 0, 255)'
    ctx.fill()

    // 一次性读取所有像素数据到内存，后续查询零 DOM 访问
    const imgData = ctx.getImageData(0, 0, width, height)
    const w = imgData.width
    const h = imgData.height
    const pixels = imgData.data

    return (x: number, y: number): boolean => {
      const tx = Math.round(x < 0 ? 0 : x >= w ? w - 1 : x)
      const ty = Math.round(y < 0 ? 0 : y >= h ? h - 1 : y)
      const idx = (w * ty + tx) * 4
      return pixels[idx] === 0 && pixels[idx + 1] === 0 && pixels[idx + 2] === 0 && pixels[idx + 3] === 255
    }
  };

  /**
   * 光栅化加速网格生成（位图法 PIP）。
   *
   * 逻辑与 grid() 完全一致，唯一区别：
   *   - grid() 对每个格网点调用射线法 pip()（O(v)/次）
   *   - rasterGrid() 先将多边形光栅化为位图，再用 O(1) 像素查询替代
   *
   * 当格网点数量远大于多边形顶点数时，性能提升显著。
   *
   * @param polygons  多边形数组
   * @param variogram train() 返回的变差函数对象
   * @param width     格网步长
   * @returns         IGrid 网格结果（与 grid() 返回格式一致）
   */
  rasterGrid = (
    polygons: Array<Array<Array<number>>>,
    variogram: VariogramClass,
    width: number
  ) => {
    let i
    let j
    let k
    const n = polygons.length
    if (n === 0) return

    const xlim = [polygons[0][0][0], polygons[0][0][0]]
    const ylim = [polygons[0][0][1], polygons[0][0][1]]
    for (i = 0; i < n; i++) {
      for (j = 0; j < polygons[i].length; j++) {
        if (polygons[i][j][0] < xlim[0]) xlim[0] = polygons[i][j][0]
        if (polygons[i][j][0] > xlim[1]) xlim[1] = polygons[i][j][0]
        if (polygons[i][j][1] < ylim[0]) ylim[0] = polygons[i][j][1]
        if (polygons[i][j][1] > ylim[1]) ylim[1] = polygons[i][j][1]
      }
    }

    let xtarget, ytarget
    const a = Array(2)
    const b = Array(2)
    const lxlim = Array(2)
    const lylim = Array(2)
    const x = Math.ceil((xlim[1] - xlim[0]) / width)
    const y = Math.ceil((ylim[1] - ylim[0]) / width)

    const A: IGrid = {
      list: Array(x + 1),
      xlim: Array<number>(2),
      ylim: Array<number>(2),
      zlim: Array<number>(2),
      width: 0
    }
    for (i = 0; i <= x; i++) A.list[i] = Array(y + 1)
    for (i = 0; i < n; i++) {
      lxlim[0] = polygons[i][0][0]
      lxlim[1] = lxlim[0]
      lylim[0] = polygons[i][0][1]
      lylim[1] = lylim[0]
      for (j = 1; j < polygons[i].length; j++) {
        if (polygons[i][j][0] < lxlim[0]) lxlim[0] = polygons[i][j][0]
        if (polygons[i][j][0] > lxlim[1]) lxlim[1] = polygons[i][j][0]
        if (polygons[i][j][1] < lylim[0]) lylim[0] = polygons[i][j][1]
        if (polygons[i][j][1] > lylim[1]) lylim[1] = polygons[i][j][1]
      }

      a[0] = Math.floor(
        (lxlim[0] - ((lxlim[0] - xlim[0]) % width) - xlim[0]) / width
      )
      a[1] = Math.ceil(
        (lxlim[1] - ((lxlim[1] - xlim[1]) % width) - xlim[0]) / width
      )
      b[0] = Math.floor(
        (lylim[0] - ((lylim[0] - ylim[0]) % width) - ylim[0]) / width
      )
      b[1] = Math.ceil(
        (lylim[1] - ((lylim[1] - ylim[1]) % width) - ylim[0]) / width
      )

      // 将多边形地理坐标转换为格网索引坐标，构建位图 PIP 查询器
      const transPolygon = polygons[i].map(([px, py]) => [
        Math.floor((px - xlim[0]) / width),
        Math.floor((py - ylim[0]) / width)
      ])
      const bitmapPip = this.createBitmapPip(a[1] + 1, b[1] + 1, transPolygon)

      // 遍历格网，位图 O(1) 判定 + 预测
      for (j = a[0]; j <= a[1]; j++) {
        for (k = b[0]; k <= b[1]; k++) {
          xtarget = xlim[0] + j * width
          ytarget = ylim[0] + k * width
          if (bitmapPip(j, k)) {
            A.list[j][k] = this.predict(xtarget, ytarget, variogram)
          }
        }
      }
    }
    A.xlim = xlim
    A.ylim = ylim
    A.zlim = [variogram.t.min(), variogram.t.max()]
    A.width = width
    return A
  };

  // ==================== 渲染 ====================

  /**
   * 将网格预测结果渲染到 Canvas 画布上。
   *
   * 遍历 grid 的每个有值单元，根据其预测值查找对应颜色，
   * 在画布对应位置绘制一个矩形色块。
   *
   * @param canvas 目标画布
   * @param grid   grid() 或 rasterGrid() 返回的网格数据
   * @param xlim   X 轴显示范围 [min, max]
   * @param ylim   Y 轴显示范围 [min, max]
   * @param colors 色阶映射数组
   */
  plot = (
    canvas: HTMLCanvasElement,
    grid: IGrid,
    xlim: Array<number>,
    ylim: Array<number>,
    colors: Array<IColor>
  ) => {
    const ctx = canvas.getContext('2d')
    ctx && ctx.clearRect(0, 0, canvas.width, canvas.height)
    const range = [
      xlim[1] - xlim[0],
      ylim[1] - ylim[0],
      grid.zlim[1] - grid.zlim[0]
    ]
    let i, j, x, y, z
    const n = grid.list.length
    const m = grid.list[0].length
    // 每个格网单元在画布上的像素尺寸
    const wx = Math.ceil((grid.width * canvas.width) / (xlim[1] - xlim[0]))
    const wy = Math.ceil((grid.width * canvas.height) / (ylim[1] - ylim[0]))
    for (i = 0; i < n; i++) {
      for (j = 0; j < m; j++) {
        if (grid.list[i][j] === undefined) continue
        // 将格网索引映射到画布像素坐标
        x =
          (canvas.width * (i * grid.width + grid.xlim[0] - xlim[0])) / range[0]
        y =
          canvas.height *
          (1 - (j * grid.width + grid.ylim[0] - ylim[0]) / range[1])
        z = (grid.list[i][j] - grid.zlim[0]) / range[2]
        if (z < 0.0) z = 0.0
        if (z > 1.0) z = 1.0
        if (ctx) {
          ctx.fillStyle = this.getColor(colors, grid.list[i][j])
        }
        ctx &&
          ctx.fillRect(Math.round(x - wx / 2), Math.round(y - wy / 2), wx, wy)
      }
    }
  };

  /**
   * 根据原始值 z 在色阶表中查找对应颜色。
   * 线性扫描 colors 数组，返回第一个满足 min <= z < max 的 color 值。
   */
  getColor = (colors: Array<IColor>, z: number) => {
    const l = colors.length
    for (let i = 0; i < l; i++) {
      if (z >= colors[i].min && z < colors[i].max) return colors[i].color
    }
    if (z < 0) {
      return colors[0].color
    } else {
      return ''
    }
  };
}
