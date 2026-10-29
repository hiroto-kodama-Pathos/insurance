// 協会けんぽの保険料額表の等級（健康保険50等級・厚生年金32等級）
// エミュレータのシード（seed-emulator.mjs）と、本番への投入（load-grades.mjs）の両方で使う。
// 改定があったときは、新しい適用開始月の表をここに足し、load-grades.mjs で投入する。

/** この表の適用開始月（厚生年金の32等級は2020年9月分から） */
export const GRADES_VALID_FROM = '2020-09';

// [標準報酬月額, 報酬月額の下限]（健康保険の1等級から順に）
const BOUNDS = [
  [58000, 0], [68000, 63000], [78000, 73000], [88000, 83000], [98000, 93000],
  [104000, 101000], [110000, 107000], [118000, 114000], [126000, 122000], [134000, 130000],
  [142000, 138000], [150000, 146000], [160000, 155000], [170000, 165000], [180000, 175000],
  [190000, 185000], [200000, 195000], [220000, 210000], [240000, 230000], [260000, 250000],
  [280000, 270000], [300000, 290000], [320000, 310000], [340000, 330000], [360000, 350000],
  [380000, 370000], [410000, 395000], [440000, 425000], [470000, 455000], [500000, 485000],
  [530000, 515000], [560000, 545000], [590000, 575000], [620000, 605000], [650000, 635000],
  [680000, 665000], [710000, 695000], [750000, 730000], [790000, 770000], [830000, 810000],
  [880000, 855000], [930000, 905000], [980000, 955000], [1030000, 1005000], [1090000, 1055000],
  [1150000, 1115000], [1210000, 1175000], [1270000, 1235000], [1330000, 1295000], [1390000, 1355000],
];

/** grades コレクションに入れるドキュメント（IDと中身） */
export function kyokaiGradeDocs(validFrom = GRADES_VALID_FROM) {
  return BOUNDS.map(([standardAmount, lowerLimit], i) => {
    const healthGrade = i + 1;
    return {
      id: `${validFrom}-${String(healthGrade).padStart(2, '0')}`,
      data: {
        validFrom,
        healthGrade,
        // 厚生年金の等級は、健康保険の4〜35等級に対応する（1〜32等級）
        pensionGrade: healthGrade >= 4 && healthGrade <= 35 ? healthGrade - 3 : null,
        lowerLimit,
        upperLimit: BOUNDS[i + 1] ? BOUNDS[i + 1][1] : null,
        standardAmount,
      },
    };
  });
}

/**
 * gradeThresholds（最高等級・最低等級付近の随時改定の特例の閾値。設計書 2.14）に入れるドキュメント
 * 等級表の版と同じ適用開始月で、健康保険・厚生年金それぞれ1件
 */
export function kyokaiThresholdDocs(validFrom = GRADES_VALID_FROM) {
  return [
    { id: `${validFrom}-health`, data: { validFrom, insuranceType: 'health', maxGrade: 50, upper: 1415000, lower: 53000, topLower: 1355000, secondLower: 63000 } },
    { id: `${validFrom}-pension`, data: { validFrom, insuranceType: 'pension', maxGrade: 32, upper: 665000, lower: 83000, topLower: 635000, secondLower: 93000 } },
  ];
}
