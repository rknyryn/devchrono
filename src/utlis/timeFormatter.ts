const TURKISH_DAYS = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const TURKISH_MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

/** Formats seconds into Turkish notation. Example: 5432 → "1s 30dk" or "1s 30dk 45sn" */
export function formatDuration(seconds: number, showSecs: boolean = false): string {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const base = `${hours}s ${minutes.toString().padStart(2, '0')}dk`;
  return showSecs ? `${base} ${secs.toString().padStart(2, '0')}sn` : base;
}

/** Formats an ISO 8601 string to short Turkish date. Example: "2026-04-21T..." → "Sal 21 Nis" */
export function formatDate(isoString: string): string {
  const date = new Date(isoString);
  const dayName = TURKISH_DAYS[date.getDay()];
  const dayNum = date.getDate();
  const monthName = TURKISH_MONTHS[date.getMonth()];
  return `${dayName} ${dayNum} ${monthName}`;
}

/** Returns the short Turkish day name for the given Date. */
export function getDayLabel(date: Date): string {
  return TURKISH_DAYS[date.getDay()];
}
