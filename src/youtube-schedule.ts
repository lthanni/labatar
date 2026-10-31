export function nextLocalEightAm(now = new Date()): string {
  const slot = new Date(now);
  slot.setHours(8, 0, 0, 0);
  if (slot.getTime() <= now.getTime() + 60_000) slot.setDate(slot.getDate() + 1);
  const year = slot.getFullYear();
  const month = String(slot.getMonth() + 1).padStart(2, "0");
  const day = String(slot.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}T08:00`;
}
