export type DeepSeekWallpaperPlanEntry = {
  id: string;
  gender: 'female' | 'male';
  style: 'chibi' | 'normal';
  characterKey:
    | 'deepseek_f_01'
    | 'deepseek_f_02'
    | 'deepseek_f_03'
    | 'deepseek_f_04'
    | 'deepseek_m_01'
    | 'deepseek_m_02'
    | 'deepseek_m_03'
    | 'deepseek_m_04';
  composition: 'env' | 'close';
};

export const DEEPSEEK_WALLPAPER_PLAN = [
  { id: 'deepseek-fq01', gender: 'female', style: 'chibi', characterKey: 'deepseek_f_01', composition: 'env' },
  { id: 'deepseek-fq02', gender: 'female', style: 'chibi', characterKey: 'deepseek_f_01', composition: 'close' },
  { id: 'deepseek-fq03', gender: 'female', style: 'chibi', characterKey: 'deepseek_f_02', composition: 'env' },
  { id: 'deepseek-fq04', gender: 'female', style: 'chibi', characterKey: 'deepseek_f_02', composition: 'close' },
  { id: 'deepseek-fq05', gender: 'female', style: 'chibi', characterKey: 'deepseek_f_03', composition: 'env' },
  { id: 'deepseek-fq06', gender: 'female', style: 'chibi', characterKey: 'deepseek_f_03', composition: 'close' },
  { id: 'deepseek-fq07', gender: 'female', style: 'chibi', characterKey: 'deepseek_f_04', composition: 'env' },
  { id: 'deepseek-fq08', gender: 'female', style: 'chibi', characterKey: 'deepseek_f_04', composition: 'close' },
  { id: 'deepseek-fn01', gender: 'female', style: 'normal', characterKey: 'deepseek_f_01', composition: 'env' },
  { id: 'deepseek-fn02', gender: 'female', style: 'normal', characterKey: 'deepseek_f_01', composition: 'close' },
  { id: 'deepseek-fn03', gender: 'female', style: 'normal', characterKey: 'deepseek_f_01', composition: 'env' },
  { id: 'deepseek-fn04', gender: 'female', style: 'normal', characterKey: 'deepseek_f_02', composition: 'close' },
  { id: 'deepseek-fn05', gender: 'female', style: 'normal', characterKey: 'deepseek_f_02', composition: 'close' },
  { id: 'deepseek-fn06', gender: 'female', style: 'normal', characterKey: 'deepseek_f_02', composition: 'env' },
  { id: 'deepseek-fn07', gender: 'female', style: 'normal', characterKey: 'deepseek_f_03', composition: 'env' },
  { id: 'deepseek-fn08', gender: 'female', style: 'normal', characterKey: 'deepseek_f_03', composition: 'close' },
  { id: 'deepseek-fn09', gender: 'female', style: 'normal', characterKey: 'deepseek_f_03', composition: 'env' },
  { id: 'deepseek-fn10', gender: 'female', style: 'normal', characterKey: 'deepseek_f_04', composition: 'close' },
  { id: 'deepseek-fn11', gender: 'female', style: 'normal', characterKey: 'deepseek_f_04', composition: 'close' },
  { id: 'deepseek-fn12', gender: 'female', style: 'normal', characterKey: 'deepseek_f_04', composition: 'env' },
  { id: 'deepseek-mq01', gender: 'male', style: 'chibi', characterKey: 'deepseek_m_01', composition: 'env' },
  { id: 'deepseek-mq02', gender: 'male', style: 'chibi', characterKey: 'deepseek_m_01', composition: 'close' },
  { id: 'deepseek-mq03', gender: 'male', style: 'chibi', characterKey: 'deepseek_m_02', composition: 'env' },
  { id: 'deepseek-mq04', gender: 'male', style: 'chibi', characterKey: 'deepseek_m_02', composition: 'close' },
  { id: 'deepseek-mq05', gender: 'male', style: 'chibi', characterKey: 'deepseek_m_03', composition: 'env' },
  { id: 'deepseek-mq06', gender: 'male', style: 'chibi', characterKey: 'deepseek_m_03', composition: 'close' },
  { id: 'deepseek-mq07', gender: 'male', style: 'chibi', characterKey: 'deepseek_m_04', composition: 'env' },
  { id: 'deepseek-mq08', gender: 'male', style: 'chibi', characterKey: 'deepseek_m_04', composition: 'close' },
  { id: 'deepseek-mn01', gender: 'male', style: 'normal', characterKey: 'deepseek_m_01', composition: 'env' },
  { id: 'deepseek-mn02', gender: 'male', style: 'normal', characterKey: 'deepseek_m_01', composition: 'close' },
  { id: 'deepseek-mn03', gender: 'male', style: 'normal', characterKey: 'deepseek_m_01', composition: 'env' },
  { id: 'deepseek-mn04', gender: 'male', style: 'normal', characterKey: 'deepseek_m_02', composition: 'close' },
  { id: 'deepseek-mn05', gender: 'male', style: 'normal', characterKey: 'deepseek_m_02', composition: 'close' },
  { id: 'deepseek-mn06', gender: 'male', style: 'normal', characterKey: 'deepseek_m_02', composition: 'env' },
  { id: 'deepseek-mn07', gender: 'male', style: 'normal', characterKey: 'deepseek_m_03', composition: 'env' },
  { id: 'deepseek-mn08', gender: 'male', style: 'normal', characterKey: 'deepseek_m_03', composition: 'close' },
  { id: 'deepseek-mn09', gender: 'male', style: 'normal', characterKey: 'deepseek_m_03', composition: 'env' },
  { id: 'deepseek-mn10', gender: 'male', style: 'normal', characterKey: 'deepseek_m_04', composition: 'close' },
  { id: 'deepseek-mn11', gender: 'male', style: 'normal', characterKey: 'deepseek_m_04', composition: 'close' },
  { id: 'deepseek-mn12', gender: 'male', style: 'normal', characterKey: 'deepseek_m_04', composition: 'env' },
] satisfies DeepSeekWallpaperPlanEntry[];

export const DEEPSEEK_WALLPAPER_PLAN_BY_ID = new Map(
  DEEPSEEK_WALLPAPER_PLAN.map((entry) => [entry.id, entry]),
);
