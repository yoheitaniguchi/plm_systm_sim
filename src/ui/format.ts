export function formatYen(value: number | undefined): string {
  if (value === undefined) return '—';
  return `¥${value.toLocaleString('ja-JP')}`;
}

export function formatDay(day: number | undefined): string {
  if (day === undefined) return '未設定';
  return `D+${day}`;
}

export const CHANGE_STATUS_ORDER = ['起票', '審査中', '却下', '承認_影響分析中', 'ECO発行', 'ECN通知済', 'クローズ', '取消'] as const;
